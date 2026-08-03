/**
 * Tests for the hardened SP-API control-plane request helper in FinanceService.
 *
 * Background: a single `Error: socket hang up` (Amazon resetting the connection during a
 * multi-minute report flow) used to abort an entire finance sync, because the only retry wrapper
 * rescued token expiry and nothing else, and the request had no timeout at all.
 *
 * The critical subtlety pinned here is that the retry must be VERB-AWARE:
 *   - GET  (poll status / fetch document url) is side-effect free -> retry.
 *   - POST (createReport) is NOT idempotent -> must NEVER be replayed. A socket reset is ambiguous
 *     (the request may have reached Amazon and only the response was lost), so a blind retry can
 *     create a duplicate report and burn a quota that refills at roughly 1/minute.
 */

jest.mock('https');

// MUST be set before requiring FinanceService: the retry knobs are read into module-level consts
// at load time, so setting them in beforeEach has no effect and leaves the real 2s/4s/8s backoff
// running inside the test (which previously pushed this suite to ~12s against a 10s timeout).
const ORIGINAL_ENV = {
    FINANCE_REQUEST_RETRY_BASE_MS: process.env.FINANCE_REQUEST_RETRY_BASE_MS,
    FINANCE_REQUEST_MAX_RETRIES: process.env.FINANCE_REQUEST_MAX_RETRIES,
};
process.env.FINANCE_REQUEST_RETRY_BASE_MS = '1';

const https = require('https');
const {
    httpsRequest,
    isTransientNetworkError,
    classifySyncFailure,
} = require('../../../Services/Sp_API/FinanceService.js');

// Minimal ClientRequest stand-in. setTimeout/destroy are present so the production
// feature-detection path is exercised the same way it is against real Node.
function makeReq() {
    const req = { write: jest.fn(), end: jest.fn(), setTimeout: jest.fn(), destroy: jest.fn() };
    req.on = jest.fn(() => req);
    return req;
}

/** Queue one outcome per attempt: {error} rejects the socket, {body} resolves with JSON. */
function mockSequence(outcomes) {
    const state = { attempts: 0, lastReq: null };
    https.request.mockImplementation((options, cb) => {
        const outcome = outcomes[Math.min(state.attempts, outcomes.length - 1)];
        state.attempts++;
        const req = makeReq();
        state.lastReq = req;
        req.on.mockImplementation((event, handler) => {
            if (event === 'error' && outcome.error) setImmediate(() => handler(outcome.error));
            return req;
        });
        if (!outcome.error) {
            setImmediate(() => cb({
                statusCode: 200,
                headers: {},
                on: function (event, handler) {
                    if (event === 'data') handler(Buffer.from(JSON.stringify(outcome.body)));
                    if (event === 'end') handler();
                    return this;
                },
            }));
        }
        return req;
    });
    return state;
}

const socketHangUp = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
const GET = { hostname: 'h', path: '/reports/2021-06-30/reports/r1', method: 'GET' };
const POST = { hostname: 'h', path: '/reports/2021-06-30/reports', method: 'POST' };

// Restore env so a leaked value cannot make an unrelated suite pass/fail depending on the order
// jest happens to run files in (workers reuse one process, and resetMocks does not touch env).
afterAll(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

describe('POST must never be replayed', () => {
    test('a socket hang up on a POST fails after exactly one attempt', async () => {
        const state = mockSequence([{ error: socketHangUp() }]);

        await expect(httpsRequest(POST, '{}')).rejects.toThrow('socket hang up');

        // Replaying could create a duplicate Amazon report.
        expect(state.attempts).toBe(1);
    });

    test('the verb decides, not the error — same error is retried on GET', async () => {
        const postState = mockSequence([{ error: socketHangUp() }]);
        await expect(httpsRequest(POST, '{}')).rejects.toThrow();
        expect(postState.attempts).toBe(1);

        const getState = mockSequence([{ error: socketHangUp() }, { body: { ok: true } }]);
        await expect(httpsRequest(GET)).resolves.toMatchObject({ body: { ok: true } });
        expect(getState.attempts).toBe(2);
    });

    test('a POST still succeeds normally on a clean response', async () => {
        mockSequence([{ body: { reportId: 'report-123' } }]);
        await expect(httpsRequest(POST, '{}')).resolves.toMatchObject({ body: { reportId: 'report-123' } });
    });
});

describe('GET retry behaviour', () => {
    test('recovers after two transient failures', async () => {
        const state = mockSequence([
            { error: socketHangUp() },
            { error: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) },
            { body: { processingStatus: 'DONE' } },
        ]);

        const res = await httpsRequest(GET);

        expect(res.body.processingStatus).toBe('DONE');
        expect(state.attempts).toBe(3);
    });

    test('gives up after the retry budget rather than looping forever', async () => {
        process.env.FINANCE_REQUEST_MAX_RETRIES = '2';
        jest.resetModules();
        const freshHttps = require('https');
        let attempts = 0;
        freshHttps.request.mockImplementation(() => {
            attempts++;
            const req = makeReq();
            req.on.mockImplementation((event, handler) => {
                if (event === 'error') setImmediate(() => handler(socketHangUp()));
                return req;
            });
            return req;
        });
        const fresh = require('../../../Services/Sp_API/FinanceService.js');

        await expect(fresh.httpsRequest(GET)).rejects.toThrow('socket hang up');
        expect(attempts).toBe(3); // 1 initial + 2 retries
        delete process.env.FINANCE_REQUEST_MAX_RETRIES;
    });

    test('a non-transient error is not retried even on a GET', async () => {
        const state = mockSequence([{ error: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }) }]);

        await expect(httpsRequest(GET)).rejects.toThrow('certificate has expired');
        expect(state.attempts).toBe(1);
    });
});

describe('timeout is armed', () => {
    test('a positive per-request timeout is set (previously there was none)', async () => {
        const state = mockSequence([{ body: { ok: true } }]);

        await httpsRequest(GET);

        expect(state.lastReq.setTimeout).toHaveBeenCalled();
        expect(state.lastReq.setTimeout.mock.calls[0][0]).toBeGreaterThan(0);
    });
});

describe('isTransientNetworkError classification', () => {
    test.each([
        ['ECONNRESET', 'ECONNRESET'],
        ['ETIMEDOUT', 'ETIMEDOUT'],
        ['EPIPE', 'EPIPE'],
        ['ECONNABORTED', 'ECONNABORTED'],
        ['EAI_AGAIN', 'EAI_AGAIN'],
    ])('treats %s as transient', (_label, code) => {
        expect(isTransientNetworkError(Object.assign(new Error('x'), { code }))).toBe(true);
    });

    test('matches "socket hang up" even when the code was stripped by re-wrapping', () => {
        expect(isTransientNetworkError(new Error('socket hang up'))).toBe(true);
    });

    test('does not treat auth or data errors as transient', () => {
        expect(isTransientNetworkError(new Error('Access to requested resource is denied'))).toBe(false);
        expect(isTransientNetworkError(new Error('parsed 0 rows'))).toBe(false);
        expect(isTransientNetworkError(null)).toBe(false);
    });
});

describe('classifySyncFailure must not over-capture', () => {
    test('a Mongoose buffering timeout stays "other" — it is a DB fault, not an Amazon one', () => {
        // Contains 'timed out' but NOT 'timeout'; a bare 'timed out' matcher would mis-bucket it.
        const err = new Error('Operation `dailyskufinances.insertMany()` buffering timed out after 10000ms');
        expect(classifySyncFailure(err)).toBe('other');
    });

    test('our own request timeout is still classified as a timeout', () => {
        expect(classifySyncFailure(new Error('[FinanceService] request timed out after 30000ms'))).toBe('timeout');
    });
});

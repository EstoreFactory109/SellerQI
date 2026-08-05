/**
 * Tests for the Finance API transport's timeout + transient-retry behaviour.
 *
 * WHY THIS EXISTS
 * `Expences.js`'s `httpsRequest` had neither a timeout nor any retry, so a single `socket hang up`
 * rejected outright and its raw message propagated up as `finalize failed: socket hang up`.
 *
 * CORRECTION (2026-08-05): the GET retry these tests originally covered did NOT fix that production
 * error — the GET walk was never the failing hop. The LWA token POST (`getAccessToken`) was: the
 * idempotent-verb rule excluded it, so it got exactly one attempt and logged nothing at all, making
 * it invisible. Phase-0 evidence was decisive — ZERO `transient network error` warns in the 10
 * minutes around two real failures, which rules out every retried GET since each logs per retry.
 *
 * The `the LWA token POST is retried` block below is therefore the actual regression test for the
 * production bug. The GET coverage remains valid on its own terms: `fetchTransactions` walks 1000+
 * pages, and since all Amazon I/O in Step 1 happens BEFORE the first database write, losing one page
 * discards the entire chunk.
 */

jest.mock('axios-retry', () => {
    const fn = () => {};
    fn.exponentialDelay = () => 0;
    fn.isNetworkError = () => false;
    fn.isRetryableError = () => false;
    fn.isIdempotentRequestError = () => false;
    fn.isNetworkOrIdempotentRequestError = () => false;
    fn.default = fn;
    return fn;
});

jest.mock('../../../utils/Logger.js', () => ({
    info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

// Scripted transport: each entry is either an Error to emit on 'error', or a body to return.
let mockScript = [];
let mockRequestCount = 0;
let mockTimeoutArmed = 0;
jest.mock('https', () => ({
    request: (options, cb) => {
        const step = mockScript[mockRequestCount] ?? { body: { payload: { transactions: [], nextToken: null } } };
        mockRequestCount += 1;
        const handlers = {};
        const req = {
            on: (evt, fn) => { handlers[evt] = fn; return req; },
            setTimeout: () => { mockTimeoutArmed += 1; return req; },
            write: () => {},
            destroy: () => {},
            end: () => {
                setImmediate(() => {
                    if (step instanceof Error) { handlers.error?.(step); return; }
                    const res = {
                        statusCode: step.statusCode || 200,
                        headers: {},
                        on: (evt, fn) => {
                            if (evt === 'data') fn(Buffer.from(JSON.stringify(step.body)));
                            if (evt === 'end') fn();
                            return res;
                        },
                    };
                    cb(res);
                });
            },
        };
        return req;
    },
}));

const { fetchTransactions, getAccessToken } = require('../../../Services/Sp_API/Expences.js');
const logger = require('../../../utils/Logger.js');

const HOST = 'sellingpartnerapi-na.amazon.com';
const okPage = { body: { payload: { transactions: [{ id: 't' }], nextToken: null } } };
const tokenPage = { body: { access_token: 'fresh-token' } };
const netErr = (msg, code) => Object.assign(new Error(msg), code ? { code } : {});

const run = () => fetchTransactions('tok', HOST, '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 'ATVPDKIKX0DER', null, { onPage: async () => {} });
const mintToken = () => getAccessToken('client-id', 'client-secret', 'refresh-token');

/** Every warn emitted, flattened, so a test can assert on the transport's own narration. */
const warnText = () => logger.warn.mock.calls.map((c) => c.join(' ')).join('\n');

/** The backoff sleeps for seconds; fire timers immediately so tests stay fast. */
function withInstantTimers(fn) {
    return async () => {
        const real = global.setTimeout;
        global.setTimeout = (cb) => { cb(); return 0; };
        try { await fn(); } finally { global.setTimeout = real; }
    };
}

beforeEach(() => {
    mockScript = [];
    mockRequestCount = 0;
    mockTimeoutArmed = 0;
    jest.clearAllMocks();
});

describe('transient network errors are retried', () => {
    test('a `socket hang up` is retried and the walk completes', withInstantTimers(async () => {
        // The exact production error. Before the fix this rejected and killed the whole chunk.
        mockScript = [netErr('socket hang up', 'ECONNRESET'), okPage];
        await expect(run()).resolves.toBeDefined();
        expect(mockRequestCount).toBe(2);
    }));

    test('`socket hang up` with NO code set is still recognised', withInstantTimers(async () => {
        // Matched by message as well as code: Node reports a mid-flight reset as
        // Error('socket hang up') with code ECONNRESET, so matching only one of the two misses cases.
        mockScript = [netErr('socket hang up'), okPage];
        await expect(run()).resolves.toBeDefined();
        expect(mockRequestCount).toBe(2);
    }));

    test.each([['ECONNRESET'], ['ETIMEDOUT'], ['EPIPE'], ['ECONNABORTED'], ['EAI_AGAIN']])(
        '%s is retried', (code) => withInstantTimers(async () => {
            mockScript = [netErr('network blip', code), okPage];
            await expect(run()).resolves.toBeDefined();
            expect(mockRequestCount).toBe(2);
        })(),
    );

    test('several consecutive failures are ridden out within the attempt budget', withInstantTimers(async () => {
        mockScript = [netErr('socket hang up', 'ECONNRESET'), netErr('socket hang up', 'ECONNRESET'), okPage];
        await expect(run()).resolves.toBeDefined();
        expect(mockRequestCount).toBe(3);
    }));

    test('gives up after the attempt budget rather than retrying forever', withInstantTimers(async () => {
        mockScript = Array.from({ length: 10 }, () => netErr('socket hang up', 'ECONNRESET'));
        await expect(run()).rejects.toThrow(/socket hang up/);
        // 1 initial + FINANCE_TXN_REQUEST_MAX_RETRIES (3) = 4, not unbounded.
        expect(mockRequestCount).toBe(4);
    }));
});

describe('non-transient failures are NOT retried', () => {
    test('a non-network error propagates on the first attempt', withInstantTimers(async () => {
        // Retrying a real error just burns the Amazon quota this change exists to protect.
        mockScript = [netErr('Something structural went wrong')];
        await expect(run()).rejects.toThrow(/structural/);
        expect(mockRequestCount).toBe(1);
    }));
});

describe('every request arms a timeout', () => {
    test('the transport sets a per-request timeout', async () => {
        // Without one, a hung connection waits on the OS default (~2 min+) with nothing to break it.
        mockScript = [okPage];
        await run();
        expect(mockTimeoutArmed).toBeGreaterThan(0);
    });
});

/**
 * The LWA token mint — a POST, and the CONFIRMED source of the production
 * `finalize failed: socket hang up`.
 *
 * It was the only hop inside the finance finalize path that was simultaneously (a) reachable,
 * (b) not retried (POST), (c) not error-wrapped, so it emitted a BARE message, and (d) completely
 * silent — it logged nothing at all on the way out. That combination is what made three rounds of
 * diagnosis land on the wrong hop: the log showed a bare `socket hang up` with no accompanying
 * retry line, which was read as "the retry didn't work" when it actually meant "this hop never
 * retried in the first place".
 *
 * Phase-0 evidence: zero `transient network error` warns in the 10 minutes around two real
 * failures, which rules out every retryable GET hop (all of which log per retry).
 */
describe('the LWA token POST is retried (the actual production bug)', () => {
    test('a `socket hang up` minting a token is retried and succeeds', withInstantTimers(async () => {
        mockScript = [netErr('socket hang up', 'ECONNRESET'), tokenPage];
        await expect(mintToken()).resolves.toBe('fresh-token');
        expect(mockRequestCount).toBe(2);
    }));

    test('it rides out several consecutive resets', withInstantTimers(async () => {
        mockScript = [
            netErr('socket hang up', 'ECONNRESET'),
            netErr('ECONNRESET', 'ECONNRESET'),
            tokenPage,
        ];
        await expect(mintToken()).resolves.toBe('fresh-token');
        expect(mockRequestCount).toBe(3);
    }));

    test('it still gives up at the budget rather than retrying forever', withInstantTimers(async () => {
        mockScript = Array.from({ length: 10 }, () => netErr('socket hang up', 'ECONNRESET'));
        await expect(mintToken()).rejects.toThrow(/socket hang up/);
        expect(mockRequestCount).toBe(4); // 1 initial + 3 retries
        // And it must SAY so — silence here is what cost three rounds of diagnosis.
        expect(warnText()).toMatch(/GAVE UP/);
    }));

    test('a NON-transient auth failure is not retried', withInstantTimers(async () => {
        // Retrying a genuine credential rejection just burns the quota, and LWA rate-limits hard.
        mockScript = [{ body: { error: 'invalid_grant' } }];
        await expect(mintToken()).rejects.toThrow(/Auth failed/);
        expect(mockRequestCount).toBe(1);
    }));

    test('the failure is tagged `lwaToken` so the stored note names the hop', withInstantTimers(async () => {
        mockScript = Array.from({ length: 5 }, () => netErr('socket hang up', 'ECONNRESET'));
        await expect(mintToken()).rejects.toMatchObject({ hop: 'lwaToken' });
    }));
});

describe('the transport narrates what it did', () => {
    test('a retried GET logs which attempt it is on', withInstantTimers(async () => {
        mockScript = [netErr('socket hang up', 'ECONNRESET'), okPage];
        await run();
        expect(warnText()).toMatch(/retry 1\/3/);
    }));

    test('an exhausted GET budget logs GAVE UP', withInstantTimers(async () => {
        mockScript = Array.from({ length: 10 }, () => netErr('socket hang up', 'ECONNRESET'));
        await expect(run()).rejects.toThrow();
        expect(warnText()).toMatch(/GAVE UP/);
    }));

    test('a mid-walk failure records HOW FAR the walk got', withInstantTimers(async () => {
        // pagesCompleted is the difference between "died on page 1" and "died on page 847" — which
        // the bare message could never express, and which decides whether a retry is even worth it.
        const page = (nextToken) => ({ body: { payload: { transactions: [{ id: 't' }], nextToken } } });
        mockScript = [
            page('t1'), page('t2'),            // pages 1 and 2 land
            ...Array.from({ length: 4 }, () => netErr('socket hang up', 'ECONNRESET')), // page 3 dies
        ];
        await expect(run()).rejects.toMatchObject({
            hop: 'financeTxnPage',
            pagesCompleted: 2,
            page: 3,
        });
    }));
});

describe('backoff jitter', () => {
    test('each wait is within ±25% of the nominal exponential delay', async () => {
        // Fixed schedules make N clustered workers retry in lockstep, turning one Amazon blip into a
        // synchronised herd. Bounds are asserted rather than exact values because the point is spread.
        const delays = [];
        const realTimeout = global.setTimeout;
        global.setTimeout = (cb, ms) => { delays.push(ms); cb(); return 0; };
        try {
            mockScript = Array.from({ length: 10 }, () => netErr('socket hang up', 'ECONNRESET'));
            await expect(run()).rejects.toThrow();
        } finally {
            global.setTimeout = realTimeout;
        }

        expect(delays.length).toBe(3);                 // 3 retries => 3 sleeps
        [2000, 4000, 8000].forEach((nominal, i) => {
            expect(delays[i]).toBeGreaterThanOrEqual(nominal * 0.75);
            expect(delays[i]).toBeLessThanOrEqual(nominal * 1.25);
        });
    });
});

/**
 * Tests for the Finance API transport's timeout + transient-retry behaviour.
 *
 * WHY THIS EXISTS
 * `Expences.js`'s `httpsRequest` had neither a timeout nor any retry. A single `socket hang up`
 * rejected outright and its raw message propagated up as `finalize failed: socket hang up` — the
 * exact production error that put one account into a 3-hourly retry loop for a full day.
 *
 * It was a numbers game, not bad luck: `fetchTransactions` walks 1000+ pages for a high-volume
 * account, every one through this helper, so across a full walk at least one reset is near-certain.
 * And because all Amazon I/O in Step 1 happens BEFORE the first database write, losing one page
 * discards the entire chunk — zero forward progress — which is why the same chunk failed
 * identically on every single retry rather than randomly.
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

const { fetchTransactions } = require('../../../Services/Sp_API/Expences.js');

const HOST = 'sellingpartnerapi-na.amazon.com';
const okPage = { body: { payload: { transactions: [{ id: 't' }], nextToken: null } } };
const netErr = (msg, code) => Object.assign(new Error(msg), code ? { code } : {});

const run = () => fetchTransactions('tok', HOST, '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 'ATVPDKIKX0DER', null, { onPage: async () => {} });

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

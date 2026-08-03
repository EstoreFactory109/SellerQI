/**
 * Tests for the log sampling added to the Finance API pagination loop.
 *
 * Why this is worth a test: the PM2 God daemon owns every process's stdout, and when it cannot
 * drain to disk the unwritten lines buffer in its own heap. On 2 Jul 2026 it reached 12.6 GB and was
 * OOM-killed, taking the whole stack down. `fetchTransactions` emitted one `info` line PER PAGE and
 * we have observed 1000+ pages for a single account, which made it the largest single producer of
 * stdout on the box.
 *
 * Sampling is only a good trade if it keeps the signal. So these lock BOTH directions:
 *   - volume actually collapses (otherwise the fix does nothing), and
 *   - the first page, the last page, and the throttle condition remain visible at info/warn
 *     (otherwise we have traded away the ability to see a stuck or rate-limited fetch).
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

const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockDebug = jest.fn();
jest.mock('../../../utils/Logger.js', () => ({
    info: (...a) => mockInfo(...a),
    warn: (...a) => mockWarn(...a),
    debug: (...a) => mockDebug(...a),
    error: jest.fn(),
}));

// Drive pagination purely through the mocked transport: N pages, then stop.
let mockPagesRemaining = 0;
let mockThrottleOnce = false;
jest.mock('https', () => ({
    request: (options, cb) => {
        const throttled = mockThrottleOnce;
        mockThrottleOnce = false;
        const body = throttled
            ? { errors: [{ code: 'QuotaExceeded', message: 'slow down' }] }
            : {
                payload: {
                    transactions: [{ id: 'txn' }],
                    nextToken: mockPagesRemaining > 1 ? 'more' : null,
                },
            };
        if (!throttled) mockPagesRemaining -= 1;
        const res = {
            statusCode: throttled ? 429 : 200,
            headers: {},
            on: (evt, fn) => {
                if (evt === 'data') fn(Buffer.from(JSON.stringify(body)));
                if (evt === 'end') fn();
                return res;
            },
        };
        setImmediate(() => cb(res));
        return { on: () => {}, write: () => {}, end: () => {} };
    },
}));

const { fetchTransactions } = require('../../../Services/Sp_API/Expences.js');

const HOST = 'sellingpartnerapi-na.amazon.com';
const run = (pages) => {
    mockPagesRemaining = pages;
    return fetchTransactions('tok', HOST, '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 'ATVPDKIKX0DER', null, {
        onPage: async () => {},
    });
};

const pageLines = (mockFn) =>
    mockFn.mock.calls.map((c) => String(c[0])).filter((s) => /Page \d+: fetched/.test(s));

beforeEach(() => {
    mockInfo.mockReset();
    mockWarn.mockReset();
    mockDebug.mockReset();
    mockThrottleOnce = false;
});

/**
 * The throttle backoff sleeps `max(min(10000 * 2^attempt, 60000), headerDelay)` — a real 10-second
 * wait on the first retry, which blows the 10s Jest timeout. Fire timers immediately so the retry
 * path can be exercised without the wall-clock cost. `setImmediate` (used by the https mock) is
 * untouched, so the request/response ordering is unaffected.
 */
function withInstantTimers(fn) {
    return async () => {
        const real = global.setTimeout;
        global.setTimeout = (cb) => { cb(); return 0; };
        try { await fn(); } finally { global.setTimeout = real; }
    };
}

describe('per-page logging is sampled', () => {
    test('a 200-page fetch emits far fewer than 200 info lines', async () => {
        await run(200);
        const info = pageLines(mockInfo);
        // Was 200 (one per page). With 1-in-50 sampling plus first/last it should be single digits.
        expect(info.length).toBeLessThan(15);
        expect(info.length).toBeGreaterThan(0);
    });

    test('every page is still traceable at debug', async () => {
        await run(200);
        // Nothing is lost — the full per-page detail is still there for anyone investigating, it
        // just does not reach stdout in production (logger.debug is suppressed when LOG_LEVEL=info).
        expect(pageLines(mockInfo).length + pageLines(mockDebug).length).toBe(200);
    });

    test('the FIRST page is always logged at info — "did it start"', async () => {
        await run(200);
        expect(pageLines(mockInfo)[0]).toMatch(/Page 1: fetched/);
    });

    test('the LAST page is always logged at info — "did it finish"', async () => {
        await run(120);
        const info = pageLines(mockInfo);
        expect(info[info.length - 1]).toMatch(/Page 120: fetched/);
        expect(info[info.length - 1]).toMatch(/nextToken: no/);
    });

    test('a short fetch logs every page — sampling must not hide small runs', async () => {
        // Most accounts are only a few pages; their logs were never the problem, so sampling must
        // not engage until a fetch is clearly an outlier.
        await run(3);
        expect(pageLines(mockInfo)).toHaveLength(3);
        expect(pageLines(mockDebug)).toHaveLength(0);
    });

    test('sampled lines say so, so nobody reads a gap as missing pages', async () => {
        await run(120);
        const sampled = pageLines(mockInfo).filter((s) => /sampled 1-in-/.test(s));
        expect(sampled.length).toBeGreaterThan(0);
    });
});

describe('the end-of-fetch summary carries the true totals', () => {
    test('reports the real page count even though pages were sampled', async () => {
        await run(200);
        const summary = mockInfo.mock.calls.map((c) => String(c[0])).find((s) => /Total transactions:/.test(s));
        expect(summary).toMatch(/across 200 page\(s\)/);
    });

    test('a throttled fetch reports the throttle count, which sampling would otherwise hide', withInstantTimers(async () => {
        mockPagesRemaining = 5;
        mockThrottleOnce = true;
        await fetchTransactions('tok', HOST, '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 'ATVPDKIKX0DER', null, {
            onPage: async () => {},
        });
        const summary = mockInfo.mock.calls.map((c) => String(c[0])).find((s) => /Total transactions:/.test(s));
        // Without this, sampling could make a heavily rate-limited fetch look merely slow.
        expect(summary).toMatch(/throttle retr/);
    }));

    test('an unthrottled fetch does not mention throttling', async () => {
        await run(5);
        const summary = mockInfo.mock.calls.map((c) => String(c[0])).find((s) => /Total transactions:/.test(s));
        expect(summary).not.toMatch(/throttle/);
    });
});

describe('throttling stays visible', () => {
    test('the first throttle is logged at warn, not buried in debug', withInstantTimers(async () => {
        mockPagesRemaining = 5;
        mockThrottleOnce = true;
        await fetchTransactions('tok', HOST, '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 'ATVPDKIKX0DER', null, {
            onPage: async () => {},
        });
        const throttleWarns = mockWarn.mock.calls.map((c) => String(c[0])).filter((s) => /Throttled on page/.test(s));
        expect(throttleWarns.length).toBeGreaterThan(0);
        expect(throttleWarns[0]).toMatch(/throttle #1 this fetch/);
    }));
});

/**
 * Tests for _runAsyncFinancePhase — the non-blocking finance sync.
 *
 * These lock the properties whose violation is SILENT in production. Each of the first three
 * corresponds to a way this design can stall a seller's finance data forever with no error:
 *
 *   1. The window must be FROZEN. It is derived from `now`; recomputing it on a poll tick that
 *      crosses Pacific midnight changes the chunk's paramsKey, the persisted engine row then
 *      matches no spec, the engine skips it, and the phase reschedules forever.
 *   2. The reschedule counter must be MONOTONIC. The worker builds the re-enqueue jobId as
 *      `…-poll${pollAttempt || 1}` and BullMQ silently drops a duplicate jobId — so resetting the
 *      counter per chunk makes the chunk N→N+1 hand-off collide with chunk N+1's first poll and
 *      the chain dies with no error.
 *   3. A FAILED chunk must STOP the walk. The cursor is max(success date); letting a later chunk
 *      land after an earlier one failed jumps the cursor over the gap and strands those days at $0.
 *
 * Everything external is mocked, so this is pure state-machine logic — no DB, no Amazon.
 */

// The global setup mocks `axios` with an object that has no `interceptors`, which makes
// axios-retry throw at import time somewhere in ScheduledIntegration's require graph.
jest.mock('axios-retry', () => {
    const fn = () => {};
    fn.exponentialDelay = () => 0;
    fn.isNetworkError = () => false;
    fn.isRetryableError = () => false;
    fn.isIdempotentRequestError = () => false;
    fn.isNetworkOrIdempotentRequestError = () => false;
    fn.default = fn;   // consumers import it as `require('axios-retry').default`
    return fn;
});

const mockRunAsyncAdsReports = jest.fn();
jest.mock('../../../Services/AmazonAds/asyncReportEngine.js', () => ({
    runAsyncAdsReports: (...a) => mockRunAsyncAdsReports(...a),
    findStuckAdsAccounts: jest.fn(),
    TERMINAL: new Set(['DONE', 'NO_DATA', 'FAILED']),
}));

let mockEngineRows = [];
const mockDeleteOne = jest.fn();
jest.mock('../../../models/amazon-ads/AsyncReportRequestModel.js', () => ({
    find: () => ({ lean: async () => mockEngineRows }),
    deleteOne: (...a) => mockDeleteOne(...a),
}));

jest.mock('../../../models/finance/FinanceSyncLogModel.js', () => ({}));

const mockPlanFinanceSync = jest.fn();
const mockRunFinanceSyncTail = jest.fn();
const mockRecordSyncFailure = jest.fn();
const mockBuildSpecs = jest.fn();
jest.mock('../../../Services/Sp_API/FinanceService.js', () => ({
    createTokenManager: () => ({ token: 'tok', getValidToken: async () => 'tok' }),
    planFinanceSync: (...a) => mockPlanFinanceSync(...a),
    runFinanceSyncTail: (...a) => mockRunFinanceSyncTail(...a),
    recordSyncFailure: (...a) => mockRecordSyncFailure(...a),
    classifySyncFailure: () => 'other',
    PROVISIONAL_SETTLE_DAYS: 14,
    financeSalesReportAsync: {
        serviceName: 'financeSalesReport',
        buildSpecs: (...a) => mockBuildSpecs(...a),
    },
    syncFinanceData: jest.fn(),
}));

const { ScheduledIntegration: SI } = require('../../../Services/schedule/ScheduledIntegration.js');

// A real ObjectId hex — the failure path constructs `new mongoose.Types.ObjectId(userId)`, so a
// placeholder like 'u1' would throw and silently skip the very call this suite asserts on.
const USER = '507f1f77bcf86cd799439011';
const REGION = 'NA';
const COUNTRY = 'US';

// Three 3-day chunks, oldest first.
const CHUNKS = [
    { startDate: '2026-07-01', endDate: '2026-07-03' },
    { startDate: '2026-07-04', endDate: '2026-07-06' },
    { startDate: '2026-07-07', endDate: '2026-07-09' },
];
const WINDOW = { mode: 'incremental', startDate: '2026-07-01', endDate: '2026-07-09', note: 'test' };

/** phaseData as it looks on a re-entry that has already planned and frozen the window. */
function frozenPhaseData(overrides = {}) {
    return {
        financeAsyncStarted: true,
        financeWindow: WINDOW,
        financeChunks: CHUNKS,
        financeChunkIndex: 0,
        financeTick: 1,
        ...overrides,
    };
}

function engineRow(status, extra = {}) {
    return { _id: 'row1', status, paramsKey: `${CHUNKS[0].startDate}_${CHUNKS[0].endDate}`, result: {}, ...extra };
}

beforeEach(() => {
    mockEngineRows = [];
    mockRunAsyncAdsReports.mockReset();
    mockDeleteOne.mockReset().mockResolvedValue({});
    mockPlanFinanceSync.mockReset().mockResolvedValue({ window: WINDOW, chunks: CHUNKS, latestSyncDate: '2026-06-30' });
    mockRunFinanceSyncTail.mockReset().mockResolvedValue({ resolved: 5, stillPending: 0, expired: 0 });
    mockRecordSyncFailure.mockReset().mockResolvedValue(undefined);
    mockBuildSpecs.mockReset().mockReturnValue([{ service: 'financeSalesReport', paramsKey: 'k', params: {} }]);

    jest.spyOn(SI, '_prepareForBatchPhase').mockResolvedValue({
        AccessToken: 'at', RefreshToken: 'rt', marketplaceIds: ['ATVPDKIKX0DER'],
    });
    jest.spyOn(SI, '_logApiResultsToSession').mockResolvedValue(undefined);
    jest.spyOn(SI, '_writePhaseSlices').mockResolvedValue(undefined);
    jest.spyOn(SI, '_writeFinanceSlice').mockResolvedValue(undefined);
});

describe('_runAsyncFinancePhase — the window is frozen', () => {
    test('plans on the first tick', async () => {
        mockRunAsyncAdsReports.mockResolvedValue({ done: false, reschedule: { delayMs: 300000, pollAttempt: 1 } });
        await SI._runAsyncFinancePhase({ userId: USER, Region: REGION, Country: COUNTRY, phaseData: {} });
        expect(mockPlanFinanceSync).toHaveBeenCalledTimes(1);
    });

    test('does NOT re-plan on a poll tick — the frozen window is reused verbatim', async () => {
        mockRunAsyncAdsReports.mockResolvedValue({ done: false, reschedule: { delayMs: 300000, pollAttempt: 2 } });
        const res = await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: frozenPhaseData(),
        });
        expect(mockPlanFinanceSync).not.toHaveBeenCalled();
        expect(res.dataForNextPhase.financeWindow).toEqual(WINDOW);
        expect(res.dataForNextPhase.financeChunks).toEqual(CHUNKS);
    });

    test('buildSpecs gets the SAME chunk across ticks, so paramsKey is stable', async () => {
        mockRunAsyncAdsReports.mockResolvedValue({ done: false, reschedule: { delayMs: 1, pollAttempt: 1 } });

        // Tick 1: fresh plan.
        await SI._runAsyncFinancePhase({ userId: USER, Region: REGION, Country: COUNTRY, phaseData: {} });
        const firstChunk = mockBuildSpecs.mock.calls[0][0].chunk;

        // Tick 2: a day later — planFinanceSync would now return a DIFFERENT window, which is
        // exactly the rollover that used to break this. The frozen phaseData must win.
        mockPlanFinanceSync.mockResolvedValue({
            window: { mode: 'incremental', startDate: '2026-07-02', endDate: '2026-07-10', note: 'shifted' },
            chunks: [{ startDate: '2026-07-02', endDate: '2026-07-04' }],
            latestSyncDate: '2026-07-01',
        });
        await SI._runAsyncFinancePhase({ userId: USER, Region: REGION, Country: COUNTRY, phaseData: frozenPhaseData() });
        const secondChunk = mockBuildSpecs.mock.calls[1][0].chunk;

        expect(secondChunk).toEqual(firstChunk);
    });
});

describe('_runAsyncFinancePhase — the reschedule counter is monotonic', () => {
    test('a poll reschedule never emits pollAttempt 0 or a repeat', async () => {
        mockRunAsyncAdsReports.mockResolvedValue({ done: false, reschedule: { delayMs: 1, pollAttempt: 99 } });
        const res = await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: frozenPhaseData({ financeTick: 4 }),
        });
        expect(res.reschedule.pollAttempt).toBe(5);
        expect(res.dataForNextPhase.financeTick).toBe(5);
    });

    test('the chunk N→N+1 hand-off does NOT reuse a jobId the polls already burned', async () => {
        // Chunk 1 polled three times (ticks 1-3), so ticks 1..3 are spent. Its completion must
        // hand off on tick 4 — reusing 0/1 here is what silently dropped the enqueue.
        mockEngineRows = [engineRow('DONE', { result: { skuDocs: 10 } })];
        mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });

        const res = await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY,
            phaseData: frozenPhaseData({ financeTick: 3, financeChunkIndex: 0 }),
        });

        expect(res.reschedule.pollAttempt).toBe(4);
        expect(res.dataForNextPhase.financeChunkIndex).toBe(1);
    });

    test('tick increases across a full submit → poll → hand-off sequence', async () => {
        const seen = [];
        let phaseData = {};

        // Two polls, then done.
        mockRunAsyncAdsReports
            .mockResolvedValueOnce({ done: false, reschedule: { delayMs: 1, pollAttempt: 1 } })
            .mockResolvedValueOnce({ done: false, reschedule: { delayMs: 1, pollAttempt: 2 } })
            .mockResolvedValue({ done: true, summary: {} });

        for (let i = 0; i < 3; i++) {
            if (i === 2) mockEngineRows = [engineRow('DONE')];
            const res = await SI._runAsyncFinancePhase({ userId: USER, Region: REGION, Country: COUNTRY, phaseData });
            seen.push(res.reschedule.pollAttempt);
            phaseData = { ...phaseData, ...res.dataForNextPhase };
        }

        expect(seen).toEqual([1, 2, 3]);
        expect(new Set(seen).size).toBe(seen.length);   // all distinct → no jobId collision
    });
});

describe('_runAsyncFinancePhase — a FAILED chunk stops the walk', () => {
    test('does not advance to the next chunk, and records the failure against that chunk only', async () => {
        mockEngineRows = [engineRow('FAILED', { note: 'report FATAL' })];
        mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });

        const res = await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY,
            phaseData: frozenPhaseData({ financeChunkIndex: 1 }),
        });

        expect(res.success).toBe(false);
        expect(res.reschedule).toBeUndefined();                     // walk stopped
        expect(res.dataForNextPhase.financeChunkIndex).toBeUndefined();

        // Scoped to the failing chunk — NOT the whole window, which would stamp `failed` on days
        // an earlier chunk had just succeeded at.
        const call = mockRecordSyncFailure.mock.calls[0][0];
        expect(call.from).toBe(CHUNKS[1].startDate);
        expect(call.to).toBe(CHUNKS[1].endDate);
    });

    test('a missing engine row is treated as a failure, not as success', async () => {
        mockEngineRows = [];
        mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });
        const res = await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: frozenPhaseData(),
        });
        expect(res.success).toBe(false);
    });

    test('the tail still runs after a failure, so chunks that DID land get their fees resolved', async () => {
        mockEngineRows = [engineRow('FAILED', { note: 'boom' })];
        mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });
        await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: frozenPhaseData({ financeChunkIndex: 2 }),
        });
        expect(mockRunFinanceSyncTail).toHaveBeenCalledTimes(1);
    });
});

describe('_runAsyncFinancePhase — the chunk walk', () => {
    test('one chunk is in flight at a time, oldest first', async () => {
        mockRunAsyncAdsReports.mockResolvedValue({ done: false, reschedule: { delayMs: 1, pollAttempt: 1 } });
        await SI._runAsyncFinancePhase({ userId: USER, Region: REGION, Country: COUNTRY, phaseData: {} });
        expect(mockBuildSpecs).toHaveBeenCalledTimes(1);
        expect(mockBuildSpecs.mock.calls[0][0].chunk).toEqual(CHUNKS[0]);
    });

    test('the last chunk runs the tail exactly once and does not reschedule', async () => {
        mockEngineRows = [engineRow('DONE', { result: { skuDocs: 3 } })];
        mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });

        const res = await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY,
            phaseData: frozenPhaseData({ financeChunkIndex: 2 }),
        });

        expect(res.success).toBe(true);
        expect(res.reschedule).toBeUndefined();
        expect(mockRunFinanceSyncTail).toHaveBeenCalledTimes(1);
    });

    test('the tail does NOT run on an intermediate chunk', async () => {
        mockEngineRows = [engineRow('DONE')];
        mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });
        await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: frozenPhaseData({ financeChunkIndex: 0 }),
        });
        expect(mockRunFinanceSyncTail).not.toHaveBeenCalled();
    });

    test('per-chunk results accumulate across the walk', async () => {
        mockEngineRows = [engineRow('DONE', { result: { skuDocs: 7, salesOrders: 2, overheadDocs: 1, pendingOrders: 3 } })];
        mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });

        const res = await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY,
            phaseData: frozenPhaseData({ financeAggregate: { salesOrders: 1, skuDocs: 10, overheadDocs: 2, pendingOrders: 0 } }),
        });

        expect(res.dataForNextPhase.financeAggregate).toEqual({
            salesOrders: 3, skuDocs: 17, overheadDocs: 3, pendingOrders: 3,
        });
    });

    test('FINANCE_MAX_CHUNKS_PER_RUN ends the run early rather than walking a whole backlog', async () => {
        const prev = process.env.FINANCE_MAX_CHUNKS_PER_RUN;
        process.env.FINANCE_MAX_CHUNKS_PER_RUN = '1';
        try {
            mockEngineRows = [engineRow('DONE')];
            mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });
            const res = await SI._runAsyncFinancePhase({
                userId: USER, Region: REGION, Country: COUNTRY, phaseData: frozenPhaseData({ financeChunkIndex: 0 }),
            });
            // Chunk 1 of 3 done, but the cap is hit — stop cleanly and let the next daily run
            // continue from the advanced cursor.
            expect(res.reschedule).toBeUndefined();
            expect(res.success).toBe(true);
        } finally {
            if (prev === undefined) delete process.env.FINANCE_MAX_CHUNKS_PER_RUN;
            else process.env.FINANCE_MAX_CHUNKS_PER_RUN = prev;
        }
    });
});

describe('_runAsyncFinancePhase — the empty-report retry is bounded', () => {
    const recentChunks = [{ startDate: new Date(Date.now() - 3 * 86400000).toISOString().substring(0, 10), endDate: new Date(Date.now() - 1 * 86400000).toISOString().substring(0, 10) }];

    function recentFrozen(overrides = {}) {
        return {
            financeAsyncStarted: true,
            financeWindow: { mode: 'incremental', startDate: recentChunks[0].startDate, endDate: recentChunks[0].endDate, note: 'r' },
            financeChunks: recentChunks,
            financeChunkIndex: 0,
            financeTick: 1,
            ...overrides,
        };
    }
    const recentKey = () => `${recentChunks[0].startDate}_${recentChunks[0].endDate}`;

    test('a recent chunk that returns no data is re-submitted exactly once', async () => {
        mockEngineRows = [{ _id: 'r', status: 'NO_DATA', paramsKey: recentKey(), result: {} }];
        mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });

        const res = await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: recentFrozen(),
        });

        expect(mockDeleteOne).toHaveBeenCalledTimes(1);          // row removed → engine re-submits
        expect(res.reschedule).toBeDefined();
        expect(res.dataForNextPhase.financeChunkIndex).toBe(0);  // same chunk
        expect(res.dataForNextPhase.financeEmptyRetries[recentKey()]).toBe(1);
    });

    test('the SECOND no-data result is accepted and the walk advances', async () => {
        mockEngineRows = [{ _id: 'r', status: 'NO_DATA', paramsKey: recentKey(), result: {} }];
        mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });

        const res = await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY,
            phaseData: recentFrozen({ financeEmptyRetries: { [recentKey()]: 1 } }),
        });

        expect(mockDeleteOne).not.toHaveBeenCalled();
        expect(res.success).toBe(true);
        expect(res.reschedule).toBeUndefined();
    });

    test('an OLD chunk is never re-submitted — an empty window there is genuine', async () => {
        // Re-requesting aged-out windows forever is what congests the seller's report queue.
        mockEngineRows = [engineRow('NO_DATA')];
        mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });

        const res = await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: frozenPhaseData({ financeChunkIndex: 2 }),
        });

        expect(mockDeleteOne).not.toHaveBeenCalled();
        expect(res.success).toBe(true);
    });
});

describe('_runAsyncFinancePhase — guards', () => {
    test('missing SP-API tokens skip the phase instead of throwing', async () => {
        SI._prepareForBatchPhase.mockResolvedValue({ AccessToken: null, RefreshToken: null });
        const res = await SI._runAsyncFinancePhase({ userId: USER, Region: REGION, Country: COUNTRY, phaseData: {} });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/tokens unavailable/i);
        expect(mockRunAsyncAdsReports).not.toHaveBeenCalled();
    });

    test('up_to_date still runs the tail and reports success', async () => {
        mockPlanFinanceSync.mockResolvedValue({
            window: { mode: 'up_to_date', startDate: null, endDate: null, note: 'utd' },
            chunks: [], latestSyncDate: '2026-07-09',
        });
        const res = await SI._runAsyncFinancePhase({ userId: USER, Region: REGION, Country: COUNTRY, phaseData: {} });
        expect(res.success).toBe(true);
        expect(mockRunFinanceSyncTail).toHaveBeenCalledTimes(1);
        // The window has no dates in this mode; the tail must fall back to the cursor day rather
        // than querying a null range.
        expect(mockRunFinanceSyncTail.mock.calls[0][0].startDate).toBe('2026-07-09');
    });

    test('a tail failure does not un-succeed chunks whose data is already written', async () => {
        mockEngineRows = [engineRow('DONE')];
        mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });
        mockRunFinanceSyncTail.mockRejectedValue(new Error('step2 blew up'));

        const res = await SI._runAsyncFinancePhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: frozenPhaseData({ financeChunkIndex: 2 }),
        });

        expect(res.success).toBe(true);
    });
});

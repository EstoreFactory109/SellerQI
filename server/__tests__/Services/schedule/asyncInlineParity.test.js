/**
 * The async pipeline must fetch the same windows as the inline one.
 *
 * WHY THIS EXISTS
 * A side-by-side review found the async phases silently diverging from inline, each in a way that
 * changed what sellers saw: finance re-checked 0 days instead of 14 (late refunds missed), the
 * SP-API reports phase stored runDate null and so refreshed only when its rows expired (~monthly),
 * ads fetched 30 days instead of 15, and sched_ads' poll state leaked into sched_batch_4 so its
 * inline step (negativeKeywords) never ran. No test compared the paths, which is how all four went
 * unnoticed. These pin the async side to the shared definitions.
 */

// Same import-time workaround as adsAsyncPhase.test.js.
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

const mockRunAsyncAdsReports = jest.fn();
jest.mock('../../../Services/AmazonAds/asyncReportEngine.js', () => ({
    runAsyncAdsReports: (...a) => mockRunAsyncAdsReports(...a),
    findStuckAdsAccounts: jest.fn(),
    TERMINAL: new Set(['DONE', 'NO_DATA', 'FAILED']),
}));

let mockEngineRows = [];
jest.mock('../../../models/amazon-ads/AsyncReportRequestModel.js', () => ({
    find: () => ({ lean: async () => mockEngineRows }),
    deleteOne: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({}),
}));

const { ScheduledIntegration: SI } = require('../../../Services/schedule/ScheduledIntegration.js');
const { marketplaceTodayStr, marketplaceYesterdayStr, addDaysToDateStr } = require('../../../utils/marketplaceTimezone.js');

const USER = '507f1f77bcf86cd799439011';
const REGION = 'NA';
const COUNTRY = 'US';

const svc = (serviceName) => ({
    serviceName,
    buildSpecs: jest.fn((args) => [{ service: serviceName, paramsKey: 'k', params: args.startDate ? { startDate: args.startDate, endDate: args.endDate } : {} }]),
    saveFromRows: jest.fn(async () => ({ documentsSaved: 1 })),
});

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
    jest.clearAllMocks();
    mockEngineRows = [];
    mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });
    jest.spyOn(SI, '_prepareForBatchPhase').mockResolvedValue({
        AccessToken: 'sp', RefreshToken: 'rt', AdsAccessToken: 'ads', AdsRefreshToken: 'art', ProfileId: 'p1',
    });
    jest.spyOn(SI, '_logApiResultsToSession').mockResolvedValue(undefined);
    jest.spyOn(SI, '_writePhaseSlices').mockResolvedValue(undefined);
});

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
});

describe('shared windows', () => {
    test('the ads window is ADS_RESYNC_DAYS (15) days ending the marketplace\'s yesterday', () => {
        const w = SI._adsResyncWindow(COUNTRY);
        expect(w.endDate).toBe(marketplaceYesterdayStr(COUNTRY));
        expect(w.startDate).toBe(addDaysToDateStr(w.endDate, -14));
    });
});

describe('phase wiring — async phases receive the inline windows', () => {
    beforeEach(() => {
        process.env.ADS_ASYNC_ENABLED = 'true';
        delete process.env.ADS_ASYNC_USER_IDS;
        process.env.FINANCE_ASYNC_ENABLED = 'true';
        delete process.env.FINANCE_ASYNC_USER_IDS;
    });

    test('sched_ads passes the shared 15-day window', async () => {
        const spy = jest.spyOn(SI, '_runAsyncAdsPhase').mockResolvedValue({ success: true });
        await SI.executeScheduledAdsPhaseAsync(USER, REGION, COUNTRY, {});
        expect(spy.mock.calls[0][0].dateRange).toEqual(SI._adsResyncWindow(COUNTRY));
    });

    test('sched_batch_4 passes the shared 15-day window', async () => {
        const spy = jest.spyOn(SI, '_runAsyncAdsPhase').mockResolvedValue({ success: true });
        await SI.executeScheduledBatch4Phase(USER, REGION, COUNTRY, {});
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0][0].dateRange).toEqual(SI._adsResyncWindow(COUNTRY));
    });

    test('sched_batch_1_2 names its run by the marketplace\'s today', async () => {
        const spy = jest.spyOn(SI, '_runAsyncAdsPhase').mockResolvedValue({ success: true });
        await SI.executeScheduledBatch1And2Phase(USER, REGION, COUNTRY, {});
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0][0].runDate).toBe(marketplaceTodayStr(COUNTRY));
    });

    test('sched_finance passes the same sync window as inline (resync 14 / max 14 / backfill 30)', async () => {
        const spy = jest.spyOn(SI, '_runAsyncFinancePhase').mockResolvedValue({ success: true });
        await SI.executeScheduledFinancePhase(USER, REGION, COUNTRY, {});
        expect(spy.mock.calls[0][0]).toMatchObject({ resyncDays: 14, maxIncrementalDays: 14, backfillDays: 30 });
    });
});

describe('_runAsyncAdsPhase — run date', () => {
    test('an explicit runDate is what the engine rows are scoped by', async () => {
        await SI._runAsyncAdsPhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: {}, group: 'sched_batch_1_2',
            services: [svc('strandedInventoryData')], runDate: '2026-11-17', integration: 'SP-API',
        });
        expect(mockRunAsyncAdsReports.mock.calls[0][0].runDate).toBe('2026-11-17');
    });

    test('with no runDate anywhere it refuses to submit instead of sharing rows across days', async () => {
        const res = await SI._runAsyncAdsPhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: {}, group: 'sched_batch_1_2',
            services: [svc('strandedInventoryData')], integration: 'SP-API',
        });
        expect(mockRunAsyncAdsReports).not.toHaveBeenCalled();
        expect(res.success).toBe(false);
        expect(res.dataForNextPhase.apiResults.strandedInventoryData.success).toBe(false);
    });

    test('the run date is frozen across poll ticks — a tick after midnight does not resubmit', async () => {
        mockRunAsyncAdsReports.mockResolvedValue({ done: false, reschedule: { delayMs: 1, pollAttempt: 1 } });
        const first = await SI._runAsyncAdsPhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: {}, group: 'sched_batch_1_2',
            services: [svc('strandedInventoryData')], runDate: '2026-11-17', integration: 'SP-API',
        });
        expect(first.dataForNextPhase.adsRunDate).toBe('2026-11-17');

        await SI._runAsyncAdsPhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: first.dataForNextPhase, group: 'sched_batch_1_2',
            services: [svc('strandedInventoryData')], runDate: '2026-11-18', integration: 'SP-API',
        });
        expect(mockRunAsyncAdsReports.mock.calls[1][0].runDate).toBe('2026-11-17');
    });
});

describe('_runAsyncAdsPhase — poll state does not leak into the next phase', () => {
    test('a finished phase resets the poll state it carried', async () => {
        mockEngineRows = [{ service: 'ppcMetricsAggregated', status: 'DONE', paramsKey: 'k' }];
        const res = await SI._runAsyncAdsPhase({
            userId: USER, Region: REGION, Country: COUNTRY,
            phaseData: { adsAsyncStarted: true, adsPollAttempt: 4, adsRunDate: '2026-11-16', adsInlineResults: { x: 1 } },
            group: 'sched_ads', services: [svc('ppcMetricsAggregated')], dateRange: { startDate: '2026-11-02', endDate: '2026-11-16' },
        });
        expect(res.dataForNextPhase).toMatchObject({ adsAsyncStarted: false, adsPollAttempt: 0, adsInlineResults: null, adsRunDate: null });
    });

    test('the next phase therefore runs its inline step on its first tick', async () => {
        // phaseData as sched_batch_4 receives it after sched_ads finished.
        mockEngineRows = [{ service: 'ppcMetricsAggregated', status: 'DONE', paramsKey: 'k' }];
        const adsDone = await SI._runAsyncAdsPhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: { adsAsyncStarted: true },
            group: 'sched_ads', services: [svc('ppcMetricsAggregated')], dateRange: { startDate: '2026-11-02', endDate: '2026-11-16' },
        });

        const inline = jest.fn(async () => ({ negativeKeywords: { success: true } }));
        mockRunAsyncAdsReports.mockResolvedValue({ done: false, reschedule: { delayMs: 1, pollAttempt: 1 } });
        await SI._runAsyncAdsPhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: { ...adsDone.dataForNextPhase },
            group: 'sched_batch_4', services: [svc('searchKeywords')], inlineOnFirstTick: inline,
            dateRange: { startDate: '2026-11-02', endDate: '2026-11-16' },
        });
        expect(inline).toHaveBeenCalledTimes(1);
    });
});

describe('_runAsyncAdsPhase — missing token records a result per service, like inline', () => {
    test('a failed Ads exchange records failures, so the day retries', async () => {
        process.env.CREDENTIAL_SKIP_MODE = 'on';
        SI._prepareForBatchPhase.mockResolvedValue({ AdsAccessToken: null, AdsRefreshToken: 'art', ProfileId: 'p1' });
        const res = await SI._runAsyncAdsPhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: {}, group: 'sched_ads',
            services: [svc('ppcMetricsAggregated'), svc('ppcSpendsBySKU')], dateRange: SI._adsResyncWindow(COUNTRY),
        });
        const r = res.dataForNextPhase.apiResults;
        expect(r.ppcMetricsAggregated).toMatchObject({ success: false });
        expect(r.ppcMetricsAggregated.skipped).toBeUndefined();
        expect(SI._canMarkDailyComplete({ financeSync: { success: true }, ...r }).canMarkComplete).toBe(false);
    });

    test('Ads never connected records skipped (under on), so the day can stamp', async () => {
        process.env.CREDENTIAL_SKIP_MODE = 'on';
        SI._prepareForBatchPhase.mockResolvedValue({ AdsAccessToken: null, AdsRefreshToken: null, ProfileId: null });
        const res = await SI._runAsyncAdsPhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: {}, group: 'sched_ads',
            services: [svc('ppcMetricsAggregated'), svc('ppcSpendsBySKU')], dateRange: SI._adsResyncWindow(COUNTRY),
        });
        const r = res.dataForNextPhase.apiResults;
        expect(r.ppcMetricsAggregated).toMatchObject({ success: false, skipped: true, reason: 'ads_not_connected' });
        expect(SI._canMarkDailyComplete({ financeSync: { success: true }, ...r }).canMarkComplete).toBe(true);
    });
});

describe('_runAsyncAdsPhase — SP-API phases are judged by their own services', () => {
    test('sched_batch_1_2 succeeds when its reports landed (it has no ads keys)', async () => {
        mockEngineRows = [{ service: 'strandedInventoryData', status: 'DONE', paramsKey: 'k' }];
        const res = await SI._runAsyncAdsPhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: {}, group: 'sched_batch_1_2',
            services: [svc('strandedInventoryData')], runDate: '2026-11-17', integration: 'SP-API',
        });
        expect(res.success).toBe(true);
        expect(res.error).toBeNull();
    });

    test('and fails with an SP-API message when none did', async () => {
        mockEngineRows = [{ service: 'strandedInventoryData', status: 'FAILED', paramsKey: 'k' }];
        const res = await SI._runAsyncAdsPhase({
            userId: USER, Region: REGION, Country: COUNTRY, phaseData: {}, group: 'sched_batch_1_2',
            services: [svc('strandedInventoryData')], runDate: '2026-11-17', integration: 'SP-API',
        });
        expect(res.success).toBe(false);
        expect(res.error).toBe('No SP-API reports returned data');
    });
});

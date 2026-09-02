/**
 * Batch 5 (`sched_calc_review`) must compute the dashboard ONCE and share it.
 *
 * THE BUG THIS CLOSES
 * `issueSummary`, `productIssues` and `issuesData` each ran the WHOLE pipeline themselves —
 * `AnalyseService.Analyse()` then `analyseData()` — and their promises are created eagerly at
 * setup, so all three ran CONCURRENTLY. issueSummary keeps six integers out of that result,
 * productIssues keeps one array; only issuesData uses most of it. So ~25 collection loads and a
 * full DashboardCalculation, three times over, two-thirds of it discarded.
 *
 * On 2026-09-01 that stopped being merely wasteful. One PRO account's newest sponsored-ads batch
 * reached 234,035 rows / 102 MB — legitimate 30-day data, verified 1.00x on the full natural key,
 * NOT duplicates — which is ~300-400 MB per copy as lean JS objects. Three concurrent copies plus
 * the other 24 collections exceeded the 1536 MB heap cap; the worker GC-thrashed, so
 * `fetchAllDataModels` never returned, nothing threw, and BullMQ stall-reclaimed the job every
 * 20 minutes forever. The account had not completed a run in over a week.
 *
 * One copy fits comfortably. That is the entire fix.
 */

// The global setup mocks `axios` without `interceptors`, which makes axios-retry throw at import
// time inside ScheduledIntegration's require graph.
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

const mockAnalyse = jest.fn();
const mockAnalyseData = jest.fn();
const mockStoreIssueSummary = jest.fn();
const mockStoreProductIssues = jest.fn();
const mockStoreIssuesData = jest.fn();

jest.mock('../../../Services/main/Analyse.js', () => ({
    AnalyseService: { Analyse: (...a) => mockAnalyse(...a) },
}));
jest.mock('../../../Services/Calculations/DashboardCalculation.js', () => ({
    analyseData: (...a) => mockAnalyseData(...a),
}));
jest.mock('../../../Services/Calculations/IssueSummaryService.js', () => ({
    calculateAndStoreIssueSummary: jest.fn(),
    storeIssueSummaryFromDashboardData: (...a) => mockStoreIssueSummary(...a),
}));
jest.mock('../../../Services/Calculations/ProductIssuesService.js', () => ({
    calculateAndStoreProductIssues: jest.fn(),
    storeProductIssuesFromDashboardData: (...a) => mockStoreProductIssues(...a),
}));
jest.mock('../../../Services/Calculations/IssuesDataService.js', () => ({
    calculateAndStoreIssuesData: jest.fn(),
    storeIssuesDataFromDashboard: (...a) => mockStoreIssuesData(...a),
}));

const { ScheduledIntegration: SI } = require('../../../Services/schedule/ScheduledIntegration.js');

const DASHBOARD = { totalErrorInAccount: 7, productWiseError: [{ asin: 'B1' }] };

/**
 * Run ONLY batch 5, with no API context — the calculators need none.
 *
 * dayOfWeek 0 (Sunday) on purpose: getFunctionsForDay schedules `issueSummary` and `issuesData`
 * ONLY on Sunday, while `productIssues` runs daily. So Sunday is the single day all three are
 * live at once — i.e. the only day the 3x duplication this fix removes actually occurred.
 */
function runBatch5(dayOfWeek = 0) {
    return SI.fetchScheduledApiData({
        userId: '507f1f77bcf86cd799439011',
        Country: 'US',
        Region: 'NA',
        marketplaceIds: ['ATVPDKIKX0DER'],
        productData: { asinArray: [], skuArray: [], ProductDetails: [] },
        dataToSend: {},
        loggingHelper: null,
        dayOfWeek,
        _batchFilter: [5],
    });
}

beforeEach(() => {
    mockAnalyse.mockReset().mockResolvedValue({ status: 200, message: { raw: true } });
    mockAnalyseData.mockReset().mockResolvedValue({ dashboardData: DASHBOARD });
    mockStoreIssueSummary.mockReset().mockResolvedValue({ success: true });
    mockStoreProductIssues.mockReset().mockResolvedValue({ success: true });
    mockStoreIssuesData.mockReset().mockResolvedValue({ success: true });
});

describe('the expensive pipeline runs once, not three times', () => {
    // THE REGRESSION TEST. Three runs is the bug; one is the fix.
    test('Analyse and analyseData are each called exactly ONCE for all three services', async () => {
        await runBatch5();

        expect(mockAnalyse).toHaveBeenCalledTimes(1);
        expect(mockAnalyseData).toHaveBeenCalledTimes(1);
    });

    test('all three storers still run', async () => {
        await runBatch5();

        expect(mockStoreIssueSummary).toHaveBeenCalledTimes(1);
        expect(mockStoreProductIssues).toHaveBeenCalledTimes(1);
        expect(mockStoreIssuesData).toHaveBeenCalledTimes(1);
    });

    // Sharing is the point — three separate equal-looking objects would mean three computations.
    test('every storer receives the SAME object instance, not a copy', async () => {
        await runBatch5();

        const a = mockStoreIssueSummary.mock.calls[0][3];
        const b = mockStoreProductIssues.mock.calls[0][3];
        const c = mockStoreIssuesData.mock.calls[0][3];
        expect(a).toBe(DASHBOARD);
        expect(b).toBe(a);
        expect(c).toBe(a);
    });

    test('storers are called with (userId, country, region, dashboardData, source)', async () => {
        await runBatch5();

        expect(mockStoreIssueSummary).toHaveBeenCalledWith(
            '507f1f77bcf86cd799439011', 'US', 'NA', DASHBOARD, 'schedule');
    });
});

describe('failures stay contained', () => {
    // Matches the shape Integration.js already uses: one storer failing must not lose the others.
    test('one storer throwing does not stop the other two', async () => {
        mockStoreProductIssues.mockRejectedValue(new Error('write failed'));

        await runBatch5();

        expect(mockStoreIssueSummary).toHaveBeenCalledTimes(1);
        expect(mockStoreIssuesData).toHaveBeenCalledTimes(1);
    });

    // If the shared computation fails there is nothing to store, but the phase must not hang or
    // throw out of fetchScheduledApiData — the pipeline advances and finalize closes the run.
    test('a failed computation is recorded, not thrown', async () => {
        mockAnalyse.mockResolvedValue({ status: 500, message: null });

        const apiData = await runBatch5();

        expect(mockStoreIssueSummary).not.toHaveBeenCalled();
        expect(apiData.issueSummary?.success).toBe(false);
    });

    // The computation must not be retried per-service on failure either — that would restore the
    // 3x cost on exactly the accounts already struggling.
    test('a failed computation is attempted once, not once per service', async () => {
        mockAnalyseData.mockRejectedValue(new Error('heap exhausted'));

        await runBatch5();

        expect(mockAnalyse).toHaveBeenCalledTimes(1);
        expect(mockAnalyseData).toHaveBeenCalledTimes(1);
    });
});

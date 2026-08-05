/**
 * Tests for _runAsyncAdsPhase's failure reporting, and for the finalize gate that consumes it.
 *
 * WHY THIS EXISTS
 * The terminal block called `saveFromRows` and then threw its outcome away three separate ways: the
 * `{documentsSaved}` return was discarded, the throw was caught and logged as `${err.message}` (no
 * Error object, so no stack), and `success` was computed purely from report status. So the two ads
 * services whose ONLY route to Mongo is `saveFromRows` — `ppcMetricsAggregated` and `ppcSpendsBySKU` —
 * could fail to persist anything at all and the phase would still report `success: true`, finalize
 * would stamp `lastDailyUpdate`, and the account would skip itself for the rest of the day.
 *
 * That made a soak test worthless: a broken save would have looked fine. These tests are the
 * regression net for it.
 */

// The global setup mocks `axios` with an object that has no `interceptors`, which makes axios-retry
// throw at import time somewhere in ScheduledIntegration's require graph.
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
}));

const logger = require('../../../utils/Logger.js');
const { ScheduledIntegration: SI } = require('../../../Services/schedule/ScheduledIntegration.js');

const USER = '507f1f77bcf86cd799439011';
const REGION = 'NA';
const COUNTRY = 'US';

/** A service whose saveFromRows behaviour the test controls. */
function svc(serviceName, saveImpl) {
    return {
        serviceName,
        buildSpecs: () => [{ service: serviceName, paramsKey: 'k', params: { endDate: '2026-07-20' } }],
        saveFromRows: jest.fn(saveImpl || (async () => ({ documentsSaved: 1 }))),
    };
}

const row = (service, status, extra = {}) => ({ service, status, paramsKey: 'k', ...extra });

async function runPhase(services) {
    return SI._runAsyncAdsPhase({
        userId: USER, Region: REGION, Country: COUNTRY,
        phaseData: { adsAsyncStarted: true },
        group: 'sched_ads',
        services,
    });
}

let errorSpy;

beforeEach(() => {
    jest.clearAllMocks();
    mockEngineRows = [];
    mockRunAsyncAdsReports.mockResolvedValue({ done: true, summary: {} });
    jest.spyOn(SI, '_prepareForBatchPhase').mockResolvedValue({
        AdsAccessToken: 'tok', ProfileId: 'profile-1',
    });
    jest.spyOn(SI, '_logApiResultsToSession').mockResolvedValue(undefined);
    jest.spyOn(SI, '_writePhaseSlices').mockResolvedValue(undefined);
    // Spied rather than relying on a global mock: these tests assert on what was PASSED to the
    // logger (an Error instance, not a string), which is the whole point of one of them.
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
    if (errorSpy) errorSpy.mockRestore();
});

describe('_runAsyncAdsPhase — a failed save is reported, not swallowed', () => {
    test('a throwing save reports success:false and flags dataLoss', async () => {
        mockEngineRows = [row('ppcMetricsAggregated', 'DONE')];
        const s = svc('ppcMetricsAggregated', async () => { throw new Error('mongo write failed'); });

        const res = await runPhase([s]);

        expect(res.dataForNextPhase.apiResults.ppcMetricsAggregated).toMatchObject({
            success: false,
            dataLoss: true,
        });
        expect(res.dataForNextPhase.apiResults.ppcMetricsAggregated.error).toMatch(/save failed/);
    });

    test('the ERROR OBJECT reaches the logger, so the stack survives', async () => {
        // Invisible to every other assertion, and the single most important line in the fix: logging
        // `${err.message}` is what cost three rounds of diagnosis on the finance side.
        mockEngineRows = [row('ppcMetricsAggregated', 'DONE')];
        await runPhase([svc('ppcMetricsAggregated', async () => { throw new Error('boom'); })]);

        const passedAnError = errorSpy.mock.calls.some((call) => call.some((a) => a instanceof Error));
        expect(passedAnError).toBe(true);
    });

    test('a successful save reports success:true with no dataLoss', async () => {
        mockEngineRows = [row('ppcMetricsAggregated', 'DONE')];
        const res = await runPhase([svc('ppcMetricsAggregated')]);

        expect(res.dataForNextPhase.apiResults.ppcMetricsAggregated).toEqual({ success: true, error: null });
    });

    test('NO_DATA is not a failure — the save still runs and success stays true', async () => {
        // Parity with the inline path: an account with no campaigns of that type legitimately has
        // nothing, and that is a real measurement worth persisting as zero.
        mockEngineRows = [row('ppcMetricsAggregated', 'NO_DATA')];
        const s = svc('ppcMetricsAggregated');

        const res = await runPhase([s]);

        expect(s.saveFromRows).toHaveBeenCalled();
        expect(res.dataForNextPhase.apiResults.ppcMetricsAggregated.success).toBe(true);
        expect(res.dataForNextPhase.apiResults.ppcMetricsAggregated.dataLoss).toBeUndefined();
    });

    test('every report FAILED: the save is NOT called, and dataLoss is NOT set', async () => {
        // Nothing was measured, so nothing was lost — success:false already carries it, and calling a
        // save with only failures is one refactor away from writing zeros over good data.
        mockEngineRows = [row('ppcMetricsAggregated', 'FAILED'), row('ppcMetricsAggregated', 'FAILED')];
        const s = svc('ppcMetricsAggregated');

        const res = await runPhase([s]);

        expect(s.saveFromRows).not.toHaveBeenCalled();
        expect(res.dataForNextPhase.apiResults.ppcMetricsAggregated.success).toBe(false);
        expect(res.dataForNextPhase.apiResults.ppcMetricsAggregated.dataLoss).toBeUndefined();
    });

    test('one service`s save failing does not un-succeed a sibling that worked', async () => {
        // Advance-on-failure is preserved: the phase still reports success overall, but the failing
        // service carries dataLoss so the finalize gate can act on it.
        mockEngineRows = [row('ppcMetricsAggregated', 'DONE'), row('ppcSpendsBySKU', 'DONE')];
        const bad = svc('ppcMetricsAggregated', async () => { throw new Error('nope'); });
        const good = svc('ppcSpendsBySKU');

        const res = await runPhase([bad, good]);

        expect(res.success).toBe(true);
        expect(res.dataForNextPhase.apiResults.ppcSpendsBySKU.success).toBe(true);
        expect(res.dataForNextPhase.apiResults.ppcMetricsAggregated.dataLoss).toBe(true);
    });

    test('a revoked Amazon Ads grant is named explicitly', async () => {
        mockEngineRows = [
            row('ppcMetricsAggregated', 'FAILED', { authRevoked: true, note: '401 Missing rights' }),
            row('ppcMetricsAggregated', 'FAILED', { authRevoked: true }),
        ];
        const res = await runPhase([svc('ppcMetricsAggregated')]);

        expect(res.dataForNextPhase.apiResults.ppcMetricsAggregated.error).toMatch(/revoked/i);
        const said = errorSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
        expect(said).toMatch(/RE-AUTHORIZE/);
    });
});

/**
 * The gate that decides whether the account is marked done for the day. Extracted from
 * executeScheduledFinalizePhase purely so it can be driven directly — the enclosing phase is far too
 * large to stand up in a test, which is why this rule went unverified for so long.
 */
describe('_canMarkDailyComplete', () => {
    const ok = { success: true };

    test('finance ok + at least one ads service ok => stamp', () => {
        expect(SI._canMarkDailyComplete({ financeSync: ok, ppcSpendsBySKU: ok }).canMarkComplete).toBe(true);
    });

    test('dataLoss BLOCKS the stamp even when a sibling ads service succeeded', () => {
        // The whole point of the dataLoss signal, and the case that fails against the old code. No
        // later run fills this hole: the engine rows are terminal and tomorrow's run covers tomorrow.
        const res = SI._canMarkDailyComplete({
            financeSync: ok,
            ppcSpendsBySKU: ok,
            ppcMetricsAggregated: { success: false, dataLoss: true },
        });
        expect(res.canMarkComplete).toBe(false);
        expect(res.adsDataLoss).toBe(true);
    });

    test('the SAME shape without dataLoss still stamps — `some`, not `every`', () => {
        // Deliberate: one permanently-broken ads service must not starve the other three, which is the
        // starvation pattern already fixed twice on the finance side.
        expect(SI._canMarkDailyComplete({
            financeSync: ok,
            ppcSpendsBySKU: ok,
            ppcMetricsAggregated: { success: false },
        }).canMarkComplete).toBe(true);
    });

    test('no ads service ran at all => ads are not blocking', () => {
        expect(SI._canMarkDailyComplete({ financeSync: ok }).canMarkComplete).toBe(true);
    });

    test('finance failing blocks regardless of ads', () => {
        expect(SI._canMarkDailyComplete({ financeSync: { success: false }, ppcSpendsBySKU: ok }).canMarkComplete).toBe(false);
    });

    test('every ads service failing blocks', () => {
        expect(SI._canMarkDailyComplete({
            financeSync: ok,
            ppcSpendsBySKU: { success: false },
            ppcMetricsAggregated: { success: false },
        }).canMarkComplete).toBe(false);
    });

    test('a missing/empty apiResults does not throw', () => {
        expect(() => SI._canMarkDailyComplete(undefined)).not.toThrow();
        expect(SI._canMarkDailyComplete(undefined).canMarkComplete).toBe(false);  // finance not ok
    });
});

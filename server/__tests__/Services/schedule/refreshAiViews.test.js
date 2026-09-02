/**
 * Tests for ScheduledIntegration.refreshAiViews — when the two stored AI views
 * (top opportunities, top products) get regenerated on a scheduled run.
 *
 * The bug this guards against is silent and expensive in both directions:
 *
 *   1. Trigger too rarely and a stored view describes tasks that weekly renewal has
 *      already deleted. Renewal is a rolling per-account 7-day timer, so it lands on
 *      any weekday; a Sunday-only trigger left most accounts stale for days while the
 *      Tasks page (computed live) showed the truth — the two disagreeing on money.
 *   2. Trigger too often and every account pays for an extra OpenAI call each week,
 *      for data that only changes at renewal.
 *
 * So both the fire and the no-fire cases are asserted, not just the happy path.
 */

// Mirrors financeAsyncPhase.test.js: the global setup mocks `axios` without
// `interceptors`, which makes axios-retry throw while requiring ScheduledIntegration.
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
jest.mock('../../../Services/AmazonAds/asyncReportEngine.js', () => ({
    runAsyncAdsReports: jest.fn(),
    findStuckAdsAccounts: jest.fn(),
    TERMINAL: new Set(['DONE', 'NO_DATA', 'FAILED']),
}));
jest.mock('../../../models/amazon-ads/AsyncReportRequestModel.js', () => ({
    find: () => ({ lean: async () => [] }),
    deleteOne: jest.fn(),
}));
jest.mock('../../../models/finance/FinanceSyncLogModel.js', () => ({}));

const mockTopOpportunities = jest.fn();
const mockTopProducts = jest.fn();
jest.mock('../../../Services/AI/TopOpportunitiesService.js', () => ({
    calculateAndStoreTopOpportunities: (...a) => mockTopOpportunities(...a),
}));
jest.mock('../../../Services/AI/TopProductsService.js', () => ({
    calculateAndStoreTopProducts: (...a) => mockTopProducts(...a),
}));

const { ScheduledIntegration: SI } = require('../../../Services/schedule/ScheduledIntegration.js');

const SUNDAY = 0;
const WEDNESDAY = 3;
const call = (opts) => SI.refreshAiViews('u1', 'AU', 'FE', opts);

describe('ScheduledIntegration.refreshAiViews', () => {
    beforeEach(() => {
        mockTopOpportunities.mockReset().mockResolvedValue({ success: true, data: {} });
        mockTopProducts.mockReset().mockResolvedValue({ success: true, data: {} });
    });

    describe('when to fire', () => {
        it('fires on a task rebuild, whatever the weekday', async () => {
            await call({ tasksRebuilt: true, dayOfWeek: WEDNESDAY });

            expect(mockTopOpportunities).toHaveBeenCalledTimes(1);
            expect(mockTopProducts).toHaveBeenCalledTimes(1);
        });

        // The core regression: an insert-only run changes nothing the views summarise,
        // so paying for two OpenAI calls would be pure waste.
        it('stays silent on an ordinary day with no rebuild', async () => {
            await call({ tasksRebuilt: false, dayOfWeek: WEDNESDAY });

            expect(mockTopOpportunities).not.toHaveBeenCalled();
            expect(mockTopProducts).not.toHaveBeenCalled();
        });

        it('fires on Sunday without a rebuild, as the stale-view net', async () => {
            await call({ tasksRebuilt: false, dayOfWeek: SUNDAY });

            expect(mockTopOpportunities).toHaveBeenCalledTimes(1);
        });
    });

    describe('throttle window handed to the services', () => {
        const windowOf = (mock) => mock.mock.calls[0][4].minIntervalHours;

        it('waives the throttle entirely on a rebuild', async () => {
            await call({ tasksRebuilt: true, dayOfWeek: WEDNESDAY });

            // Anything above 0 would let the service skip on a recent api_fallback
            // generation, leaving the view describing tasks renewal just deleted.
            expect(windowOf(mockTopOpportunities)).toBe(0);
            expect(windowOf(mockTopProducts)).toBe(0);
        });

        it('uses a window wider than 144h for the Sunday net', async () => {
            await call({ tasksRebuilt: false, dayOfWeek: SUNDAY });

            // 144h is the widest gap between a rebuild and the next Sunday sweep (an
            // account renewing on Monday). At or below it, the net would regenerate a
            // view that is already current and double the weekly spend.
            expect(windowOf(mockTopOpportunities)).toBeGreaterThan(144);
            expect(windowOf(mockTopProducts)).toBeGreaterThan(144);
        });

        it('passes source "schedule" so the services log the right origin', async () => {
            await call({ tasksRebuilt: true, dayOfWeek: WEDNESDAY });

            expect(mockTopOpportunities.mock.calls[0].slice(0, 4)).toEqual(['u1', 'AU', 'FE', 'schedule']);
        });
    });

    describe('failure isolation', () => {
        it('does not throw when a service rejects', async () => {
            mockTopOpportunities.mockRejectedValue(new Error('OpenAI 500'));

            await expect(call({ tasksRebuilt: true, dayOfWeek: WEDNESDAY })).resolves.toBeUndefined();
        });

        it('still runs top products after top opportunities throws', async () => {
            mockTopOpportunities.mockRejectedValue(new Error('OpenAI 500'));

            await call({ tasksRebuilt: true, dayOfWeek: WEDNESDAY });

            // One view failing must not silently cost the seller the other.
            expect(mockTopProducts).toHaveBeenCalledTimes(1);
        });

        it('does not throw when a service reports success:false', async () => {
            mockTopProducts.mockResolvedValue({ success: false, error: 'no tasks' });

            await expect(call({ tasksRebuilt: true, dayOfWeek: WEDNESDAY })).resolves.toBeUndefined();
        });
    });
});

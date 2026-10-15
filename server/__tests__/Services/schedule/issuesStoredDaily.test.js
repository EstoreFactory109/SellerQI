/**
 * The Issues pages (IssuesDataChunks) and the dashboard issue counts (IssueSummary) were
 * stored on Sundays only while tasks changed daily, so the same question got different
 * answers on different pages for up to six days.
 */
// ScheduleConfig loads every registered service; same axios-retry stub as
// calcReviewComputeOnce.test.js.
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

const { getFunctionsForDay } = require('../../../Services/schedule/ScheduleConfig.js');

describe('issue storers run every day', () => {
    it.each([0, 1, 2, 3, 4, 5, 6])('day %i schedules issueSummary, issuesData and productIssues', (day) => {
        const fns = getFunctionsForDay(day);
        expect(fns).toHaveProperty('issueSummary');
        expect(fns).toHaveProperty('issuesData');
        expect(fns).toHaveProperty('productIssues');
    });

    it('keeps them as calculation services, ordered after productIssues', () => {
        const fns = getFunctionsForDay(2);
        expect(fns.issueSummary.isCalculationService).toBe(true);
        expect(fns.issuesData.isCalculationService).toBe(true);
        expect(fns.issuesData.runOrder).toBeGreaterThan(fns.issueSummary.runOrder);
    });
});

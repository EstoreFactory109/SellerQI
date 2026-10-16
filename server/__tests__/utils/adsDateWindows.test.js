/**
 * Ads date windows: marketplace-local, DST-aware, exactly N days.
 *
 * WHY THIS EXISTS
 * The ads pipeline used a fixed UTC-7 offset for "Pacific yesterday", which is an hour off all winter
 * (PST is UTC-8) and wrong for EU/FE marketplaces, and PPCMetrics.rollupLastDays used the SERVER's
 * local clock and covered N+1 days. These pin the replacement: utils/marketplaceTimezone.js for the day,
 * yesterday−(N−1) … yesterday for the window.
 */

const { getDefaultReportDateRange, resolveReportDateRange } = require('../../utils/reportDateRange.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');

// 07:30 UTC on Jan 15 is 23:30 PST on Jan 14 — the old fixed UTC-7 offset read it as 00:30 Jan 15.
const WINTER_NIGHT = new Date('2026-01-15T07:30:00Z');
// 22:30 UTC on Jul 15 is 00:30 on Jul 16 in Berlin.
const BERLIN_PAST_MIDNIGHT = new Date('2026-07-15T22:30:00Z');

describe('getDefaultReportDateRange', () => {
    test('US in winter uses PST, not a fixed UTC-7 offset', () => {
        const r = getDefaultReportDateRange(30, 'US', WINTER_NIGHT);
        expect(r.endDate).toBe('2026-01-13');   // fixed UTC-7 would say 2026-01-14
    });

    test('covers exactly lookbackDays days, both ends inclusive', () => {
        const r = getDefaultReportDateRange(30, 'US', WINTER_NIGHT);
        expect(r.startDate).toBe('2025-12-15');
        const days = (Date.parse(r.endDate) - Date.parse(r.startDate)) / 86400000 + 1;
        expect(days).toBe(30);
    });

    test('an EU marketplace uses its own day', () => {
        expect(getDefaultReportDateRange(30, 'DE', BERLIN_PAST_MIDNIGHT).endDate).toBe('2026-07-15');
        // The same instant is still Jul 15 in Los Angeles, so its yesterday is Jul 14.
        expect(getDefaultReportDateRange(30, 'US', BERLIN_PAST_MIDNIGHT).endDate).toBe('2026-07-14');
    });

    test('no country defaults to US / Pacific', () => {
        expect(getDefaultReportDateRange(30, undefined, WINTER_NIGHT))
            .toEqual(getDefaultReportDateRange(30, 'US', WINTER_NIGHT));
    });

    test('resolveReportDateRange passes explicit dates through and uses the country for the default', () => {
        expect(resolveReportDateRange({ startDate: '2026-01-01', endDate: '2026-01-05', country: 'DE' }))
            .toEqual({ startDate: '2026-01-01', endDate: '2026-01-05', isCustom: true });
        const r = resolveReportDateRange({ country: 'US', lookbackDays: 15 });
        expect(r.isCustom).toBe(false);
        expect((Date.parse(r.endDate) - Date.parse(r.startDate)) / 86400000 + 1).toBe(15);
    });
});

describe('PPCMetrics.rollupLastDays', () => {
    let spy;
    beforeEach(() => {
        spy = jest.spyOn(PPCMetrics, 'calculateMetricsForDateRange').mockResolvedValue({ found: true });
    });

    test('reads exactly N days ending on the marketplace yesterday', async () => {
        await PPCMetrics.rollupLastDays('u1', 'US', 'NA', 30, WINTER_NIGHT);
        expect(spy).toHaveBeenCalledWith('u1', 'US', 'NA', '2025-12-15', '2026-01-13');
    });

    test('uses the marketplace timezone, not the server clock', async () => {
        await PPCMetrics.rollupLastDays('u1', 'DE', 'EU', 7, BERLIN_PAST_MIDNIGHT);
        expect(spy).toHaveBeenCalledWith('u1', 'DE', 'EU', '2026-07-09', '2026-07-15');
    });
});

/**
 * Tests for the PPC-metrics partial-save protection.
 *
 * WHY THIS EXISTS
 * `PPCMetricsModel.upsertMetricsForDate` writes a WHOLE-DOC `$set` (`{...metricsData}`), and
 * `buildDailyMetricsDocuments` starts every day from an all-zero breakdown and fills in only the
 * campaign types it actually has. So writing a doc built from SP+SB while SD FAILED overwrote the
 * stored `sponsoredDisplay` figures with ZEROS — and zeroed SD's share of
 * totalSpend/totalSales/acos/roas along with them. Ad spend silently under-reported for every
 * affected day, on both the inline and async paths.
 *
 * The distinction that makes the fix correct, and which both directions below pin:
 *   - a type that is usable but empty  -> legitimately writes zeros (a real "no spend" day)
 *   - a type that FAILED               -> keeps whatever is already stored
 * Conflating them in EITHER direction is a bug. Treat failed-as-empty and you destroy real data;
 * treat empty-as-failed and stale rows survive forever and over-report spend. Both tests must stay,
 * or a later "simplification" collapses them back into one wrong behaviour.
 */

const mockUpsert = jest.fn();
const mockFindByMetricDate = jest.fn();
jest.mock('../../../models/amazon-ads/PPCMetricsModel', () => ({
    upsertMetricsForDate: (...a) => mockUpsert(...a),
    findByMetricDate: (...a) => mockFindByMetricDate(...a),
}));

const {
    mergeDailyMetricsDoc,
    upsertDailyMetricsDocs,
    summariseBreakdown,
    savePpcMetricsFromRows,
    CAMPAIGN_TYPES,
} = require('../../../Services/AmazonAds/GetPPCMetrics.js');

const USER = '507f1f77bcf86cd799439011';
const DATE = '2026-07-20';
const ALL_TYPES = Object.keys(CAMPAIGN_TYPES);

/** A per-type breakdown entry with distinctive numbers so a mix-up is obvious. */
const bd = (sales, spend, impressions = 100, clicks = 10, units = 1) => ({
    sales, spend, impressions, clicks, unitsSoldClicks1d: units,
    acos: sales > 0 ? parseFloat(((spend / sales) * 100).toFixed(2)) : 0,
});

/** What buildDailyMetricsDocuments produces when SD is absent (failed OR genuinely empty). */
function freshDocSpSbOnly() {
    const breakdown = {
        sponsoredProducts: bd(100, 10),
        sponsoredBrands: bd(200, 20),
        sponsoredDisplay: bd(0, 0, 0, 0, 0),   // zero-filled — the dangerous part
    };
    return {
        profileId: 'p1',
        dateRange: { startDate: DATE, endDate: DATE },
        summary: summariseBreakdown(breakdown),
        campaignTypeBreakdown: breakdown,
        processedCampaignTypes: ['SPONSORED_PRODUCTS', 'SPONSORED_BRANDS'],
        campaignSummaries: { sponsoredProducts: ['sp'], sponsoredBrands: ['sb'], sponsoredDisplay: [] },
        dateWiseMetrics: [],
    };
}

/** An existing stored doc that already has real SD money in it. */
const existingWithSd = () => ({
    campaignTypeBreakdown: {
        sponsoredProducts: bd(100, 10),
        sponsoredBrands: bd(200, 20),
        sponsoredDisplay: bd(400, 40, 4000, 200, 20),
    },
    campaignSummaries: { sponsoredDisplay: ['sd-previously-stored'] },
    processedCampaignTypes: ['SPONSORED_PRODUCTS', 'SPONSORED_BRANDS', 'SPONSORED_DISPLAY'],
});

beforeEach(() => {
    jest.clearAllMocks();
    mockUpsert.mockResolvedValue({ _id: 'saved-id' });
    mockFindByMetricDate.mockResolvedValue(null);
});

describe('mergeDailyMetricsDoc', () => {
    test('a COMPLETE measurement returns the fresh doc untouched, by identity', () => {
        // The healthy path must be byte-identical to before the fix — no merge, no extra read.
        const fresh = freshDocSpSbOnly();
        expect(mergeDailyMetricsDoc(fresh, existingWithSd(), ALL_TYPES)).toBe(fresh);
    });

    test('THE MONEY TEST: a FAILED type keeps its stored figures, and totals include them again', () => {
        const out = mergeDailyMetricsDoc(
            freshDocSpSbOnly(),
            existingWithSd(),
            ['SPONSORED_PRODUCTS', 'SPONSORED_BRANDS'],   // SD failed
        );

        // The stored SD breakdown survives verbatim instead of being zeroed.
        expect(out.campaignTypeBreakdown.sponsoredDisplay).toEqual(bd(400, 40, 4000, 200, 20));
        // ...and the day's totals are recomputed to INCLUDE it. Without this the doc would claim
        // $30 of spend when the seller actually spent $70.
        expect(out.summary.totalSpend).toBe(70);    // 10 SP + 20 SB + 40 SD
        expect(out.summary.totalSales).toBe(700);   // 100 + 200 + 400
        expect(out.summary.overallAcos).toBe(10);   // 70/700
        expect(out.summary.overallRoas).toBe(10);   // 700/70
        // The per-type campaign summary is preserved too, not blanked.
        expect(out.campaignSummaries.sponsoredDisplay).toEqual(['sd-previously-stored']);
        // And the type is still recorded as having data.
        expect(out.processedCampaignTypes).toContain('SPONSORED_DISPLAY');
    });

    test('THE MIRROR: a type that is USABLE but empty legitimately writes zeros', () => {
        // NO_DATA means the report ran and this account genuinely has no SD spend. Preserving stale
        // rows here would over-report spend forever — the opposite bug.
        const out = mergeDailyMetricsDoc(freshDocSpSbOnly(), existingWithSd(), ALL_TYPES);
        expect(out.campaignTypeBreakdown.sponsoredDisplay).toEqual(bd(0, 0, 0, 0, 0));
        expect(out.summary.totalSpend).toBe(30);   // SD contributes nothing
    });

    test('a FAILED type with NO existing doc keeps the zeros, and does not throw', () => {
        const out = mergeDailyMetricsDoc(freshDocSpSbOnly(), null, ['SPONSORED_PRODUCTS', 'SPONSORED_BRANDS']);
        expect(out.campaignTypeBreakdown.sponsoredDisplay).toEqual(bd(0, 0, 0, 0, 0));
        expect(out.summary.totalSpend).toBe(30);
        // Honest: we have never had SD data for this day, so it is not "preserved".
        expect(out.processedCampaignTypes).not.toContain('SPONSORED_DISPLAY');
    });
});

describe('upsertDailyMetricsDocs', () => {
    const docs = () => [{ metricDate: DATE, ...freshDocSpSbOnly() }];

    test('a complete measurement writes directly and never reads the existing doc', () => {
        return upsertDailyMetricsDocs(USER, 'US', 'NA', docs(), ALL_TYPES).then((res) => {
            expect(mockFindByMetricDate).not.toHaveBeenCalled();
            expect(mockUpsert).toHaveBeenCalledTimes(1);
            expect(res.documentsSaved).toBe(1);
        });
    });

    test('omitting usableTypes defaults to "all" — i.e. the old unguarded behaviour', async () => {
        await upsertDailyMetricsDocs(USER, 'US', 'NA', docs());
        expect(mockFindByMetricDate).not.toHaveBeenCalled();
    });

    test('a partial measurement reads the existing doc and writes the merged result', async () => {
        mockFindByMetricDate.mockResolvedValue(existingWithSd());
        await upsertDailyMetricsDocs(USER, 'US', 'NA', docs(), ['SPONSORED_PRODUCTS', 'SPONSORED_BRANDS']);

        expect(mockFindByMetricDate).toHaveBeenCalledWith(USER, 'US', 'NA', DATE);
        const written = mockUpsert.mock.calls[0][4];
        expect(written.campaignTypeBreakdown.sponsoredDisplay.spend).toBe(40);
        expect(written.summary.totalSpend).toBe(70);
        // metricDate is the key, not part of the payload.
        expect(written.metricDate).toBeUndefined();
        expect(mockUpsert.mock.calls[0][3]).toBe(DATE);
    });

    test('returns the last saved record so the caller`s recordId keeps working', async () => {
        const res = await upsertDailyMetricsDocs(USER, 'US', 'NA', docs(), ALL_TYPES);
        expect(res.savedRecord).toEqual({ _id: 'saved-id' });
    });
});

describe('savePpcMetricsFromRows (async adapter entry point)', () => {
    const row = (campaignType, status, result = null) => ({
        service: 'ppcMetricsAggregated',
        params: { campaignType },
        status,
        result,
    });
    const metricsFor = (sales, spend) => ({
        dateWiseData: { [DATE]: { sales, spend, impressions: 100, clicks: 10, unitsSoldClicks1d: 1 } },
        campaigns: [],
    });

    test('NO_DATA counts as measured, so its zeros are written', async () => {
        mockFindByMetricDate.mockResolvedValue(existingWithSd());
        await savePpcMetricsFromRows(USER, 'US', 'NA', 'p1', [
            row('SPONSORED_PRODUCTS', 'DONE', metricsFor(100, 10)),
            row('SPONSORED_BRANDS', 'DONE', metricsFor(200, 20)),
            row('SPONSORED_DISPLAY', 'NO_DATA'),
        ]);
        // All three measured => complete => no merge, no read.
        expect(mockFindByMetricDate).not.toHaveBeenCalled();
        expect(mockUpsert.mock.calls[0][4].summary.totalSpend).toBe(30);
    });

    test('FAILED does NOT count as measured, so stored figures are preserved', async () => {
        // This is the regression: before the fix, FAILED and NO_DATA were collapsed into `!metrics`
        // and both wrote zeros over real data.
        mockFindByMetricDate.mockResolvedValue(existingWithSd());
        await savePpcMetricsFromRows(USER, 'US', 'NA', 'p1', [
            row('SPONSORED_PRODUCTS', 'DONE', metricsFor(100, 10)),
            row('SPONSORED_BRANDS', 'DONE', metricsFor(200, 20)),
            row('SPONSORED_DISPLAY', 'FAILED'),
        ]);
        expect(mockFindByMetricDate).toHaveBeenCalled();
        const written = mockUpsert.mock.calls[0][4];
        expect(written.campaignTypeBreakdown.sponsoredDisplay.spend).toBe(40);
        expect(written.summary.totalSpend).toBe(70);
    });

    test('every report FAILED writes nothing at all', async () => {
        await savePpcMetricsFromRows(USER, 'US', 'NA', 'p1', [
            row('SPONSORED_PRODUCTS', 'FAILED'),
            row('SPONSORED_BRANDS', 'FAILED'),
            row('SPONSORED_DISPLAY', 'FAILED'),
        ]);
        // No dates survive, so there is nothing to write — and crucially nothing to zero.
        expect(mockUpsert).not.toHaveBeenCalled();
    });
});

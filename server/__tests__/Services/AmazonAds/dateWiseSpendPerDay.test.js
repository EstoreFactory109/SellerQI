/**
 * Tests for the per-day write path of `ppcSpendsDateWise`.
 *
 * WHY THIS EXISTS
 * This service used to `.create()` ONE document holding the entire 31-day report. For the
 * largest account that reached 66,451 rows / 13.16MB and then failed on every single run:
 *
 *     RangeError [ERR_OUT_OF_RANGE]: The value of "offset" is out of range.
 *     It must be >= 0 && <= 17825792. Received 17825795
 *
 * (17825792 is bson's internal serialization buffer. The cluster's own limit is 16MB, so
 * raising the buffer would only move the rejection server-side.) The account had no
 * date-wise spend saved from 2026-08-12 until this fix.
 *
 * Two distinct things are covered:
 *
 * 1. NORMALIZATION. The old write ran with no validators and no coercion — every cast was
 *    left to Mongoose. The per-day upsert runs with `runValidators: true` and every row
 *    field except `sales14d` is `required`, while Amazon sends `campaignId` as a NUMBER and
 *    the sales figures as numbers against String fields. Without the normalizer a perfectly
 *    good report fails validation, which would turn a size bug into an outage.
 *
 * 2. GROUPING. One document per calendar day is what actually bounds the size, and it also
 *    fixes a seller-visible bug: `sched_ads_catchup` fetches a SINGLE day, and under the old
 *    scheme that one-day document won every `sort({createdAt:-1})` read and collapsed the
 *    whole PPC chart to that day. 22 of 163 accounts were in that state on 2026-08-21.
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

const mockUpsert = jest.fn();
const mockMerged = jest.fn();
jest.mock('../../../models/amazon-ads/GetDateWisePPCspendModel.js', () => ({
    upsertDateWiseSpendsForDate: (...a) => mockUpsert(...a),
    findMergedDateWiseSpends: (...a) => mockMerged(...a),
}));

const {
    mapDateWiseSpendRow,
    persistDateWiseSpendsPerDay,
} = require('../../../Services/AmazonAds/GetDateWiseSpendKeywords.js');

beforeEach(() => {
    mockUpsert.mockReset().mockResolvedValue({});
    mockMerged.mockReset().mockResolvedValue([]);
});

describe('mapDateWiseSpendRow', () => {
    // Exactly the payload Amazon returns: numeric campaignId, numeric sales.
    test('coerces the raw Amazon row to the declared schema types', () => {
        const row = mapDateWiseSpendRow({
            date: '2026-08-19',
            cost: 12.34,
            campaignId: 123456789012345,
            campaignName: 'Brand — Exact',
            clicks: 7,
            impressions: 900,
            sales7d: 45.6,
            sales14d: 78.9,
        });

        expect(row).toEqual({
            date: '2026-08-19',
            cost: 12.34,
            campaignId: '123456789012345',
            campaignName: 'Brand — Exact',
            clicks: 7,
            impressions: 900,
            sales7d: '45.6',
            sales14d: '78.9',
        });
    });

    // These are `required` in the schema, so under runValidators a missing value must become
    // a valid zero/empty rather than undefined — otherwise the whole day's upsert throws.
    test('fills required fields that Amazon omitted instead of leaving them undefined', () => {
        const row = mapDateWiseSpendRow({ date: '2026-08-19' });
        expect(row).toEqual({
            date: '2026-08-19',
            cost: 0,
            campaignId: '',
            campaignName: '',
            clicks: 0,
            impressions: 0,
            sales7d: '0',
            sales14d: '0',
        });
    });

    test('sales of 0 survives as "0", not as an empty string', () => {
        const row = mapDateWiseSpendRow({ date: '2026-08-19', sales7d: 0, sales14d: 0 });
        expect(row.sales7d).toBe('0');
        expect(row.sales14d).toBe('0');
    });

    test('a full ISO timestamp is truncated to the calendar day', () => {
        expect(mapDateWiseSpendRow({ date: '2026-08-19T00:00:00.000Z' }).date).toBe('2026-08-19');
    });

    // A row with no date cannot be filed under a day at all. Dropping it is correct;
    // inventing a day for it would corrupt someone's chart.
    test('returns null when there is no usable date', () => {
        expect(mapDateWiseSpendRow({ cost: 5 })).toBeNull();
        expect(mapDateWiseSpendRow({ date: null })).toBeNull();
        expect(mapDateWiseSpendRow(null)).toBeNull();
    });
});

describe('persistDateWiseSpendsPerDay', () => {
    test('writes one document per calendar day, not one per report', async () => {
        await persistDateWiseSpendsPerDay('u1', 'US', 'NA', [
            { date: '2026-08-18', cost: 1, campaignId: 1 },
            { date: '2026-08-19', cost: 2, campaignId: 1 },
            { date: '2026-08-19', cost: 3, campaignId: 2 },
        ]);

        expect(mockUpsert).toHaveBeenCalledTimes(2);
        const days = mockUpsert.mock.calls.map((c) => c[3]);
        expect(days.sort()).toEqual(['2026-08-18', '2026-08-19']);
    });

    test('rows are grouped under their own day', async () => {
        await persistDateWiseSpendsPerDay('u1', 'US', 'NA', [
            { date: '2026-08-18', cost: 1, campaignId: 1 },
            { date: '2026-08-19', cost: 2, campaignId: 1 },
            { date: '2026-08-19', cost: 3, campaignId: 2 },
        ]);

        const byDay = Object.fromEntries(mockUpsert.mock.calls.map((c) => [c[3], c[4]]));
        expect(byDay['2026-08-18']).toHaveLength(1);
        expect(byDay['2026-08-19']).toHaveLength(2);
        expect(byDay['2026-08-19'].map((r) => r.campaignId)).toEqual(['1', '2']);
    });

    test('rows are normalized before they are written', async () => {
        await persistDateWiseSpendsPerDay('u1', 'US', 'NA', [
            { date: '2026-08-19', cost: '5', campaignId: 999, sales7d: 1.5 },
        ]);
        expect(mockUpsert.mock.calls[0][4][0]).toEqual(
            expect.objectContaining({ cost: 5, campaignId: '999', sales7d: '1.5' })
        );
    });

    test('the account/country/region key is passed through on every day', async () => {
        await persistDateWiseSpendsPerDay('u1', 'UK', 'EU', [
            { date: '2026-08-19', cost: 1, campaignId: 1 },
        ]);
        expect(mockUpsert).toHaveBeenCalledWith('u1', 'UK', 'EU', '2026-08-19', expect.any(Array));
    });

    // Freshness tracking reads the newest metricDate. A zero-row report that wrote nothing
    // would look indistinguishable from a stalled pipeline.
    test('an empty report still stamps a zero-row day so freshness advances', async () => {
        await persistDateWiseSpendsPerDay('u1', 'US', 'NA', []);
        expect(mockUpsert).toHaveBeenCalledTimes(1);
        expect(mockUpsert.mock.calls[0][4]).toEqual([]);
    });

    test('a non-array report is handled like an empty one', async () => {
        await persistDateWiseSpendsPerDay('u1', 'US', 'NA', undefined);
        expect(mockUpsert).toHaveBeenCalledTimes(1);
    });

    test('a report where every row lacks a date stamps a zero-row day rather than writing junk', async () => {
        await persistDateWiseSpendsPerDay('u1', 'US', 'NA', [{ cost: 1 }, { cost: 2 }]);
        expect(mockUpsert).toHaveBeenCalledTimes(1);
        expect(mockUpsert.mock.calls[0][4]).toEqual([]);
    });

    test('undated rows are skipped without discarding the dated ones', async () => {
        await persistDateWiseSpendsPerDay('u1', 'US', 'NA', [
            { date: '2026-08-19', cost: 1, campaignId: 1 },
            { cost: 2, campaignId: 2 },
        ]);
        expect(mockUpsert).toHaveBeenCalledTimes(1);
        expect(mockUpsert.mock.calls[0][4]).toHaveLength(1);
    });

    // The callers' response shape depends on getting the merged rows back, not a document.
    test('returns the merged rows', async () => {
        mockMerged.mockResolvedValue([{ campaignId: '1' }, { campaignId: '2' }]);
        const out = await persistDateWiseSpendsPerDay('u1', 'US', 'NA', [
            { date: '2026-08-19', cost: 1, campaignId: 1 },
        ]);
        expect(out).toHaveLength(2);
    });

    // A single-day catch-up must ADD a day, never replace the window. This is the bug that
    // left 22 accounts showing a one-day chart.
    test('a single-day catch-up writes only that day and leaves the rest alone', async () => {
        await persistDateWiseSpendsPerDay('u1', 'US', 'NA', [
            { date: '2026-08-05', cost: 9, campaignId: 1 },
        ]);
        expect(mockUpsert).toHaveBeenCalledTimes(1);
        expect(mockUpsert.mock.calls[0][3]).toBe('2026-08-05');
    });
});

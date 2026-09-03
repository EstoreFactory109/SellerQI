/**
 * Tests for the product-wise sponsored-ads partial-save protection.
 *
 * WHY THIS EXISTS
 * The save does `deleteMany({userId, country, region, date: {$in: distinctDates}})` followed by
 * `insertMany`. That delete had NO `adType` filter, so a save carrying only SP rows deleted the
 * existing SD rows for those same dates — the SD half of product-level ad spend simply vanished until
 * a later full success. Live on both the inline and async paths.
 *
 * The fix has two halves, and the second is easy to miss:
 *   1. scope the delete to the ad types actually measured; and
 *   2. re-stamp the PRESERVED rows onto the new batchId — because `findLatestByUserCountryRegion`
 *      reads only the newest batch, so rows left on an older batchId survive in the collection but are
 *      invisible to the dashboard, and `deleteOldBatches(…, 3)` purges them within three runs anyway.
 * A test that only checked (1) would pass while the data stayed effectively lost.
 */

const mockDeleteMany = jest.fn();
const mockInsertMany = jest.fn();
const mockUpdateMany = jest.fn();
const mockDeleteOldBatches = jest.fn();
jest.mock('../../../models/amazon-ads/ProductWiseSponsoredAdsItemModel', () => ({
    deleteMany: (...a) => mockDeleteMany(...a),
    insertMany: (...a) => mockInsertMany(...a),
    updateMany: (...a) => mockUpdateMany(...a),
    deleteOldBatches: (...a) => mockDeleteOldBatches(...a),
}));
jest.mock('../../../models/amazon-ads/ProductWiseSponseredAdsModel', () => ({
    deleteMany: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({ _id: 'agg' }),
    findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'agg' }),
}));

const { saveProductWiseSponsoredAdsData } = require('../../../Services/amazon-ads/ProductWiseSponsoredAdsService.js');

const USER = '507f1f77bcf86cd799439011';

const item = (adType, date, asin = 'B001') => ({
    adType, date, asin, campaignId: 'c1', campaignName: 'C', sku: 's1',
    spend: 5, sales: 50, purchases: 1, unitsSoldClicks: 1,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteMany.mockResolvedValue({ deletedCount: 0 });
    mockInsertMany.mockImplementation(async (rows) => rows);
    mockUpdateMany.mockResolvedValue({ modifiedCount: 3 });
    mockDeleteOldBatches.mockResolvedValue({});
});

describe('saveProductWiseSponsoredAdsData — delete scoping', () => {
    test('with no usableAdTypes it deletes BOTH types (today`s behaviour, unchanged)', async () => {
        await saveProductWiseSponsoredAdsData(USER, 'US', 'NA', [item('SP', '2026-07-20')]);

        const filter = mockDeleteMany.mock.calls[0][0];
        expect(filter.adType).toEqual({ $in: ['SP', 'SD'] });
        expect(filter.date).toEqual({ $in: ['2026-07-20'] });
        // Nothing preserved, so nothing to adopt.
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    test('SP-only measured: the delete is scoped to SP and SD is NOT touched', async () => {
        await saveProductWiseSponsoredAdsData(
            USER, 'US', 'NA',
            [item('SP', '2026-07-20'), item('SP', '2026-07-21')],
            { usableAdTypes: ['SP'] },
        );

        const filter = mockDeleteMany.mock.calls[0][0];
        expect(filter.adType).toEqual({ $in: ['SP'] });
        expect(filter.date).toEqual({ $in: ['2026-07-20', '2026-07-21'] });
    });

    test('SP-only measured: surviving SD rows are ADOPTED into the new batch', async () => {
        // Without this they would be invisible to the dashboard (newest-batch read) and purged by
        // deleteOldBatches within three runs — preserved in name only.
        await saveProductWiseSponsoredAdsData(
            USER, 'US', 'NA',
            [item('SP', '2026-07-20')],
            { usableAdTypes: ['SP'] },
        );

        expect(mockUpdateMany).toHaveBeenCalledTimes(1);
        const [filter, update] = mockUpdateMany.mock.calls[0];
        expect(filter.adType).toEqual({ $in: ['SD'] });
        expect(filter.date).toEqual({ $in: ['2026-07-20'] });
        // Onto the SAME batchId the new rows were inserted with, or the read path still misses them.
        const insertedBatchId = mockInsertMany.mock.calls[0][0][0].batchId;
        expect(String(update.$set.batchId)).toBe(String(insertedBatchId));
    });

    test('both types measured: scoped to both, and nothing is adopted', async () => {
        await saveProductWiseSponsoredAdsData(
            USER, 'US', 'NA',
            [item('SP', '2026-07-20'), item('SD', '2026-07-20')],
            { usableAdTypes: ['SP', 'SD'] },
        );

        expect(mockDeleteMany.mock.calls[0][0].adType).toEqual({ $in: ['SP', 'SD'] });
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    test('an empty usableAdTypes array falls back to both, never to deleting nothing', async () => {
        // Guards a caller that computes an empty list by accident: silently deleting nothing would
        // leave stale rows forever, which over-reports spend.
        await saveProductWiseSponsoredAdsData(USER, 'US', 'NA', [item('SP', '2026-07-20')], { usableAdTypes: [] });
        expect(mockDeleteMany.mock.calls[0][0].adType).toEqual({ $in: ['SP', 'SD'] });
    });

    test('rows missing asin/campaignId/date are filtered BEFORE the date set is derived', async () => {
        // Otherwise the delete could target a date that no surviving row re-inserts — deleting real
        // data and replacing it with nothing.
        await saveProductWiseSponsoredAdsData(
            USER, 'US', 'NA',
            [
                item('SP', '2026-07-20'),
                { adType: 'SP', date: '2026-07-99', asin: null, campaignId: 'c' },  // no asin
                { adType: 'SP', date: null, asin: 'B002', campaignId: 'c' },        // no date
            ],
            { usableAdTypes: ['SP'] },
        );

        expect(mockDeleteMany.mock.calls[0][0].date).toEqual({ $in: ['2026-07-20'] });
    });

    test('no rows at all touches the database not at all', async () => {
        const res = await saveProductWiseSponsoredAdsData(USER, 'US', 'NA', [], { usableAdTypes: ['SP'] });
        expect(res.itemCount).toBe(0);
        expect(mockDeleteMany).not.toHaveBeenCalled();
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });
});

/**
 * The per-ad-type save that the async `finalize` now performs.
 *
 * `finalize` used to return the whole mapped report as `result` for the engine to stash on the
 * AsyncReportRequest row, so a later `saveFromRows` could combine SP + SD. That row grew to 15.13MB
 * in production and then failed the write outright past MongoDB's 16MB ceiling, discarding the
 * report it had just downloaded. Each ad type now saves itself, one at a time.
 *
 * Which makes the ADOPTION step (half 2 in the header above) load-bearing in a new way: SP saving
 * and SD saving are now two separate calls, so each must carry the other type's rows into its own
 * batch or the newest-batch readers would see only whichever type finished last.
 */
describe('per-ad-type save composes SP and SD into one visible batch', () => {
    test('saving SP alone adopts the existing SD rows into the new batch', async () => {
        await saveProductWiseSponsoredAdsData(USER, 'US', 'NA', [item('SP', '2026-07-20')], {
            usableAdTypes: ['SP'],
        });

        expect(mockDeleteMany.mock.calls[0][0].adType).toEqual({ $in: ['SP'] });
        // SD is preserved, and re-stamped so the dashboard's newest-batch read still sees it.
        expect(mockUpdateMany).toHaveBeenCalledTimes(1);
        expect(mockUpdateMany.mock.calls[0][0].adType).toEqual({ $in: ['SD'] });
    });

    // THE GAP per-type saving introduces. Adoption is normally scoped to the dates present in THIS
    // save. With one type at a time, a day the OTHER type has and this one does not would be left
    // behind on the previous batch — present in the collection, invisible to every reader, and
    // purged by deleteOldBatches within three runs. Passing the report window closes it.
    test('preserveDateRange widens adoption to the whole report window', async () => {
        await saveProductWiseSponsoredAdsData(USER, 'US', 'NA', [item('SP', '2026-07-20')], {
            usableAdTypes: ['SP'],
            preserveDateRange: { startDate: '2026-07-01', endDate: '2026-07-31' },
        });

        expect(mockUpdateMany.mock.calls[0][0].date).toEqual({ $gte: '2026-07-01', $lte: '2026-07-31' });
    });

    test('without preserveDateRange adoption stays scoped to this save\'s dates', async () => {
        await saveProductWiseSponsoredAdsData(USER, 'US', 'NA', [item('SP', '2026-07-20')], {
            usableAdTypes: ['SP'],
        });

        expect(mockUpdateMany.mock.calls[0][0].date).toEqual({ $in: ['2026-07-20'] });
    });
});

describe('saveProductWiseFromRows — clears measured-but-empty ad types', () => {
    const { adsAsync } = require('../../../Services/AmazonAds/GetPPCProductWise.js');
    const WINDOW = { startDate: '2026-07-01', endDate: '2026-07-31' };
    const row = (adType, status) => ({ params: { adType, ...WINDOW }, status });

    // The report ran and this account genuinely has no SD spend, so stale SD rows must go.
    // Preserving them would over-report spend forever. This case cannot be handled in finalize —
    // an ad type whose `submit` returned null never gets a finalize at all.
    test('SD NO_DATA clears SD rows across the report window', async () => {
        await adsAsync.saveFromRows(USER, 'US', 'NA', 'p1', [
            row('SP', 'DONE'),
            row('SD', 'NO_DATA'),
        ]);

        expect(mockDeleteMany).toHaveBeenCalledTimes(1);
        expect(mockDeleteMany.mock.calls[0][0].adType).toEqual({ $in: ['SD'] });
        expect(mockDeleteMany.mock.calls[0][0].date).toEqual({ $gte: '2026-07-01', $lte: '2026-07-31' });
    });

    // THE REGRESSION, in the direction that destroys data: FAILED means we do not know, so the
    // stored rows must survive. Collapsing it with NO_DATA is what wiped real spend.
    test('SD FAILED clears nothing', async () => {
        await adsAsync.saveFromRows(USER, 'US', 'NA', 'p1', [
            row('SP', 'DONE'),
            row('SD', 'FAILED'),
        ]);

        expect(mockDeleteMany).not.toHaveBeenCalled();
    });

    test('every report FAILED touches nothing', async () => {
        const res = await adsAsync.saveFromRows(USER, 'US', 'NA', 'p1', [
            row('SP', 'FAILED'),
            row('SD', 'FAILED'),
        ]);

        expect(res.documentsSaved).toBe(0);
        expect(mockDeleteMany).not.toHaveBeenCalled();
        expect(mockInsertMany).not.toHaveBeenCalled();
    });

    // All types succeeded, so both already saved themselves in finalize.
    test('all types DONE touches nothing — finalize already saved them', async () => {
        await adsAsync.saveFromRows(USER, 'US', 'NA', 'p1', [
            row('SP', 'DONE'),
            row('SD', 'DONE'),
        ]);

        expect(mockDeleteMany).not.toHaveBeenCalled();
        expect(mockInsertMany).not.toHaveBeenCalled();
    });
});

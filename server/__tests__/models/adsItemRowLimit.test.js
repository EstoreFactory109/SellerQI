/**
 * The ceiling on ProductWiseSponsoredAdsItem.findLatestByUserCountryRegion.
 *
 * WHY THIS EXISTS
 * The static loaded an entire batch with no limit, projection or timeout. On 2026-09-01 one PRO
 * account's newest batch held 234,035 rows / 102 MB — legitimate 30-day data (verified 1.00x on the
 * full natural key asin+sku+date+adType+campaign+adGroup, so NOT duplicates), up from 7,566 when a
 * batch held a single day. As lean JS objects that is several hundred MB, and the service
 * immediately re-materialises every row into a SECOND array of 19 fields, so both are live at peak
 * against a 1536 MB heap cap.
 *
 * The symptom was the worst kind: `fetchAllDataModels` never returned, nothing threw, nothing was
 * logged, and BullMQ stall-reclaimed the job every 20 minutes forever. That account had not
 * completed a run in over a week. A hang bypasses every catch block in the pipeline; a failure or a
 * degrade does not.
 *
 * Both directions are load-bearing:
 *   - over the limit  -> return empty, do NOT load, log loudly   (the account completes)
 *   - under the limit -> load exactly as before                  (a ceiling that clipped normal
 *                                                                 accounts would be far worse
 *                                                                 than the bug)
 */

const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const logger = require('../../utils/Logger.js');

jest.mock('../../utils/Logger.js', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const USER = '507f1f77bcf86cd799439011';
const BATCH = '507f1f77bcf86cd799439099';

/** Stub the two/three queries the static makes, so no database is needed. */
function stub({ rowCount, items = [] }) {
    const find = jest.fn(() => ({
        select: () => ({ lean: () => ({ maxTimeMS: async () => items }) }),
    }));
    jest.spyOn(ProductWiseSponsoredAdsItem, 'findOne').mockReturnValue({
        sort: () => ({ select: () => ({ lean: async () => ({ batchId: BATCH, createdAt: new Date('2026-09-01') }) }) }),
    });
    jest.spyOn(ProductWiseSponsoredAdsItem, 'countDocuments').mockReturnValue({
        maxTimeMS: async () => rowCount,
    });
    jest.spyOn(ProductWiseSponsoredAdsItem, 'find').mockImplementation(find);
    return { find };
}

afterEach(() => jest.restoreAllMocks());

describe('an oversized batch degrades instead of hanging', () => {
    // THE REGRESSION TEST — 234,035 is the real number from the stalled account.
    test('234k rows: returns empty, never issues the find, and says why', async () => {
        const { find } = stub({ rowCount: 234035 });

        const res = await ProductWiseSponsoredAdsItem.findLatestByUserCountryRegion(USER, 'US', 'NA');

        expect(res.items).toEqual([]);
        expect(res.skipped).toBe(true);
        expect(res.rowCount).toBe(234035);
        expect(find).not.toHaveBeenCalled();          // the load never happens
        expect(logger.error).toHaveBeenCalled();       // and it is not silent
    });

    // The batchId/createdAt still come back so callers can distinguish "withheld" from "no data".
    test('the batch identity is still reported when skipped', async () => {
        stub({ rowCount: 999999 });

        const res = await ProductWiseSponsoredAdsItem.findLatestByUserCountryRegion(USER, 'US', 'NA');

        expect(res.batchId).toBe(BATCH);
        expect(res.createdAt).toBeInstanceOf(Date);
    });
});

describe('normal accounts are untouched', () => {
    // THE OTHER DIRECTION, and the one with more downside: silently clipping working accounts
    // would be worse than the bug being fixed. The largest healthy account is ~24k rows.
    test('24k rows loads normally', async () => {
        const rows = [{ asin: 'B1', spend: 3 }];
        const { find } = stub({ rowCount: 24052, items: rows });

        const res = await ProductWiseSponsoredAdsItem.findLatestByUserCountryRegion(USER, 'US', 'NA');

        expect(res.items).toBe(rows);
        expect(res.skipped).toBeUndefined();
        expect(find).toHaveBeenCalledWith({ batchId: BATCH });
    });

    test('an account with no data at all returns the empty shape, not a skip', async () => {
        jest.spyOn(ProductWiseSponsoredAdsItem, 'findOne').mockReturnValue({
            sort: () => ({ select: () => ({ lean: async () => null }) }),
        });

        const res = await ProductWiseSponsoredAdsItem.findLatestByUserCountryRegion(USER, 'US', 'NA');

        expect(res).toEqual({ items: [], createdAt: null, batchId: null });
    });
});

describe('the limit is operable without a deploy', () => {
    // A wrong threshold must be correctable from the environment — this is a stopgap number, and
    // the account it protects is a paying customer.
    test('ADS_ITEM_ROW_LIMIT is read from the environment', () => {
        jest.resetModules();
        process.env.ADS_ITEM_ROW_LIMIT = '20000';
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js'), 'utf8');
        delete process.env.ADS_ITEM_ROW_LIMIT;

        expect(src).toContain('process.env.ADS_ITEM_ROW_LIMIT');
        expect(src).toContain('process.env.ADS_ITEM_QUERY_MAX_MS');
    });
});

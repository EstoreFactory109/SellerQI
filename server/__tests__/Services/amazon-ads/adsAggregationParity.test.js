/**
 * Reading the sponsored-ads batch by aggregation instead of loading it.
 *
 * WHY
 * `getProductWiseSponsoredAdsData` used to do `find({batchId}).lean()` and then `.map()` every row
 * into a second 19-field array. For one PRO account that is 234,035 rows / 102 MB, twice over,
 * against a 1536 MB heap — and the result was not slowness but a HANG: `fetchAllDataModels` never
 * returned, nothing threw, and BullMQ stall-reclaimed the job every 20 minutes for over a week.
 * The previous fix made that survivable by SKIPPING the data above 150k rows. Losing ads data is
 * not acceptable, so this reads all of it, aggregated.
 *
 * PARITY IS THE ENTIRE TEST. Nothing may be lost, so these assert equality against the same
 * numbers computed from raw rows — not behaviour.
 *
 * Verified against the live batch while building this: totals identical to the cent
 * (spend 390069.62, sales 1767428.84, purchases 128082) and the distinct campaign/adGroup sets
 * identical (5,092 / 5,095), at 34.7 MB instead of ~200 MB.
 */

const mockAgg = { asin: [], campaign: [] };
const mockMeta = { batchId: 'batch-1', createdAt: new Date('2026-09-01T11:54:00Z') };
const mockIds = { campaignIds: ['c1', 'c2'], adGroupIds: ['g1'] };

jest.mock('../../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js', () => ({
    findLatestBatchMeta: jest.fn(async () => mockMeta),
    aggregateBatchByAsinAdTypeDate: jest.fn(async () => mockAgg.asin),
    aggregateBatchByCampaignDate: jest.fn(async () => mockAgg.campaign),
    distinctEntityIdsForBatch: jest.fn(async () => mockIds),
    findLatestByUserCountryRegion: jest.fn(),
}));
jest.mock('../../../models/amazon-ads/ProductWiseSponseredAdsModel.js', () => ({
    findOne: () => ({ sort: () => ({ lean: async () => null }) }),
}), { virtual: true });
jest.mock('../../../utils/Logger.js', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { getProductWiseSponsoredAdsData } = require('../../../Services/amazon-ads/ProductWiseSponsoredAdsService.js');

const USER = '507f1f77bcf86cd799439011';

/** The raw rows a batch would hold — the ground truth every assertion compares against. */
const RAW = [
    { asin: 'A1', adType: 'SP', date: '2026-08-01', spend: 1.11, sales: 10.10, purchases: 1, clicks: 2, impressions: 30, unitsSoldClicks: 1, campaignId: 'c1', adGroupId: 'g1' },
    { asin: 'A1', adType: 'SP', date: '2026-08-01', spend: 2.22, sales: 20.20, purchases: 2, clicks: 3, impressions: 40, unitsSoldClicks: 2, campaignId: 'c2', adGroupId: 'g1' },
    { asin: 'A1', adType: 'SD', date: '2026-08-02', spend: 0.50, sales: 5.00, purchases: 1, clicks: 1, impressions: 10, unitsSoldClicks: 1, campaignId: 'c1', adGroupId: 'g1' },
    { asin: 'A2', adType: 'SP', date: '2026-08-01', spend: 3.33, sales: 0, purchases: 0, clicks: 0, impressions: 5, unitsSoldClicks: 0, campaignId: 'c2', adGroupId: 'g1' },
];

/** What MongoDB's $group would return for the two grains. */
function aggregateRaw(rows, keyFn) {
    const m = new Map();
    for (const r of rows) {
        const k = JSON.stringify(keyFn(r));
        const e = m.get(k) || { ...keyFn(r), spend: 0, sales: 0, purchases: 0, clicks: 0, impressions: 0, unitsSoldClicks: 0 };
        e.spend += r.spend; e.sales += r.sales; e.purchases += r.purchases;
        e.clicks += r.clicks; e.impressions += r.impressions; e.unitsSoldClicks += r.unitsSoldClicks;
        if (r.campaignName !== undefined) e.campaignName = r.campaignName;
        m.set(k, e);
    }
    return [...m.values()];
}

beforeEach(() => {
    mockAgg.asin = aggregateRaw(RAW, (r) => ({ asin: r.asin, adType: r.adType, date: r.date }));
    mockAgg.campaign = aggregateRaw(RAW, (r) => ({ campaignId: r.campaignId, date: r.date }));

    // Implementations are (re)attached HERE, not in the jest.mock factory: this project's jest
    // config sets `resetMocks: true`, which strips factory implementations before every test and
    // leaves the mocks returning undefined.
    const Model = require('../../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
    Model.findLatestBatchMeta.mockImplementation(async () => mockMeta);
    Model.aggregateBatchByAsinAdTypeDate.mockImplementation(async () => mockAgg.asin);
    Model.aggregateBatchByCampaignDate.mockImplementation(async () => mockAgg.campaign);
    Model.distinctEntityIdsForBatch.mockImplementation(async () => mockIds);
});

const sum = (rows, f) => rows.reduce((a, r) => a + (parseFloat(r[f]) || 0), 0);

describe('no total changes', () => {
    test('grand totals equal the raw rows', async () => {
        const res = await getProductWiseSponsoredAdsData(USER, 'US', 'NA');

        expect(sum(res.sponsoredAds, 'spend')).toBeCloseTo(sum(RAW, 'spend'), 10);
        expect(sum(res.sponsoredAds, 'sales')).toBeCloseTo(sum(RAW, 'sales'), 10);
        expect(sum(res.sponsoredAds, 'purchases')).toBe(sum(RAW, 'purchases'));
        expect(sum(res.sponsoredAds, 'clicks')).toBe(sum(RAW, 'clicks'));
        expect(sum(res.sponsoredAds, 'impressions')).toBe(sum(RAW, 'impressions'));
    });

    // THE one byte-identity requirement from the consumer census: this map feeds persisted
    // profitabilityErrorDetails, whose `profitMargin < 10` / `netProfit < 0` thresholds are cliffs.
    // Measured drift from summation order on live data was 6.4e-12 USD — ten orders of magnitude
    // below a cent — so the tolerance here is deliberately tight rather than absent.
    test('per-ASIN SUM(spend) matches the raw rows', async () => {
        const res = await getProductWiseSponsoredAdsData(USER, 'US', 'NA');

        const fromRaw = new Map();
        RAW.forEach((r) => fromRaw.set(r.asin, (fromRaw.get(r.asin) || 0) + r.spend));
        const fromNew = new Map();
        res.sponsoredAds.forEach((r) => fromNew.set(r.asin, (fromNew.get(r.asin) || 0) + r.spend));

        expect([...fromNew.keys()].sort()).toEqual([...fromRaw.keys()].sort());
        for (const [asin, v] of fromRaw) expect(fromNew.get(asin)).toBeCloseTo(v, 9);
    });

    // ProductPerformanceService coalesces `sales || salesIn7Days || salesIn14Days || salesIn30Days`
    // PER ROW before summing. SD rows must carry their value in the 14-day field and zero in the
    // 7-day one, or per-ASIN sales silently change.
    test('the SP/SD attribution fields reproduce the old mapper exactly', async () => {
        const res = await getProductWiseSponsoredAdsData(USER, 'US', 'NA');

        const sd = res.sponsoredAds.find((r) => r.adType === 'SD');
        expect(sd.salesIn7Days).toBe(0);
        expect(sd.salesIn14Days).toBe(sd.sales);
        expect(sd.purchasedIn7Days).toBe(0);
        expect(sd.purchasedIn14Days).toBe(sd.purchases);

        const sp = res.sponsoredAds.find((r) => r.adType === 'SP');
        expect(sp.salesIn7Days).toBe(sp.sales);
        expect(sp.salesIn14Days).toBe(0);

        const chain = res.sponsoredAds.reduce(
            (a, r) => a + (r.sales || r.salesIn7Days || r.salesIn14Days || r.salesIn30Days || 0), 0);
        expect(chain).toBeCloseTo(sum(RAW, 'sales'), 10);
    });
});

describe('the campaign consumers keep working', () => {
    // The census found exactly two server readers of campaignId/adGroupId — both want distinct
    // sets — and one client reader that does a GROUP BY campaignId. The aggregated rows no longer
    // carry those ids, so both needs are served explicitly or they break silently.
    test('distinct campaign and ad-group ids are returned', async () => {
        const res = await getProductWiseSponsoredAdsData(USER, 'US', 'NA');

        expect(res.campaignIds).toEqual(['c1', 'c2']);
        expect(res.adGroupIds).toEqual(['g1']);
    });

    test('the campaign rollup preserves spend and sales per campaign', async () => {
        const res = await getProductWiseSponsoredAdsData(USER, 'US', 'NA');

        const byCampaign = new Map();
        res.campaignRollup.forEach((r) => {
            const e = byCampaign.get(r.campaignId) || { spend: 0, sales: 0 };
            e.spend += r.spend; e.sales += r.sales;
            byCampaign.set(r.campaignId, e);
        });
        const rawByCampaign = new Map();
        RAW.forEach((r) => {
            const e = rawByCampaign.get(r.campaignId) || { spend: 0, sales: 0 };
            e.spend += r.spend; e.sales += r.sales;
            rawByCampaign.set(r.campaignId, e);
        });

        for (const [cid, v] of rawByCampaign) {
            expect(byCampaign.get(cid).spend).toBeCloseTo(v.spend, 10);
            expect(byCampaign.get(cid).sales).toBeCloseTo(v.sales, 10);
        }
    });

    test('the date dimension survives — the client filters on it', async () => {
        const res = await getProductWiseSponsoredAdsData(USER, 'US', 'NA');

        expect(new Set(res.sponsoredAds.map((r) => r.date))).toEqual(new Set(['2026-08-01', '2026-08-02']));
        expect(res.campaignRollup.every((r) => typeof r.date === 'string')).toBe(true);
    });
});

describe('the batch is never loaded row by row', () => {
    // The regression that matters: if anything reintroduces the row load, the hang comes back.
    test('findLatestByUserCountryRegion is not called', async () => {
        const Model = require('../../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');

        await getProductWiseSponsoredAdsData(USER, 'US', 'NA');

        expect(Model.findLatestByUserCountryRegion).not.toHaveBeenCalled();
        expect(Model.aggregateBatchByAsinAdTypeDate).toHaveBeenCalledWith('batch-1');
    });

    test('an account with no batch falls through without throwing', async () => {
        const Model = require('../../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
        Model.findLatestBatchMeta.mockResolvedValueOnce({ batchId: null, createdAt: null });

        await expect(getProductWiseSponsoredAdsData(USER, 'US', 'NA')).resolves.toBeDefined();
    });
});

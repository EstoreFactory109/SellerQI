/**
 * buildTaskCoverage — which task data sources arrived this run.
 *
 * Task reconcile resolves a stored task only when its source is covered, because
 * a missing input yields an empty error list that looks exactly like "no issues".
 */
const { buildTaskCoverage } = require('../../../Services/Calculations/DashboardCalculation.js');

const fullData = () => ({
    RankingsData: {
        RankingResultArray: [{ asin: 'A1' }, { asin: 'A2' }],
        BackendKeywordResultArray: [{ asin: 'A1' }]
    },
    ConversionData: {
        aPlusResult: [{ asin: 'A1' }], imageResult: [{ asin: 'A1' }], videoResult: [{ asin: 'A1' }],
        productStarRatingResult: [{ asin: 'A1' }], brandStoryResult: [{ asin: 'A1' }]
    },
    BuyBoxData: { asinBuyBoxData: [{ asin: 'A1' }] },
    InventoryAnalysis: { inventoryPlanning: [], strandedInventory: [] },
    adsKeywordsPerformanceData: [{ keyword: 'k' }],
    searchTerms: [{ searchTerm: 's' }],
    campaignData: [{ campaignId: 'c' }],
    AccountData: { accountHealth: { accountStatus: { status: 'Healthy' } } }
});

const fullCtx = () => ({
    activeProductSet: new Set(['A1', 'A2']),
    profitabilityRows: [{ asin: 'A1' }],
    profitabilityOk: true,
    financeFresh: true,
    campaignRows: [{ campaignId: 'c' }],
    sponsoredAdsOk: true
});

describe('buildTaskCoverage', () => {
    it('covers every source when every input arrived', () => {
        const c = buildTaskCoverage(fullData(), fullCtx());
        for (const key of [
            'ranking', 'ranking.backend', 'conversion', 'conversion.aplus', 'conversion.brandStory',
            'conversion.images', 'conversion.video', 'conversion.rating', 'conversion.buybox', 'inventory',
            'profitability', 'sponsoredAds', 'sponsoredAds.campaigns', 'sponsoredAds.keywords',
            'sponsoredAds.searchTerms', 'sponsoredAds.autoMigration', 'account'
        ]) {
            expect([key, c[key]]).toEqual([key, true]);
        }
        expect(c.uncoveredProductAsins).toEqual([]);
    });

    it('covers nothing product-level when there are no active products', () => {
        const c = buildTaskCoverage(fullData(), { ...fullCtx(), activeProductSet: new Set() });
        expect(c.ranking).toBe(false);
        expect(c['conversion.aplus']).toBe(false);
        expect(c.inventory).toBe(false);
    });

    it('covers nothing product-level when the ranking array is empty (conversion/inventory are built inside its loop)', () => {
        const data = fullData();
        data.RankingsData.RankingResultArray = [];
        const c = buildTaskCoverage(data, fullCtx());
        expect(c.ranking).toBe(false);
        expect(c['conversion.images']).toBe(false);
        expect(c.inventory).toBe(false);
    });

    it('lists active products the ranking loop never visited', () => {
        const c = buildTaskCoverage(fullData(), { ...fullCtx(), activeProductSet: new Set(['A1', 'A2', 'A3']) });
        expect(c.uncoveredProductAsins).toEqual(['A3']);
    });

    // Stale finance yields no verdicts at all; reconcile must not read that as
    // "every profitability problem was fixed".
    it('does not cover profitability when the finance behind it is stale', () => {
        expect(buildTaskCoverage(fullData(), { ...fullCtx(), financeFresh: false }).profitability).toBe(false);
    });

    it('does not cover a source whose calculation threw', () => {
        const c = buildTaskCoverage(fullData(), { ...fullCtx(), profitabilityOk: false, sponsoredAdsOk: false });
        expect(c.profitability).toBe(false);
        expect(c.sponsoredAds).toBe(false);
        expect(c['sponsoredAds.keywords']).toBe(false);
    });

    it('judges each ads source on its own input', () => {
        const data = fullData();
        data.searchTerms = [];
        const c = buildTaskCoverage(data, fullCtx());
        expect(c['sponsoredAds.keywords']).toBe(true);
        expect(c['sponsoredAds.searchTerms']).toBe(false);
        expect(c['sponsoredAds.autoMigration']).toBe(false);
    });

    it('needs campaign metadata to judge auto-campaign migration', () => {
        const data = fullData();
        data.campaignData = [];
        expect(buildTaskCoverage(data, fullCtx())['sponsoredAds.autoMigration']).toBe(false);
    });

    it('accepts the legacy Buy Box input when it has rows', () => {
        const data = fullData();
        delete data.BuyBoxData;
        data.ConversionData.ProductWithOutBuybox = [{ asin: 'A1', status: 'Error' }];
        expect(buildTaskCoverage(data, fullCtx())['conversion.buybox']).toBe(true);
    });

    // With no Buy Box days at all the legacy list is built empty; that is no data.
    it('does not cover Buy Box when there is no Buy Box data at all', () => {
        const data = fullData();
        delete data.BuyBoxData;
        data.ConversionData.ProductWithOutBuybox = [];
        expect(buildTaskCoverage(data, fullCtx())['conversion.buybox']).toBe(false);
    });

    it('does not cover account health when it is missing or empty', () => {
        const data = fullData();
        data.AccountData = { accountHealth: {} };
        expect(buildTaskCoverage(data, fullCtx()).account).toBe(false);
        delete data.AccountData;
        expect(buildTaskCoverage(data, fullCtx()).account).toBe(false);
    });

    it('is safe with no input at all', () => {
        const c = buildTaskCoverage();
        expect(c.ranking).toBe(false);
        expect(c.uncoveredProductAsins).toEqual([]);
    });
});

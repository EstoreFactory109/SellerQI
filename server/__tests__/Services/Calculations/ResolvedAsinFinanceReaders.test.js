/**
 * Smoke tests for the per-ASIN readers migrated to resolveAsinFinance.
 *
 * EconomicsMetrics stopped being written in April 2026 but findLatest still
 * returns its last doc. These readers used to take that doc's per-ASIN map at
 * face value. What matters here is that each one now (a) asks the shared
 * resolver, with the account key it needs for the live fallback, and (b) keeps
 * its response shape when the answer comes from DailySkuFinance.
 */

let mockResolved = { asinPpcSales: {}, financeFresh: false, source: 'none' };
let mockResolveCalls = [];
jest.mock('../../../Services/Finance/AsinFinanceWindowService.js', () => ({
    resolveAsinFinance: async (args) => {
        mockResolveCalls.push(args);
        return mockResolved;
    },
    resolveWindow: () => ({ startStr: '2026-09-20', endStr: '2026-10-19' }),
    getAsinFinanceForWindow: async () => ({}),
    DEFAULT_WINDOW_DAYS: 30,
}));

let mockEconomicsDoc = null;
jest.mock('../../../models/MCP/EconomicsMetricsModel.js', () => ({
    findOne: () => ({ sort: () => ({ lean: async () => mockEconomicsDoc }) }),
    findLatest: () => mockEconomicsDoc,
}));

const ProfitabilityService = require('../../../Services/Calculations/ProfitabilityService.js');
const { buildProfitabilityMapFromFinance } = require('../../../Services/Calculations/OptimizationService.js');
const { getAsinWiseSalesData } = require('../../../controllers/analytics/PageWiseDataController.js');

const DAY = 24 * 60 * 60 * 1000;
const liveMap = () => ({
    B001: { sales: 100, unitsSold: 4, totalFees: 30, amazonFees: 30, fbaFees: 20, referralFees: 10, storageFees: 0, grossProfit: 70, source: 'dailySkuFinance' },
});

function mockRes() {
    const res = {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
}

async function callAsinWiseSales() {
    const res = mockRes();
    await getAsinWiseSalesData({ userId: '6a40e42712ce56d674f734a0', region: 'FE', country: 'AU' }, res, (e) => { throw e; });
    return res;
}

beforeEach(() => {
    mockResolved = { asinPpcSales: {}, financeFresh: false, source: 'none' };
    mockResolveCalls = [];
    mockEconomicsDoc = null;
});

describe('/api/pagewise/asin-wise-sales', () => {
    it('serves live DailySkuFinance as aggregated rows when the EconomicsMetrics doc is stale', async () => {
        mockEconomicsDoc = { _id: 'em0', createdAt: new Date('2026-04-06'), asinWiseSales: [{ asin: 'OLD1', sales: { amount: 999 } }] };
        mockResolved = { asinPpcSales: liveMap(), financeFresh: true, source: 'dailySkuFinance' };

        const res = await callAsinWiseSales();

        expect(mockResolveCalls[0]).toEqual(expect.objectContaining({ userId: '6a40e42712ce56d674f734a0', country: 'AU', region: 'FE' }));
        const data = res.body.data;
        expect(data.isAggregated).toBe(true);
        expect(data.source).toBe('dailySkuFinance');
        expect(data.asinWiseSales).toHaveLength(1);
        // Same `{ amount }` shape ProfitTable / ProductDetails already read.
        expect(data.asinWiseSales[0]).toEqual(expect.objectContaining({
            asin: 'B001', sales: { amount: 100 }, unitsSold: 4, grossProfit: { amount: 70 }, totalFees: { amount: 30 }, date: null,
        }));
    });

    it('serves live DailySkuFinance when there is no EconomicsMetrics doc at all', async () => {
        mockResolved = { asinPpcSales: liveMap(), financeFresh: true, source: 'dailySkuFinance' };

        const res = await callAsinWiseSales();

        expect(res.body.data.asinWiseSales.map((r) => r.asin)).toEqual(['B001']);
    });

    it('returns the old empty response when neither source has data', async () => {
        mockEconomicsDoc = { _id: 'em0', createdAt: new Date('2026-04-06') };

        const res = await callAsinWiseSales();

        expect(res.body.data).toEqual({ asinWiseSales: [], isBig: false });
    });

    it('a FRESH normal-account doc is returned exactly as before (per-date rows)', async () => {
        const rows = [{ asin: 'B001', sales: { amount: 5 }, date: '2026-10-18' }];
        mockEconomicsDoc = { _id: 'em1', createdAt: new Date(Date.now() - DAY), asinWiseSales: rows, totalSales: { amount: 5 } };

        const res = await callAsinWiseSales();

        expect(mockResolveCalls).toHaveLength(0);
        expect(res.body.data.asinWiseSales).toBe(rows);
        expect(res.body.data.isAggregated).toBe(false);
    });
});

describe('ProfitabilityService.calculateProfitabilityDashboard (legacy /api/pagewise/profitability)', () => {
    const rawData = () => ({
        economicsMetricsData: { _id: 'em0', createdAt: new Date('2026-04-06') },
        products: [{ asin: 'B001', status: 'Active', itemName: 'Thing' }],
        ProductWiseSponsoredAds: [],
        dateWisePPCspendData: [],
        adsPPCSpend: 0,
        accountAdSpend: null,
        userId: 'u1',
        country: 'AU',
        region: 'FE',
    });

    it('builds rows from the resolved (live) map and passes the account key', async () => {
        mockResolved = { asinPpcSales: liveMap(), financeFresh: true, source: 'dailySkuFinance' };

        const out = await ProfitabilityService.calculateProfitabilityDashboard(rawData());

        expect(mockResolveCalls[0]).toEqual(expect.objectContaining({ userId: 'u1', country: 'AU', region: 'FE' }));
        expect(out.profitibilityData).toEqual([expect.objectContaining({ asin: 'B001', sales: 100 })]);
    });

    it('makes no profitability verdicts when no fresh finance resolved', async () => {
        mockResolved = { asinPpcSales: {}, financeFresh: false, source: 'none' };

        const out = await ProfitabilityService.calculateProfitabilityDashboard(rawData());

        expect(out.totalProfitabilityErrors).toBe(0);
        expect(out.profitibilityData).toEqual([]);
    });
});

describe('OptimizationService.buildProfitabilityMapFromFinance', () => {
    it('maps live finance rows and leaves `ads` out so scenarios use Ads API spend', () => {
        const map = buildProfitabilityMapFromFinance(liveMap());

        const row = map.get('B001');
        expect(row).toEqual(expect.objectContaining({ asin: 'B001', sales: 100, unitsSold: 4, totalFees: 30, grossProfit: 70 }));
        expect('ads' in row).toBe(false);
    });
});

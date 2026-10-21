/**
 * Product-level readers moved off EconomicsMetrics doc-hopping:
 *   - ProductPerformanceService: current vs previous are two live windows, not
 *     "the doc 1 or 4 back";
 *   - ProductPerformanceComparisonService: the previous window is built live;
 *   - ProductHistoryService: the fallback series is DailySkuFinance per day;
 *   - QMateProfitabilityService: a live-built doc never triggers the big-account
 *     side collection (its rows are keyed by a stored doc's _id).
 */

let mockBuyBoxLatest = null;
let mockBuyBoxPrev = [];
let mockBuyBoxHistory = [];
let mockBuyBoxSort = null;
jest.mock('../../../models/MCP/BuyBoxDataModel.js', () => ({
    findLatest: async () => mockBuyBoxLatest,
    find: () => ({
        sort: (spec) => {
            mockBuyBoxSort = spec;
            const chain = {
                skip: () => ({ limit: () => ({ lean: async () => mockBuyBoxPrev }) }),
                limit: () => ({ lean: async () => mockBuyBoxHistory }),
            };
            return chain;
        },
    }),
}));

jest.mock('../../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js', () => ({
    aggregate: async () => [{ totalSpend: 10, totalSales: 40, totalImpressions: 1000, totalClicks: 20 }],
    aggregateByAsinAndAdType: async () => [],
}));

let mockBigAccountCalls = 0;
jest.mock('../../../models/MCP/AsinWiseSalesForBigAccountsModel.js', () => ({
    getProfitabilityMapByMetricsId: async () => { mockBigAccountCalls++; return new Map(); },
    aggregate: async () => { mockBigAccountCalls++; return []; },
}));

let mockCurrent = null;
let mockComparison = null;
let mockBuilt = null;
const mockCalls = { load: [], comparison: [], build: [] };
jest.mock('../../../Services/Finance/LiveEconomicsService.js', () => {
    const actual = jest.requireActual('../../../Services/Finance/LiveEconomicsService.js');
    return {
        ...actual,
        loadLiveEconomics: async (...a) => { mockCalls.load.push(a); return mockCurrent; },
        loadEconomicsComparison: async (...a) => { mockCalls.comparison.push(a); return mockComparison; },
        buildEconomicsFromDailyFinance: async (a) => { mockCalls.build.push(a); return mockBuilt; },
    };
});

let mockDateWise = [];
let mockDateWiseArgs = null;
jest.mock('../../../Services/Finance/FinanceDashboardReadService.js', () => ({
    getAsinDateWise: async (args) => { mockDateWiseArgs = args; return mockDateWise; },
}));
jest.mock('../../../models/finance/AsinWiseSalesRunModel.js', () => ({
    find: () => ({ sort: () => ({ limit: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }) }) }),
}));
jest.mock('../../../models/finance/AsinWiseSalesDateItemModel.js', () => ({ aggregate: async () => [] }));

let mockCogsDoc = null;
jest.mock('../../../models/finance/CogsModel.js', () => ({
    findOne: () => ({ lean: async () => mockCogsDoc }),
}));

const { assembleEconomicsDoc } = jest.requireActual('../../../Services/Finance/LiveEconomicsService.js');
const { getProductPerformanceByAsin } = require('../../../Services/Calculations/ProductPerformanceService.js');
const { fetchPreviousEconomicsData } = require('../../../Services/Calculations/ProductPerformanceComparisonService.js');
const { getProductHistory } = require('../../../Services/Calculations/ProductHistoryService.js');
const QMateProfitabilityService = require('../../../Services/AI/QMateProfitabilityService.js');

const USER = '6a40e42712ce56d674f734a0';

function asinDoc(sales, units, startStr = '2026-10-01', endStr = '2026-10-07') {
    const row = (id) => ({ _id: id, productSales: sales, units, fbaFulfillmentFee: -5, referralCommission: -5, totalExpenses: -10 });
    return assembleEconomicsDoc({
        userId: USER, country: 'US', region: 'NA', startStr, endStr,
        byDate: [row(endStr)], byAsin: [row('B0TEST')],
    });
}

describe('product readers on live economics', () => {
    beforeEach(() => {
        mockBuyBoxLatest = null;
        mockBuyBoxPrev = [];
        mockBuyBoxHistory = [];
        mockBuyBoxSort = null;
        mockBigAccountCalls = 0;
        mockCurrent = null;
        mockComparison = null;
        mockBuilt = null;
        mockCalls.load = []; mockCalls.comparison = []; mockCalls.build = [];
        mockDateWise = [];
        mockDateWiseArgs = null;
        mockCogsDoc = null;
    });

    describe('ProductPerformanceService.getProductPerformanceByAsin', () => {
        it('current performance from the loader, same fields as before', async () => {
            mockCurrent = asinDoc(300, 6);

            const r = await getProductPerformanceByAsin({ userId: USER, region: 'NA', country: 'US', asin: ' b0test ' });

            expect(mockCalls.load[0][3]).toEqual({ asin: 'B0TEST' });
            expect(r.success).toBe(true);
            expect(r.data.comparison).toBeNull();
            expect(r.data.performance).toEqual({
                sessions: 0, pageViews: 0, conversionRate: 0, buyBoxPercentage: 0,
                sales: 300, unitsSold: 6, grossProfit: 290,
                ppcSpend: 10, ppcSales: 40, impressions: 1000, clicks: 20,
                acos: 25, ctr: 2, hasPPC: true, hasTraffic: false,
            });
            expect(mockBigAccountCalls).toBe(0);
        });

        it('wow compares the last 7 days with the 7 before, both live', async () => {
            mockCurrent = asinDoc(300, 6);
            mockComparison = {
                current: asinDoc(100, 2),
                previous: asinDoc(80, 1, '2026-09-24', '2026-09-30'),
                currentWindow: { startDate: '2026-10-01', endDate: '2026-10-07' },
                previousWindow: { startDate: '2026-09-24', endDate: '2026-09-30' },
            };

            const r = await getProductPerformanceByAsin({ userId: USER, region: 'NA', country: 'US', asin: 'B0TEST', comparison: 'wow' });

            const [, , , win] = mockCalls.comparison[0];
            expect(win.asin).toBe('B0TEST');
            const days = (Date.parse(win.endDate) - Date.parse(win.startDate)) / 86400000 + 1;
            expect(days).toBe(7);
            expect(r.data.comparison.hasComparison).toBe(true);
            expect(r.data.comparison.type).toBe('wow');
            expect(r.data.comparison.changes.sales).toEqual({ current: 100, previous: 80, delta: 20, percentChange: 25 });
            expect(r.data.comparison.changes.unitsSold).toEqual({ current: 2, previous: 1, delta: 1, percentChange: 100 });
            expect(r.data.comparison.previousWindow).toEqual({ startDate: '2026-09-24', endDate: '2026-09-30' });
        });

        it('mom uses 30-day windows', async () => {
            mockComparison = { current: null, previous: null };
            await getProductPerformanceByAsin({ userId: USER, region: 'NA', country: 'US', asin: 'B0TEST', comparison: 'mom' });
            const [, , , win] = mockCalls.comparison[0];
            expect((Date.parse(win.endDate) - Date.parse(win.startDate)) / 86400000 + 1).toBe(30);
        });

        it('no previous-window data -> no comparison (never a 100% change)', async () => {
            mockCurrent = asinDoc(300, 6);
            mockComparison = { current: asinDoc(100, 2), previous: null };

            const r = await getProductPerformanceByAsin({ userId: USER, region: 'NA', country: 'US', asin: 'B0TEST', comparison: 'wow' });

            expect(r.data.comparison).toBeNull();
        });
    });

    describe('ProductPerformanceComparisonService.fetchPreviousEconomicsData', () => {
        it('builds the previous window live from the current dateRange', async () => {
            mockBuilt = asinDoc(1, 1);

            const r = await fetchPreviousEconomicsData(USER, 'NA', 'US', 'mom', { dateRange: { startDate: '2026-09-21', endDate: '2026-10-20' } });

            expect(r).toBe(mockBuilt);
            expect(mockCalls.build[0]).toEqual({
                userId: USER, country: 'US', region: 'NA', startDate: '2026-08-22', endDate: '2026-09-20'
            });
        });

        it('no current dateRange or no comparison -> null without querying', async () => {
            expect(await fetchPreviousEconomicsData(USER, 'NA', 'US', 'wow', null)).toBeNull();
            expect(await fetchPreviousEconomicsData(USER, 'NA', 'US', 'none', { dateRange: { startDate: '2026-10-01', endDate: '2026-10-07' } })).toBeNull();
            expect(mockCalls.build).toHaveLength(0);
        });
    });

    describe('ProductHistoryService.getProductHistory', () => {
        it('sales series from DailySkuFinance, BuyBox newest-first', async () => {
            mockDateWise = [
                { date: '2026-10-01', productSales: 20, units: 2 },
                { date: '2026-10-02', productSales: 30, units: 3 },
            ];
            mockBuyBoxHistory = [{
                dateRange: { endDate: '2026-10-02' },
                asinBuyBoxData: [{ childAsin: 'B0TEST', sessions: 40, pageViews: 50, unitSessionPercentage: 7.5, buyBoxPercentage: 99 }],
            }];

            const r = await getProductHistory({ userId: USER, region: 'NA', country: 'US', asin: 'b0test', limit: 30 });

            expect(mockBuyBoxSort).toEqual({ createdAt: -1 });
            expect(mockDateWiseArgs).toEqual(expect.objectContaining({ asin: 'B0TEST', country: 'US', region: 'NA' }));
            expect((Date.parse(mockDateWiseArgs.endDate) - Date.parse(mockDateWiseArgs.startDate)) / 86400000 + 1).toBe(30);
            expect(r.history.map((h) => [h.date, h.sales, h.unitsSold, h.sessions])).toEqual([
                ['2026-10-01', 20, 2, 0],
                ['2026-10-02', 30, 3, 40],
            ]);
            expect(r.history[1]).toEqual(expect.objectContaining({ pageViews: 50, conversionRate: 7.5, buyBoxPercentage: 99 }));
            expect(typeof r.history[0].displayDate).toBe('string');
        });
    });

    describe('QMateProfitabilityService', () => {
        it('live-built doc with empty ASIN rows never reads the big-account collection', async () => {
            const doc = asinDoc(9000, 10);
            doc.asinWiseSales = [];
            mockCurrent = doc;

            const r = await QMateProfitabilityService.getParentChildAggregation(USER, 'US', 'NA');

            expect(r.success).toBe(true);
            expect(mockBigAccountCalls).toBe(0);
        });

        it('no economics -> success false, no data', async () => {
            const r = await QMateProfitabilityService.getParentChildAggregation(USER, 'US', 'NA');
            expect(r).toEqual(expect.objectContaining({ success: false, data: null }));
        });
    });
});

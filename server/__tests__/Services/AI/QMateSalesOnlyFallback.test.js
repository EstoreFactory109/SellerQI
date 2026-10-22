/**
 * QMate metrics and profitability contexts read live finance first.
 *
 * SalesOnlyMetrics.findLatest / getSalesForDateRange never return null — with no
 * rows they hand back a zero-filled doc — so the old `if (salesOnlyMetrics)`
 * short-circuit won for EVERY account and QMate answered "$0" over real live
 * sales. Pinned here:
 *   - live finance → real totals, SalesOnlyMetrics not consulted;
 *   - no live + real SalesOnlyMetrics rows → its sales;
 *   - neither → totals null and a no_finance_data marker, never $0.
 */

/** Any model the context touches but these tests do not: fails fast, never a DB. */
const mockNoDb = () => new Proxy({}, {
    get: (target, prop) => {
        if (prop === '__esModule') return false;
        return jest.fn(() => { throw new Error(`no database in tests (${String(prop)})`); });
    },
});

let mockLive = null;
const mockLoadCalls = [];
jest.mock('../../../Services/Finance/LiveEconomicsService.js', () => {
    const actual = jest.requireActual('../../../Services/Finance/LiveEconomicsService.js');
    return {
        ...actual,
        loadLiveEconomics: async (...args) => { mockLoadCalls.push(args); return mockLive; },
    };
});

let mockSalesOnly = null;
const mockSalesOnlyCalls = [];
jest.mock('../../../models/MCP/SalesOnlyMetricsModel.js', () => {
    const hasSalesOnlyRows = (doc) => Array.isArray(doc?.datewiseSales) && doc.datewiseSales.length > 0;
    return {
        findLatest: async (...args) => { mockSalesOnlyCalls.push(['findLatest', ...args]); return mockSalesOnly; },
        getSalesForDateRange: async (...args) => { mockSalesOnlyCalls.push(['getSalesForDateRange', ...args]); return mockSalesOnly; },
        hasSalesOnlyRows,
    };
});

jest.mock('../../../models/amazon-ads/PPCMetricsModel.js', () => ({
    rollupLastDays: async () => ({ found: true, summary: { totalSpend: 20, totalSales: 60 }, dateWiseMetrics: [], dateRange: null }),
    calculateMetricsForDateRange: async () => ({ found: true, summary: { totalSpend: 20, totalSales: 60 }, dateWiseMetrics: [] }),
}));
jest.mock('../../../models/system/IssueSummaryModel.js', () => ({ getIssueSummary: async () => null }));
jest.mock('../../../models/finance/CogsModel.js', () => ({ findOne: () => ({ lean: async () => null }) }));
jest.mock('../../../models/MCP/AsinWiseSalesForBigAccountsModel.js', () => mockNoDb());
jest.mock('../../../models/system/IssuesDataChunksModel.js', () => mockNoDb());
jest.mock('../../../models/MCP/BuyBoxDataModel.js', () => mockNoDb());
jest.mock('../../../models/seller-performance/V2_Seller_Performance_ReportModel.js', () => mockNoDb());
jest.mock('../../../models/seller-performance/V1_Seller_Performance_Report_Model.js', () => mockNoDb());
jest.mock('../../../models/products/OrderAndRevenueModel.js', () => mockNoDb());
jest.mock('../../../models/amazon-ads/adsKeywordsPerformanceModel.js', () => mockNoDb());
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => mockNoDb());
jest.mock('../../../models/finance/ProductWiseFinancialModel.js', () => mockNoDb());
jest.mock('../../../Services/Finance/ExpenseReadService.js', () => mockNoDb());
jest.mock('../../../Services/Sp_API/FinanceService.js', () => ({ buildExpenseReportResponseFromDB: async () => null }));
jest.mock('../../../Services/Calculations/AccountHealthHistory.js', () => ({ loadV2History: async () => [] }));
jest.mock('../../../Services/amazon-ads/ProductWiseSponsoredAdsService.js', () => ({ getAdsSpendByAsin: async () => new Map() }));
jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { assembleEconomicsDoc } = jest.requireActual('../../../Services/Finance/LiveEconomicsService.js');
const { getQMateMetricsContext } = require('../../../Services/AI/QMateMetricsService.js');
const { getQMateProfitabilityContext } = require('../../../Services/AI/QMateProfitabilityService.js');

const USER = '6a40e42712ce56d674f734a0';

function liveDoc() {
    const b = (id, sales, units, fba, referral) => ({
        _id: id, productSales: sales, units, fbaFulfillmentFee: fba, referralCommission: referral,
        totalExpenses: fba + referral,
    });
    return assembleEconomicsDoc({
        userId: USER, country: 'US', region: 'NA', startStr: '2026-10-01', endStr: '2026-10-02',
        byDate: [b('2026-10-01', 100, 4, -10, -15), b('2026-10-02', 50, 2, -5, -7.5)],
        byAsin: [b('A1', 150, 6, -15, -22.5)],
    });
}

/** What findLatest returns for a marketplace with no SalesOnlyMetrics rows. */
const zeroFilled = () => ({
    totalSales: { amount: 0, currencyCode: 'USD' },
    datewiseSales: [],
    dateRange: { startDate: null, endDate: null },
});

const salesOnlyRows = () => ({
    totalSales: { amount: 80, currencyCode: 'GBP' },
    datewiseSales: [
        { date: '2026-10-01', sales: { amount: 30, currencyCode: 'GBP' }, unitsSold: 1 },
        { date: '2026-10-02', sales: { amount: 50, currencyCode: 'GBP' }, unitsSold: 2 },
    ],
    dateRange: { startDate: '2026-10-01', endDate: '2026-10-02' },
});

beforeEach(() => {
    mockLive = null;
    mockSalesOnly = null;
    mockLoadCalls.length = 0;
    mockSalesOnlyCalls.length = 0;
});

describe('getQMateMetricsContext', () => {
    it('live finance gives real totals, even beside a zero-filled SalesOnlyMetrics doc', async () => {
        mockLive = liveDoc();
        mockSalesOnly = zeroFilled();

        const r = await getQMateMetricsContext(USER, 'US', 'NA');

        expect(r.success).toBe(true);
        expect(r.source).toBe('pre_computed');
        expect(r.data.summary.totalSales).toBe(150);
        expect(r.data.summary.salesDataAvailable).toBeUndefined();
        expect(r.data.noSalesData).toBeUndefined();
        expect(r.data.datewiseSales.map((d) => d.TotalAmount)).toEqual([100, 50]);
        // No short-circuit: SalesOnlyMetrics is never read when live has rows.
        expect(mockSalesOnlyCalls).toEqual([]);
        expect(mockLoadCalls[0][3]).toEqual({});
    });

    it('passes the requested range to live finance for a non-default calendar', async () => {
        mockLive = liveDoc();

        await getQMateMetricsContext(USER, 'US', 'NA', { startDate: '2026-10-01', endDate: '2026-10-02', calendarMode: 'custom' });

        expect(mockLoadCalls[0][3]).toEqual({ startDate: '2026-10-01', endDate: '2026-10-02' });
    });

    it('no live finance: SalesOnlyMetrics rows supply the sales', async () => {
        mockSalesOnly = salesOnlyRows();

        const r = await getQMateMetricsContext(USER, 'UK', 'EU');

        expect(r.source).toBe('sales_only_metrics');
        expect(r.data.summary.totalSales).toBe(80);
        expect(r.data.summary.currency).toBe('GBP');
        expect(mockSalesOnlyCalls[0][0]).toBe('findLatest');
    });

    it('a custom range reads SalesOnlyMetrics for that range, not the newest 31 days', async () => {
        mockSalesOnly = salesOnlyRows();

        await getQMateMetricsContext(USER, 'UK', 'EU', { startDate: '2026-10-01', endDate: '2026-10-02', calendarMode: 'custom' });

        expect(mockSalesOnlyCalls[0]).toEqual(['getSalesForDateRange', expect.anything(), 'EU', 'UK', '2026-10-01', '2026-10-02']);
    });

    it('neither source: totals null and a no_finance_data marker, never $0', async () => {
        mockSalesOnly = zeroFilled();

        const r = await getQMateMetricsContext(USER, 'US', 'NA');

        expect(r.success).toBe(true);
        expect(r.source).toBe('no_finance_data');
        const s = r.data.summary;
        for (const field of ['totalSales', 'grossProfit', 'netProfit', 'profitMargin', 'fbaFees', 'amazonFees', 'refunds']) {
            expect(s[field]).toBeNull();
        }
        expect(s.salesDataAvailable).toBe(false);
        // Ad spend is its own source and still known.
        expect(s.ppcSpend).toBe(20);
        expect(r.data.noSalesData.type).toBe('no_finance_data');
        // Unknown sales, unknown TACOS.
        expect(r.data.ppc.tacos).toBeNull();
        expect(r.data.datewiseSales).toEqual([]);
    });
});

describe('getQMateProfitabilityContext', () => {
    it('live finance takes the full path, with per-day units', async () => {
        mockLive = liveDoc();
        mockSalesOnly = zeroFilled();

        const r = await getQMateProfitabilityContext(USER, 'US', 'NA');

        expect(r.success).toBe(true);
        expect(r.source).toBe('combined_profitability_sources');
        expect(mockSalesOnlyCalls).toEqual([]);
        expect(r.data.datewiseProfitability.datewiseData.map((d) => [d.date, d.totalSales, d.unitsSold])).toEqual([
            ['2026-10-01', 100, 4],
            ['2026-10-02', 50, 2],
        ]);
        expect(r.data.datewiseProfitability.summary.totalUnitsSold).toBe(6);
        expect(r.data.overallSummary.totalSales).toBe(150);
    });

    it('no live finance: SalesOnlyMetrics rows give the sales-only context', async () => {
        mockSalesOnly = salesOnlyRows();

        const r = await getQMateProfitabilityContext(USER, 'UK', 'EU');

        expect(r.source).toBe('sales_only_profitability');
        expect(r.data.overallSummary.totalSales).toBe(80);
        expect(r.data.datewiseProfitability.datewiseData.map((d) => d.unitsSold)).toEqual([1, 2]);
    });

    it('neither source: no data, not a context of zeros', async () => {
        mockSalesOnly = zeroFilled();

        const r = await getQMateProfitabilityContext(USER, 'US', 'NA');

        expect(r.success).toBe(true);
        expect(r.source).toBe('no_finance_data');
        expect(r.data).toBeNull();
        expect(r.noData.type).toBe('no_finance_data');
    });
});

describe('SalesOnlyMetrics.hasSalesOnlyRows (the real helper)', () => {
    const Model = jest.requireActual('../../../models/MCP/SalesOnlyMetricsModel.js');

    it('is true only for real day rows', () => {
        expect(Model.hasSalesOnlyRows(salesOnlyRows())).toBe(true);
        expect(Model.hasSalesOnlyRows(zeroFilled())).toBe(false);
        expect(Model.hasSalesOnlyRows(null)).toBe(false);
        expect(Model.hasSalesOnlyRows({ datewiseSales: 'x' })).toBe(false);
        // Exposed both as a named export and as a model static.
        expect(Model.schema.statics.hasSalesOnlyRows).toBe(Model.hasSalesOnlyRows);
    });
});

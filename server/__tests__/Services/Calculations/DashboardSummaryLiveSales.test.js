/**
 * The lightweight dashboard endpoints (summary, phase 2, phase 3) read sales from
 * SalesOnlyMetrics, which exists for only a few marketplaces and has no fees, so
 * most accounts saw $0 sales and every account saw $0 gross profit. They now use
 * the live economics loader and the same conversions as the full pipeline
 * (Analyse.convertEconomicsToFinanceFormat, DashboardCalculation.getPpcSalesFromEconomics),
 * and show "no data" (null / []) when there is none.
 */

let mockEconomicsDoc = null;
jest.mock('../../../Services/Finance/LiveEconomicsService.js', () => {
    const actual = jest.requireActual('../../../Services/Finance/LiveEconomicsService.js');
    return { ...actual, loadLiveEconomics: jest.fn(async () => mockEconomicsDoc) };
});
jest.mock('../../../Services/Calculations/AccountHealthHistory.js', () => ({ loadV2History: jest.fn(async () => []) }));
jest.mock('../../../models/MCP/SalesOnlyMetricsModel.js', () => ({
    getRecentDays: jest.fn(() => { throw new Error('SalesOnlyMetrics must not be read by the dashboard'); }),
    aggregate: jest.fn(async () => []),
}));

const { loadLiveEconomics, assembleEconomicsDoc } = require('../../../Services/Finance/LiveEconomicsService.js');
const { loadV2History } = require('../../../Services/Calculations/AccountHealthHistory.js');
const SalesOnlyMetrics = require('../../../models/MCP/SalesOnlyMetricsModel.js');
const BuyBoxData = require('../../../models/MCP/BuyBoxDataModel.js');
const V2_Model = require('../../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const V1_Model = require('../../../models/seller-performance/V1_Seller_Performance_Report_Model.js');
const PPCMetrics = require('../../../models/amazon-ads/PPCMetricsModel.js');
const GetOrderDataModel = require('../../../models/products/OrderAndRevenueModel.js');
const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const adsKeywordsPerformanceModel = require('../../../models/amazon-ads/adsKeywordsPerformanceModel.js');
const DataFetchTracking = require('../../../models/system/DataFetchTrackingModel.js');
const IssueSummary = require('../../../models/system/IssueSummaryModel.js');
const PPCCampaignAnalysisService = require('../../../Services/Calculations/PPCCampaignAnalysisService.js');
const { AnalyseService } = require('../../../Services/main/Analyse.js');
const { getPpcSalesFromEconomics } = require('../../../Services/Calculations/DashboardCalculation.js');
const {
    getDashboardSummary,
    getDashboardPhase2,
    getDashboardPhase3,
    resolveDashboardTacos,
} = require('../../../Services/Calculations/DashboardSummaryService.js');

const USER = '6a40e42712ce56d674f734a0';
const PPC_SPEND = 42.5;

function liveDoc() {
    const bucket = (id, sales, units, fba, referral, refunded = 0) => ({
        _id: id, productSales: sales, units,
        fbaFulfillmentFee: fba, referralCommission: referral, refundedAmount: refunded,
        totalExpenses: fba + referral + refunded,
    });
    return assembleEconomicsDoc({
        userId: USER, country: 'US', region: 'NA',
        startStr: '2026-09-21', endStr: '2026-10-20',
        byDate: [
            bucket('2026-10-18', 150, 6, -18, -22.5),
            bucket('2026-10-19', 75, 3, -9, -11.25, -25),
            bucket('2026-10-20', 65, 3, -9, -9.75),
        ],
        byAsin: [bucket('A1', 290, 12, -36, -43.5, -25)],
    });
}

const chain = (value) => {
    const c = { sort: () => c, select: () => c, lean: async () => value };
    return c;
};

beforeEach(() => {
    mockEconomicsDoc = null;
    // jest.config resetMocks clears factory implementations before each test.
    loadLiveEconomics.mockImplementation(async () => mockEconomicsDoc);
    loadV2History.mockResolvedValue([]);
    jest.spyOn(BuyBoxData, 'findRecentDays').mockResolvedValue([]);
    jest.spyOn(V2_Model, 'findOne').mockReturnValue(chain(null));
    jest.spyOn(V1_Model, 'findOne').mockReturnValue(chain(null));
    jest.spyOn(GetOrderDataModel, 'findOne').mockReturnValue(chain(null));
    jest.spyOn(Seller, 'findOne').mockReturnValue(chain(null));
    jest.spyOn(DataFetchTracking, 'findOne').mockReturnValue(chain(null));
    jest.spyOn(adsKeywordsPerformanceModel, 'findMergedKeywordsData').mockResolvedValue([]);
    jest.spyOn(IssueSummary, 'getIssueSummary').mockResolvedValue(null);
    jest.spyOn(PPCMetrics, 'rollupLastDays').mockResolvedValue({
        found: true,
        dateRange: { startDate: '2026-09-21', endDate: '2026-10-20' },
        summary: { totalSpend: PPC_SPEND, totalSales: 100 },
        dateWiseMetrics: [],
    });
    jest.spyOn(PPCCampaignAnalysisService, 'getTotalWastedSpend').mockResolvedValue({ totalWastedSpend: 0 });
    jest.spyOn(PPCCampaignAnalysisService, 'aggregateTotalSales').mockResolvedValue({ totalSales: 850, daysWithData: 30 });
});

const withoutCreatedAt = ({ createdAt, ...rest }) => rest;

describe('dashboard sales come from the live economics doc', () => {
    test('summary, phase 2 and phase 3 match the full pipeline for the same doc', async () => {
        mockEconomicsDoc = liveDoc();
        const expectedTotals = await getPpcSalesFromEconomics(liveDoc());
        const expectedFinance = AnalyseService.convertEconomicsToFinanceFormat(liveDoc(), PPC_SPEND);
        // Sanity: the doc carries real fees, so gross profit is not the old hard-coded 0.
        expect(expectedTotals.totalSales).toBe(290);
        expect(expectedFinance.Gross_Profit).toBe(185.5);

        const [summary, phase2, phase3] = await Promise.all([
            getDashboardSummary(USER, 'US', 'NA'),
            getDashboardPhase2(USER, 'US', 'NA'),
            getDashboardPhase3(USER, 'US', 'NA'),
        ]);
        expect(summary.success).toBe(true);
        expect(phase2.success).toBe(true);
        expect(phase3.success).toBe(true);

        for (const data of [summary.data, phase2.data]) {
            expect(data.TotalWeeklySale).toBe(expectedTotals.totalSales);
            // createdAt is the doc's build time; each liveDoc() call builds its own.
            expect(withoutCreatedAt(data.accountFinance)).toEqual(withoutCreatedAt(expectedFinance));
            expect(data.accountFinance.ProductAdsPayment).toBe(PPC_SPEND);
        }

        const expectedSeries = [
            { date: '2026-10-18', sales: { amount: 150, currencyCode: 'USD' }, grossProfit: { amount: 109.5, currencyCode: 'USD' }, unitsSold: 6 },
            { date: '2026-10-19', sales: { amount: 75, currencyCode: 'USD' }, grossProfit: { amount: 29.75, currencyCode: 'USD' }, unitsSold: 3 },
            { date: '2026-10-20', sales: { amount: 65, currencyCode: 'USD' }, grossProfit: { amount: 46.25, currencyCode: 'USD' }, unitsSold: 3 },
        ];
        expect(summary.data.TotalSales).toEqual(expectedSeries);
        expect(phase3.data.TotalSales).toEqual(expectedSeries);
        expect(summary.data.TotalSales.reduce((s, d) => s + d.sales.amount, 0)).toBe(summary.data.TotalWeeklySale);

        // One load per request, with the default window (same as Analyse).
        expect(loadLiveEconomics).toHaveBeenCalledTimes(3);
        for (const call of loadLiveEconomics.mock.calls) expect(call).toEqual([USER, 'NA', 'US']);
        expect(SalesOnlyMetrics.getRecentDays).not.toHaveBeenCalled();
    });

    test('date range falls back to the economics window when there is no DataFetchTracking', async () => {
        mockEconomicsDoc = liveDoc();
        const { data } = await getDashboardSummary(USER, 'US', 'NA');
        expect(data.startDate).toBe('2026-09-21');
        expect(data.endDate).toBe('2026-10-20');
    });

    test('no doc -> null sales and finance, empty series, null TACoS without sales', async () => {
        mockEconomicsDoc = null;
        PPCCampaignAnalysisService.aggregateTotalSales.mockResolvedValue({ totalSales: 0, daysWithData: 0 });
        const expectedFinance = withoutCreatedAt(AnalyseService.convertEconomicsToFinanceFormat(null, PPC_SPEND));

        const [summary, phase2, phase3] = await Promise.all([
            getDashboardSummary(USER, 'US', 'NA'),
            getDashboardPhase2(USER, 'US', 'NA'),
            getDashboardPhase3(USER, 'US', 'NA'),
        ]);

        for (const data of [summary.data, phase2.data]) {
            expect(data.TotalWeeklySale).toBeNull();
            expect(withoutCreatedAt(data.accountFinance)).toEqual(expectedFinance);
            expect(data.accountFinance.Total_Sales).toBeNull();
            expect(data.accountFinance.Gross_Profit).toBeNull();
            expect(data.sponsoredAdsMetrics.tacos).toBeNull();
        }
        expect(summary.data.TotalSales).toEqual([]);
        expect(phase3.data.TotalSales).toEqual([]);
        expect(summary.data.startDate).toBeNull();
    });

    test('a failing economics load shows "no data" instead of failing the dashboard', async () => {
        loadLiveEconomics.mockRejectedValue(new Error('mongo down'));
        const { success, data } = await getDashboardPhase2(USER, 'US', 'NA');
        expect(success).toBe(true);
        expect(data.TotalWeeklySale).toBeNull();
    });
});

describe('resolveDashboardTacos', () => {
    const rollup = (totalSpend) => ({
        found: true,
        dateRange: { startDate: '2026-09-16', endDate: '2026-10-15' },
        summary: { totalSpend },
    });

    test('spend ÷ total sales × 100, over the rollup window', async () => {
        PPCCampaignAnalysisService.aggregateTotalSales.mockResolvedValue({ totalSales: 4000, daysWithData: 30 });
        expect(await resolveDashboardTacos(USER, 'US', 'NA', rollup(500))).toBe(12.5);
        expect(PPCCampaignAnalysisService.aggregateTotalSales).toHaveBeenCalledWith(USER, 'US', 'NA', '2026-09-16', '2026-10-15');
    });

    test('no sales at all -> null, not 0', async () => {
        PPCCampaignAnalysisService.aggregateTotalSales.mockResolvedValue({ totalSales: 0, daysWithData: 0 });
        expect(await resolveDashboardTacos(USER, 'US', 'NA', rollup(500))).toBeNull();
    });
});

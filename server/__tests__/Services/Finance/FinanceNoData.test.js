/**
 * A window with no DailySkuFinance rows is "no data", not a row of zeros.
 *
 * getTotals used to return every field as 0 when the aggregation found nothing,
 * so the Profitability page, QMate and the test endpoint all reported $0 sales.
 * It now returns null, getDashboard says so in metadata.hasFinanceData, and each
 * caller handles the null. The TACoS denominator (aggregateTotalSales) reads
 * DailySkuFinance first and SalesOnlyMetrics only when it has no rows.
 */

const mongoose = require('mongoose');
const DailySkuFinance = require('../../../models/finance/DailySkuFinanceModel.js');
const DailyOverheadFinance = require('../../../models/finance/DailyOverheadFinanceModel.js');
const AsinRelationship = require('../../../models/finance/AsinRelationshipModel.js');
const ProductWiseSponsoredAdsItem = require('../../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const SalesOnlyMetrics = require('../../../models/MCP/SalesOnlyMetricsModel.js');
const DataFetchTracking = require('../../../models/system/DataFetchTrackingModel.js');
const Cogs = require('../../../models/finance/CogsModel.js');
const PPCMetrics = require('../../../models/amazon-ads/PPCMetricsModel.js');
const readSvc = require('../../../Services/Finance/FinanceDashboardReadService.js');
const { aggregateTotalSales } = require('../../../Services/Calculations/PPCCampaignAnalysisService.js');
const FE = require('../../../Services/AI/layers/services/FinanceEngine.js');
const GeneralStrategyEngine = require('../../../Services/AI/layers/services/GeneralStrategyEngine.js');
const { testFinanceDashboardRead } = require('../../../controllers/test/FinanceDashboardTestController.js');

const USER = '6a40e42712ce56d674f734a0';
const CTX = { userId: USER, country: 'US', region: 'NA', startDate: '2026-09-21', endDate: '2026-10-20' };

function noFinanceRows() {
    jest.spyOn(DailySkuFinance, 'aggregate').mockResolvedValue([]);
    jest.spyOn(ProductWiseSponsoredAdsItem, 'aggregate').mockResolvedValue([]);
    jest.spyOn(ProductWiseSponsoredAdsItem, 'aggregateByAsinAndAdType').mockResolvedValue([]);
    jest.spyOn(DailyOverheadFinance, 'aggregate').mockResolvedValue([{ items: [], grandTotal: [] }]);
    jest.spyOn(AsinRelationship, 'aggregate').mockResolvedValue([{ families: [], standalone: [], childMappings: [] }]);
}

describe('FinanceDashboardReadService', () => {
    test('getTotals -> null when the window has no rows', async () => {
        noFinanceRows();
        expect(await readSvc.getTotals(CTX)).toBeNull();
    });

    test('getTotals still returns the sums when there are rows', async () => {
        noFinanceRows();
        DailySkuFinance.aggregate
            .mockResolvedValueOnce([{ productSales: 290, units: 12, totalExpenses: -104.5 }])
            .mockResolvedValueOnce([]);
        ProductWiseSponsoredAdsItem.aggregate.mockResolvedValue([{ _id: 'SP', spend: 10 }]);
        const totals = await readSvc.getTotals(CTX);
        expect(totals).toEqual(expect.objectContaining({ productSales: 290, adsSpend: 10, totalExpenses: -94.5 }));
    });

    test('getDashboard -> totals null and metadata.hasFinanceData false', async () => {
        noFinanceRows();
        const data = await readSvc.getDashboard(CTX);
        expect(data.totals).toBeNull();
        expect(data.dateWise).toEqual([]);
        expect(data.metadata).toEqual({
            startDate: CTX.startDate, endDate: CTX.endDate, country: 'US', region: 'NA',
            uniqueAsins: 0, totalDays: 0, hasFinanceData: false,
        });
    });

    test('getDashboard -> metadata.hasFinanceData true when there are days', async () => {
        noFinanceRows();
        DailySkuFinance.aggregate.mockImplementation(async (pipeline) => {
            const group = pipeline.find((s) => s.$group)?.$group;
            if (group && group._id === null) return [{ productSales: 50 }];
            if (group && group._id === '$date') return [{ date: '2026-10-20', productSales: 50 }];
            return [];
        });
        const data = await readSvc.getDashboard(CTX);
        expect(data.totals).toEqual(expect.objectContaining({ productSales: 50 }));
        expect(data.metadata.hasFinanceData).toBe(true);
        expect(data.metadata.totalDays).toBe(1);
    });
});

describe('getTotals / getDashboard callers handle null', () => {
    beforeEach(() => {
        noFinanceRows();
        jest.spyOn(DataFetchTracking, 'findOne').mockReturnValue({ sort: async () => null });
        jest.spyOn(Cogs, 'findOne').mockReturnValue({ lean: async () => null });
        jest.spyOn(PPCMetrics, 'calculateMetricsForDateRange').mockResolvedValue({ found: true, summary: { totalSpend: 80 } });
    });

    const interpretation = (raw) => ({
        intent: 'value_lookup',
        entities: { metrics: [], asins: [], queryShape: 'generic', timeRange: { startDate: CTX.startDate, endDate: CTX.endDate } },
        routing: { engine: 'information_engine' },
        raw,
    });

    test('QMate finance question -> no_finance_data, never $0', async () => {
        const r = await FE.handleFinanceQuery(interpretation('What were my total sales?'), CTX, {});
        expect(r.type).toBe('no_finance_data');
        expect(r.available).toBe(false);
        expect(r.message).toContain('no finance data');
        expect(r).not.toHaveProperty('metrics');
    });

    test('QMate fallback narration says "no data" without an amount', async () => {
        const narration = await FE.narrateFinanceResult(
            { type: 'no_finance_data', dateRange: { startDate: CTX.startDate, endDate: CTX.endDate }, message: 'SellerQI has no finance data for 2026-09-21 to 2026-10-20 yet.' },
            'sales?',
            null,
        );
        expect(narration).toContain('no finance data');
        expect(narration).not.toMatch(/\$/);
    });

    test('suggestion-engine finance context is null, not a $0 summary', async () => {
        expect(await FE.buildFinanceSuggestionContext(interpretation('how do I grow?'), CTX, {})).toBeNull();
    });

    test('strategy finance context is null, not a $0 summary', async () => {
        expect(await GeneralStrategyEngine.getFinanceContext(CTX, { startDate: CTX.startDate, endDate: CTX.endDate })).toBeNull();
    });

    test('test read endpoint reports null totals instead of throwing', async () => {
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await testFinanceDashboardRead({ body: { ...CTX } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, totalSales: null, totalExpenses: null }));
    });
});

describe('aggregateTotalSales (TACoS denominator)', () => {
    test('DailySkuFinance first', async () => {
        jest.spyOn(DailySkuFinance, 'aggregate').mockResolvedValue([{ _id: null, totalSales: 850.123, unitsSold: 40, daysWithData: 30 }]);
        const salesOnly = jest.spyOn(SalesOnlyMetrics, 'aggregate').mockResolvedValue([]);

        const r = await aggregateTotalSales(USER, 'US', 'NA', CTX.startDate, CTX.endDate);

        expect(r).toEqual({ totalSales: 850.12, unitsSold: 40, currencyCode: 'USD', daysWithData: 30, source: 'DailySkuFinance' });
        expect(salesOnly).not.toHaveBeenCalled();
        const match = DailySkuFinance.aggregate.mock.calls[0][0][0].$match;
        expect(match).toEqual({ User: new mongoose.Types.ObjectId(USER), region: 'NA', country: 'US', date: { $gte: CTX.startDate, $lte: CTX.endDate } });
    });

    test('SalesOnlyMetrics only when DailySkuFinance has no rows', async () => {
        jest.spyOn(DailySkuFinance, 'aggregate').mockResolvedValue([]);
        jest.spyOn(SalesOnlyMetrics, 'aggregate').mockResolvedValue([{ _id: null, totalSales: 300, unitsSold: 9, currencyCode: 'GBP', daysWithData: 5 }]);

        const r = await aggregateTotalSales(USER, 'UK', 'EU', CTX.startDate, CTX.endDate);

        expect(r).toEqual(expect.objectContaining({ totalSales: 300, daysWithData: 5, source: 'SalesOnlyMetrics' }));
    });

    test('neither -> daysWithData 0', async () => {
        jest.spyOn(DailySkuFinance, 'aggregate').mockResolvedValue([]);
        jest.spyOn(SalesOnlyMetrics, 'aggregate').mockResolvedValue([]);
        const r = await aggregateTotalSales(USER, 'US', 'NA', CTX.startDate, CTX.endDate);
        expect(r).toEqual(expect.objectContaining({ totalSales: 0, daysWithData: 0, source: null }));
    });
});

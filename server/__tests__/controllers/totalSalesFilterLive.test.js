/**
 * TotalSalesFilterController.getCustomRangeData used to hard-code gross profit,
 * FBA/Amazon fees and refunds to 0 and asinWiseSales to [], and returned nothing
 * at all for the many marketplaces with no SalesOnlyMetrics. Those fields now come
 * from DailySkuFinance for the range; the sales headline keeps SalesOnlyMetrics
 * where it exists.
 */

let mockSalesOnly = null;
let mockRecentDays = null;
jest.mock('../../models/MCP/SalesOnlyMetricsModel.js', () => ({
    getSalesForDateRange: async () => mockSalesOnly,
    getRecentDays: async () => mockRecentDays,
}));

jest.mock('../../models/amazon-ads/PPCMetricsModel.js', () => ({
    calculateMetricsForDateRange: async () => ({ found: true, summary: { totalSpend: 33.3 }, numberOfDays: 3 }),
}));

let mockLive = null;
let mockLiveArgs = [];
jest.mock('../../Services/Finance/LiveEconomicsService.js', () => {
    const actual = jest.requireActual('../../Services/Finance/LiveEconomicsService.js');
    return {
        ...actual,
        buildEconomicsFromDailyFinance: async (args) => {
            mockLiveArgs.push(args);
            return mockLive;
        },
    };
});

const { assembleEconomicsDoc } = jest.requireActual('../../Services/Finance/LiveEconomicsService.js');
const { getTotalSalesFilteredData } = require('../../controllers/analytics/TotalSalesFilterController.js');

function liveDoc() {
    const b = (id, sales, fba, referral, refunded = 0) => ({
        _id: id, productSales: sales, units: 1, fbaFulfillmentFee: fba, referralCommission: referral,
        refundedAmount: refunded, totalExpenses: fba + referral + refunded,
    });
    return assembleEconomicsDoc({
        userId: 'u', country: 'US', region: 'NA', startStr: '2026-10-01', endStr: '2026-10-02',
        byDate: [b('2026-10-01', 100, -10, -15), b('2026-10-02', 50, -5, -7.5, -20)],
        byAsin: [b('A1', 150, -15, -22.5, -20)],
    });
}

const somDoc = () => ({
    totalSales: { amount: 160, currencyCode: 'USD' },
    datewiseSales: [
        { date: '2026-10-01', sales: { amount: 110, currencyCode: 'USD' } },
        { date: '2026-10-02', sales: { amount: 50, currencyCode: 'USD' } },
    ],
});

const RANGE = { periodType: 'custom', startDate: '2026-10-01', endDate: '2026-10-02' };

describe('total sales filter on live finance', () => {
    beforeEach(() => {
        mockSalesOnly = null;
        mockRecentDays = null;
        mockLive = null;
        mockLiveArgs = [];
    });

    it('no SalesOnlyMetrics: everything from DailySkuFinance for the range', async () => {
        mockLive = liveDoc();

        const r = await getTotalSalesFilteredData('u', 'US', 'NA', RANGE);

        expect(mockLiveArgs[0]).toEqual(expect.objectContaining({ startDate: '2026-10-01', endDate: '2026-10-02' }));
        expect(r.totalSales).toEqual({ amount: 150, currencyCode: 'USD' });
        // 150 - (25 + 32.5)
        expect(r.grossProfit).toEqual({ amount: 92.5, currencyCode: 'USD' });
        expect(r.fbaFees).toEqual({ amount: 15, currencyCode: 'USD' });
        expect(r.refunds).toEqual({ amount: 20, currencyCode: 'USD' });
        expect(r.amazonFees).toEqual({ amount: 37.5, currencyCode: 'USD' });
        expect(r.otherAmazonFees).toEqual({ amount: 22.5, currencyCode: 'USD' });
        expect(r.ppcSpent).toEqual({ amount: 33.3, currencyCode: 'USD' });
        expect(r.dateRange).toEqual({ startDate: '2026-10-01', endDate: '2026-10-02' });
        expect(r.currencyCode).toBe('USD');
        expect(r.datewiseChartData.map((d) => [d.originalDate, d.totalSales, d.grossProfit])).toEqual([
            ['2026-10-01', 100, 75],
            ['2026-10-02', 50, 17.5],
        ]);
        expect(r.asinWiseSales).toHaveLength(1);
        expect(r.asinWiseSales[0]).toEqual(expect.objectContaining({ asin: 'A1', unitsSold: 1 }));
        expect(r.asinWiseSales[0].sales.amount).toBe(150);
    });

    it('SalesOnlyMetrics present: sales headline kept, fees/profit filled from live finance', async () => {
        mockSalesOnly = somDoc();
        mockLive = liveDoc();

        const r = await getTotalSalesFilteredData('u', 'US', 'NA', RANGE);

        expect(r.totalSales.amount).toBe(160);
        expect(r.grossProfit.amount).toBe(92.5);
        expect(r.fbaFees.amount).toBe(15);
        expect(r.refunds.amount).toBe(20);
        expect(r.datewiseChartData.map((d) => [d.totalSales, d.grossProfit])).toEqual([[110, 75], [50, 17.5]]);
        expect(r.asinWiseSales).toHaveLength(1);
    });

    it('SalesOnlyMetrics only: fee fields stay 0 as before', async () => {
        mockSalesOnly = somDoc();

        const r = await getTotalSalesFilteredData('u', 'US', 'NA', RANGE);

        expect(r.totalSales.amount).toBe(160);
        expect(r.grossProfit.amount).toBe(0);
        expect(r.fbaFees.amount).toBe(0);
        expect(r.asinWiseSales).toEqual([]);
    });

    it('neither source: the empty result', async () => {
        const r = await getTotalSalesFilteredData('u', 'US', 'NA', RANGE);

        expect(r.totalSales).toEqual({ amount: 0, currencyCode: 'USD' });
        expect(r.dateRange).toEqual({ startDate: null, endDate: null });
        expect(r.asinWiseSales).toEqual([]);
    });

    it('last30 with no SalesOnlyMetrics reads live finance for the 30 days ending yesterday', async () => {
        mockLive = liveDoc();

        const r = await getTotalSalesFilteredData('u', 'US', 'NA', { periodType: 'last30' });

        const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        expect(mockLiveArgs[0].endDate).toBe(y);
        expect(r.totalSales.amount).toBe(150);
    });
});

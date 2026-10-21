/**
 * The readers swapped onto LiveEconomicsService keep their output shape when
 * handed a doc built from DailySkuFinance, and report "no data" (null) — not 0,
 * not an old doc — when the loader returns null.
 *
 * Field-level assertions on purpose (no snapshots): each field below is one a
 * dashboard card, chart or QMate answer reads.
 */

let mockBigAccountCalls = 0;
jest.mock('../../../models/MCP/AsinWiseSalesForBigAccountsModel.js', () => ({
    getProfitabilityMapByMetricsId: async () => {
        mockBigAccountCalls++;
        return new Map([['OLD', { sales: 999 }]]);
    },
    aggregate: async () => {
        mockBigAccountCalls++;
        return [];
    }
}));

let mockLoad = async () => null;
let mockLoadCalls = [];
jest.mock('../../../Services/Finance/LiveEconomicsService.js', () => {
    const actual = jest.requireActual('../../../Services/Finance/LiveEconomicsService.js');
    return {
        ...actual,
        loadLiveEconomics: async (...args) => {
            mockLoadCalls.push(args);
            return mockLoad(...args);
        }
    };
});

const { assembleEconomicsDoc } = jest.requireActual('../../../Services/Finance/LiveEconomicsService.js');
const { AnalyseService } = require('../../../Services/main/Analyse.js');
const { getPpcSalesFromEconomics } = require('../../../Services/Calculations/DashboardCalculation.js');
const ProfitabilityService = require('../../../Services/Calculations/ProfitabilityService.js');

// Grouped sums as the DailySkuFinance aggregation returns them (fees negative).
function builtDoc() {
    const bucket = (id, sales, units, fba, referral, refunded = 0) => ({
        _id: id, productSales: sales, units,
        fbaFulfillmentFee: fba, referralCommission: referral, refundedAmount: refunded,
        totalExpenses: fba + referral + refunded,
    });
    return assembleEconomicsDoc({
        userId: '6a40e42712ce56d674f734a0', country: 'US', region: 'NA',
        startStr: '2026-10-01', endStr: '2026-10-03',
        byDate: [
            bucket('2026-10-01', 150, 6, -18, -22.5),
            bucket('2026-10-02', 75, 3, -9, -11.25, -25),
            bucket('2026-10-03', 65, 3, -9, -9.75),
        ],
        byAsin: [
            bucket('A1', 200, 8, -24, -30, -25),
            bucket('B2', 90, 4, -12, -13.5),
        ],
        adsRows: [{ asin: 'A1', adType: 'SP', spend: 12.5 }, { asin: 'B2', adType: 'SP', spend: 4 }],
    });
}
// totals: sales 290, expenses 104.5 (incl. 25 refunds), amazonFees 79.5, fba 36, gross profit 185.5

describe('readers on live economics', () => {
    beforeEach(() => {
        mockBigAccountCalls = 0;
        mockLoad = async () => null;
        mockLoadCalls = [];
    });

    describe('Analyse.convertEconomicsToFinanceFormat', () => {
        it('built doc -> same legacy fields, live values', () => {
            const f = AnalyseService.convertEconomicsToFinanceFormat(builtDoc(), 16.5);
            expect(f.Total_Sales).toBe(290);
            expect(f.Gross_Profit).toBe(185.5);
            expect(f.ProductAdsPayment).toBe(16.5);
            expect(f.FBA_Fees).toBe(36);
            expect(f.Storage).toBe(0);
            expect(f.Refunds).toBe(25);
            expect(f.Amazon_Fees).toBe(79.5);
            expect(f.Amazon_Charges).toBe(79.5);
            expect(f.Other_Amazon_Fees).toBe(43.5);
            expect(f.createdAt).toBeInstanceOf(Date);
        });

        it('null -> no data (null), ads spend still passed through', () => {
            const f = AnalyseService.convertEconomicsToFinanceFormat(null, 16.5);
            expect(f.Total_Sales).toBeNull();
            expect(f.Gross_Profit).toBeNull();
            expect(f.FBA_Fees).toBeNull();
            expect(f.Storage).toBeNull();
            expect(f.Refunds).toBeNull();
            expect(f.Amazon_Fees).toBeNull();
            expect(f.Amazon_Charges).toBeNull();
            expect(f.Other_Amazon_Fees).toBeNull();
            expect(f.ProductAdsPayment).toBe(16.5);
        });

        it('TotalSales series from the built doc', () => {
            const t = AnalyseService.convertEconomicsToTotalSalesFormat(builtDoc());
            expect(t.totalSales).toEqual([
                { interval: '2026-10-01', TotalAmount: 150, Profit: 109.5 },
                { interval: '2026-10-02', TotalAmount: 75, Profit: 29.75 },
                { interval: '2026-10-03', TotalAmount: 65, Profit: 46.25 },
            ]);
            expect(AnalyseService.convertEconomicsToTotalSalesFormat(null)).toEqual({ totalSales: [] });
        });
    });

    describe('Analyse.processCustomDateRange', () => {
        const start = new Date(2026, 9, 1, 0, 0, 0, 0);
        const end = new Date(2026, 9, 3, 23, 59, 59, 999);

        it('loads the picked range and keeps the response shape', async () => {
            mockLoad = async () => builtDoc();

            const r = await AnalyseService.processCustomDateRange('u1', 'US', 'NA', start, end, 3);

            expect(mockLoadCalls[0]).toEqual(['u1', 'NA', 'US', { startDate: '2026-10-01', endDate: '2026-10-03' }]);
            expect(r.status).toBe(200);
            const m = r.message;
            expect(m.startDate).toBe('2026-10-01');
            expect(m.endDate).toBe('2026-10-03');
            expect(m.Country).toBe('US');
            expect(m.FinanceData).toEqual({
                Gross_Profit: 185.5, // datewise gross profit: 109.5 + 29.75 + 46.25
                ProductAdsPayment: 16.5,
                FBA_Fees: 36,
                Storage: 0,
                Amazon_Charges: 36,
                Refunds: 25,
            });
            expect(m.reimburstmentData).toBe(0);
            expect(m.TotalSales.totalSales).toBe(290);
            expect(m.TotalSales.dateWiseSales).toHaveLength(3);
            expect(m.TotalSales.dateWiseSales[0]).toEqual(expect.objectContaining({
                TotalAmount: 150, Profit: 109.5, date: '2026-10-01'
            }));
            expect(typeof m.TotalSales.dateWiseSales[0].interval).toBe('string');
        });

        it('filters a wider stored doc down to the range and prorates its PPC', async () => {
            const wide = builtDoc();
            delete wide.source;
            wide.dateRange = { startDate: '2026-09-30', endDate: '2026-10-05' };
            wide.ppcSpent = { amount: 60, currencyCode: 'USD' };
            mockLoad = async () => wide;

            const r = await AnalyseService.processCustomDateRange('u1', 'US', 'NA',
                new Date(2026, 9, 2), new Date(2026, 9, 3, 23, 59, 59, 999), 2);

            expect(r.message.TotalSales.totalSales).toBe(140);
            expect(r.message.TotalSales.dateWiseSales.map((d) => d.date)).toEqual(['2026-10-02', '2026-10-03']);
            // 2 of the doc's 6 days
            expect(r.message.FinanceData.ProductAdsPayment).toBe(20);
        });

        it('no economics -> null totals, not 0 and not an estimate', async () => {
            const r = await AnalyseService.processCustomDateRange('u1', 'US', 'NA', start, end, 3);

            expect(r.status).toBe(200);
            expect(r.message.FinanceData).toEqual({
                Gross_Profit: null, ProductAdsPayment: null, FBA_Fees: null,
                Storage: null, Amazon_Charges: null, Refunds: null,
            });
            expect(r.message.TotalSales).toEqual({ totalSales: null, dateWiseSales: [] });
        });
    });

    describe('DashboardCalculation.getPpcSalesFromEconomics', () => {
        it('built doc -> live totals and per-ASIN map, never the big-account collection', async () => {
            const doc = builtDoc();
            const r = await getPpcSalesFromEconomics(doc);

            expect(r.totalSales).toBe(290);
            expect(r.totalGrossProfit).toBe(185.5);
            expect(Object.keys(r.asinPpcSales).sort()).toEqual(['A1', 'B2']);
            expect(r.asinPpcSales.A1).toEqual(expect.objectContaining({
                sales: 200, unitsSold: 8, totalFees: 79, amazonFees: 54, fbaFees: 24, ppcSpent: 12.5
            }));
            expect(mockBigAccountCalls).toBe(0);
        });

        it('built doc with no ASIN rows and big sales -> still no big-account lookup', async () => {
            const doc = builtDoc();
            doc.asinWiseSales = [];
            doc.totalSales.amount = 9000;

            const r = await getPpcSalesFromEconomics(doc);

            expect(r.asinPpcSales).toEqual({});
            expect(mockBigAccountCalls).toBe(0);
        });

        it('a stored big-account doc still reads its side collection', async () => {
            const r = await getPpcSalesFromEconomics({ _id: 'em1', isBig: true, asinWiseSales: [], datewiseSales: [] });
            expect(mockBigAccountCalls).toBe(1);
            expect(r.asinPpcSales.OLD).toBeDefined();
        });

        it('null -> totals null (no data), empty map', async () => {
            const r = await getPpcSalesFromEconomics(null);
            expect(r).toEqual({ totalPpcSales: 0, asinPpcSales: {}, totalSales: null, totalGrossProfit: null });
        });
    });

    describe('ProfitabilityService', () => {
        it('getAsinPpcSalesFromEconomics: built doc -> live map, no big-account lookup', async () => {
            const doc = builtDoc();
            doc.asinWiseSales = doc.asinWiseSales.slice(0, 1);
            const r = await ProfitabilityService.getAsinPpcSalesFromEconomics(doc);

            expect(r.totalSales).toBe(290);
            expect(r.asinPpcSales.A1).toEqual(expect.objectContaining({ sales: 200, unitsSold: 8, totalFees: 79, parentAsin: 'A1' }));
            expect(mockBigAccountCalls).toBe(0);
        });

        it('getAsinPpcSalesFromEconomics: null -> null totals', async () => {
            expect(await ProfitabilityService.getAsinPpcSalesFromEconomics(null))
                .toEqual({ asinPpcSales: {}, totalSales: null, totalGrossProfit: null });
        });

        it('convertToAccountFinance: built doc fields and null -> null', () => {
            const f = ProfitabilityService.convertToAccountFinance(builtDoc(), 16.5);
            expect(f.Total_Sales).toBe(290);
            expect(f.FBA_Fees).toBe(36);
            expect(f.Refunds).toBe(25);
            expect(f.ProductAdsPayment).toBe(16.5);

            const n = ProfitabilityService.convertToAccountFinance(null, 3);
            expect(n.Total_Sales).toBeNull();
            expect(n.Gross_Profit).toBeNull();
            expect(n.Refunds).toBeNull();
            expect(n.ProductAdsPayment).toBe(3);
        });
    });
});

/**
 * Tests for LiveEconomicsService — the one loader for account economics.
 *
 * EconomicsMetrics stopped being written in March 2026, so these lock down the
 * rule every reader now relies on:
 *   - a FRESH stored doc passes through untouched;
 *   - otherwise the doc is built from DailySkuFinance, in the same shape, with
 *     sums that add up (fees stored NEGATIVE become positive magnitudes);
 *   - with neither, the answer is null ("no data"), never a stale doc or zeros.
 */

const DAY = 86400000;

// Raw DailySkuFinance rows; the aggregate mock groups them the way the
// pipeline's $group asks, so the sums under test are the service's own.
let mockRows = [];
let mockAggregateThrows = null;
let mockPipelines = [];
jest.mock('../../../models/finance/DailySkuFinanceModel.js', () => ({
    aggregate: (pipeline) => {
        mockPipelines.push(pipeline);
        if (mockAggregateThrows) return Promise.reject(mockAggregateThrows);
        const match = pipeline[0].$match;
        const group = pipeline[1].$group;
        const keyField = String(group._id).replace('$', '');
        const rows = mockRows.filter((r) => r.date >= match.date.$gte && r.date <= match.date.$lte
            && r.country === match.country && r.region === match.region);
        const out = new Map();
        for (const r of rows) {
            const k = r[keyField] ?? null;
            if (!out.has(k)) out.set(k, { _id: k });
            const acc = out.get(k);
            for (const [f, spec] of Object.entries(group)) {
                if (f === '_id') continue;
                const field = String(spec.$sum).replace('$', '');
                acc[f] = (acc[f] || 0) + (r[field] || 0);
            }
        }
        return Promise.resolve([...out.values()]);
    }
}));

let mockHead = null;
let mockFullDoc = null;
let mockFindByIdCalls = 0;
jest.mock('../../../models/MCP/EconomicsMetricsModel.js', () => ({
    findLatest: () => ({
        select: () => ({ lean: () => Promise.resolve(mockHead) })
    }),
    findById: () => {
        mockFindByIdCalls++;
        return { lean: () => Promise.resolve(mockFullDoc) };
    }
}));

let mockAdsRows = [];
jest.mock('../../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js', () => ({
    aggregateByAsinAndAdType: () => Promise.resolve(mockAdsRows)
}));

const {
    loadLiveEconomics,
    buildEconomicsFromDailyFinance,
    loadEconomicsComparison,
    previousWindow,
    isStoredEconomicsDoc,
    isLiveEconomicsDoc,
} = require('../../../Services/Finance/LiveEconomicsService.js');

const USER = '6a40e42712ce56d674f734a0';

function row(date, asin, { sales, units, fba, referral, refunded = 0, promo = 0 }) {
    const totalExpenses = fba + referral + refunded + promo;
    return {
        country: 'US', region: 'NA', date, asin, sku: `${asin}-SKU`,
        productSales: sales, units,
        fbaFulfillmentFee: fba, referralCommission: referral,
        refundedAmount: refunded, promotionsDiscount: promo,
        totalExpenses,
    };
}

// 3 days x 2 ASINs. Fees/refunds negative, as stored.
function fixture() {
    return [
        row('2026-10-01', 'A1', { sales: 100, units: 4, fba: -12, referral: -15 }),
        row('2026-10-01', 'B2', { sales: 50, units: 2, fba: -6, referral: -7.5 }),
        row('2026-10-02', 'A1', { sales: 75, units: 3, fba: -9, referral: -11.25, refunded: -25 }),
        row('2026-10-02', 'B2', { sales: 0, units: 0, fba: 0, referral: 0 }),
        row('2026-10-03', 'A1', { sales: 25, units: 1, fba: -3, referral: -3.75 }),
        row('2026-10-03', 'B2', { sales: 40, units: 2, fba: -6, referral: -6, promo: -4 }),
    ];
}

describe('LiveEconomicsService', () => {
    beforeEach(() => {
        mockRows = [];
        mockAggregateThrows = null;
        mockPipelines = [];
        mockHead = null;
        mockFullDoc = null;
        mockFindByIdCalls = 0;
        mockAdsRows = [];
    });

    describe('buildEconomicsFromDailyFinance', () => {
        it('builds the EconomicsMetrics shape with sums that add up', async () => {
            mockRows = fixture();
            mockAdsRows = [
                { asin: 'A1', adType: 'SP', spend: 10 },
                { asin: 'A1', adType: 'SD', spend: 2.5 },
                { asin: 'B2', adType: 'SP', spend: 4 },
            ];

            const doc = await buildEconomicsFromDailyFinance({
                userId: USER, country: 'US', region: 'NA', startDate: '2026-10-01', endDate: '2026-10-03'
            });

            // Headline totals
            expect(doc.totalSales).toEqual({ amount: 290, currencyCode: 'USD' });
            // expenses = 27 + 13.5 + 45.25 + 0 + 6.75 + 16 = 108.5
            expect(doc.totalFees.amount).toBe(108.5);
            expect(doc.refunds.amount).toBe(25);
            expect(doc.amazonFees.amount).toBe(83.5);
            expect(doc.fbaFees.amount).toBe(36);
            expect(doc.storageFees.amount).toBe(0);
            // Before ads, like EconomicsMetrics: sales - amazonFees - refunds.
            expect(doc.grossProfit.amount).toBe(181.5);
            expect(doc.grossProfit.amount).toBe(doc.totalSales.amount - doc.amazonFees.amount - doc.refunds.amount);
            expect(doc.ppcSpent.amount).toBe(16.5);

            // Metadata
            expect(doc.dateRange).toEqual({ startDate: '2026-10-01', endDate: '2026-10-03' });
            expect(doc.isBig).toBe(false);
            expect(doc.source).toBe('daily_sku_finance');
            expect(doc.createdAt).toBeInstanceOf(Date);
            expect(isLiveEconomicsDoc(doc)).toBe(true);
            expect(isStoredEconomicsDoc(doc)).toBe(false);

            // Date-wise series, ascending, summing to the totals
            expect(doc.datewiseSales.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
            expect(doc.datewiseSales[0]).toEqual({
                date: '2026-10-01',
                sales: { amount: 150, currencyCode: 'USD' },
                grossProfit: { amount: 109.5, currencyCode: 'USD' },
                unitsSold: 6
            });
            // Units per day, so date-wise readers (QMate, charts) need no second query.
            expect(doc.datewiseSales.map((d) => d.unitsSold)).toEqual([6, 3, 3]);
            const sum = (arr, f) => Math.round(arr.reduce((s, x) => s + f(x), 0) * 100) / 100;
            expect(sum(doc.datewiseSales, (d) => d.sales.amount)).toBe(290);
            expect(sum(doc.datewiseGrossProfit, (d) => d.grossProfit.amount)).toBe(181.5);
            expect(doc.datewiseFeesAndRefunds[1]).toEqual({
                date: '2026-10-02',
                fbaFulfillmentFee: { amount: 9, currencyCode: 'USD' },
                storageFee: { amount: 0, currencyCode: 'USD' },
                refunds: { units: 0, amount: 25, currencyCode: 'USD' }
            });
            expect(sum(doc.datewiseAmazonFees, (d) => d.totalAmount.amount)).toBe(83.5);
            expect(doc.datewiseAmazonFees[2].feeBreakdown).toEqual(expect.arrayContaining([
                { feeType: 'Promotions Discount', amount: 4 }
            ]));

            // Per-ASIN rows, highest sales first
            expect(doc.asinWiseSales.map((a) => a.asin)).toEqual(['A1', 'B2']);
            const a1 = doc.asinWiseSales[0];
            expect(a1.sales.amount).toBe(200);
            expect(a1.unitsSold).toBe(8);
            expect(a1.fbaFees.amount).toBe(24);
            expect(a1.refunds.amount).toBe(25);
            expect(a1.totalFees.amount).toBe(79);
            expect(a1.amazonFees.amount).toBe(54);
            expect(a1.grossProfit.amount).toBe(121);
            expect(a1.ppcSpent.amount).toBe(12.5);
            expect(a1.storageFees.amount).toBe(0);
            const b2 = doc.asinWiseSales[1];
            expect(b2).toEqual(expect.objectContaining({ asin: 'B2', unitsSold: 4 }));
            expect(b2.sales.amount).toBe(90);
            expect(b2.grossProfit.amount).toBe(60.5);
            expect(b2.ppcSpent.amount).toBe(4);
            expect(sum(doc.asinWiseSales, (a) => a.sales.amount)).toBe(doc.totalSales.amount);
        });

        it('uses the marketplace currency', async () => {
            mockRows = fixture().map((r) => ({ ...r, country: 'UK', region: 'EU' }));
            const doc = await buildEconomicsFromDailyFinance({
                userId: USER, country: 'UK', region: 'EU', startDate: '2026-10-01', endDate: '2026-10-03'
            });
            expect(doc.totalSales.currencyCode).toBe('GBP');
            expect(doc.asinWiseSales[0].sales.currencyCode).toBe('GBP');
        });

        it('rows without an ASIN count in totals but not per ASIN', async () => {
            mockRows = [...fixture(), row('2026-10-02', '', { sales: 10, units: 1, fba: 0, referral: 0 })];
            const doc = await buildEconomicsFromDailyFinance({
                userId: USER, country: 'US', region: 'NA', startDate: '2026-10-01', endDate: '2026-10-03'
            });
            expect(doc.totalSales.amount).toBe(300);
            expect(doc.asinWiseSales.map((a) => a.asin)).toEqual(['A1', 'B2']);
        });

        it('queries the window as YYYY-MM-DD strings', async () => {
            mockRows = fixture();
            await buildEconomicsFromDailyFinance({
                userId: USER, country: 'US', region: 'NA',
                startDate: new Date('2026-10-01T00:00:00Z'), endDate: '2026-10-03'
            });
            expect(mockPipelines[0][0].$match.date).toEqual({ $gte: '2026-10-01', $lte: '2026-10-03' });
        });

        it('no rows in the window -> null', async () => {
            mockRows = fixture();
            const doc = await buildEconomicsFromDailyFinance({
                userId: USER, country: 'US', region: 'NA', startDate: '2026-09-01', endDate: '2026-09-30'
            });
            expect(doc).toBeNull();
        });

        it('aggregation failure -> null, not a throw', async () => {
            mockAggregateThrows = new Error('boom');
            const doc = await buildEconomicsFromDailyFinance({
                userId: USER, country: 'US', region: 'NA', startDate: '2026-10-01', endDate: '2026-10-03'
            });
            expect(doc).toBeNull();
        });

        it('missing account key -> null without querying', async () => {
            const doc = await buildEconomicsFromDailyFinance({ userId: null, country: 'US', region: 'NA' });
            expect(doc).toBeNull();
            expect(mockPipelines).toHaveLength(0);
        });
    });

    describe('loadLiveEconomics', () => {
        it('a FRESH EconomicsMetrics doc passes through untouched', async () => {
            const fresh = {
                _id: 'em1', createdAt: new Date(Date.now() - 2 * DAY),
                dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
                totalSales: { amount: 1234, currencyCode: 'USD' }, asinWiseSales: [{ asin: 'X' }]
            };
            mockHead = { _id: fresh._id, createdAt: fresh.createdAt, dateRange: fresh.dateRange };
            mockFullDoc = fresh;
            mockRows = fixture();

            const doc = await loadLiveEconomics(USER, 'NA', 'US');

            expect(doc).toBe(fresh);
            expect(mockPipelines).toHaveLength(0);
        });

        it('STALE doc + DailySkuFinance rows -> built live doc, stale doc never loaded', async () => {
            mockHead = { _id: 'em1', createdAt: new Date('2026-03-25'), dateRange: { startDate: '2026-02-23', endDate: '2026-03-24' } };
            mockFullDoc = { totalSales: { amount: 99999 } };
            mockRows = fixture();

            const doc = await loadLiveEconomics(USER, 'NA', 'US', { startDate: '2026-10-01', endDate: '2026-10-03' });

            expect(mockFindByIdCalls).toBe(0);
            expect(doc.source).toBe('daily_sku_finance');
            expect(doc.totalSales.amount).toBe(290);
        });

        it('fresh doc that does not cover an explicit window -> live for that window', async () => {
            mockHead = { _id: 'em1', createdAt: new Date(), dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' } };
            mockFullDoc = { totalSales: { amount: 99999 } };
            mockRows = fixture();

            const doc = await loadLiveEconomics(USER, 'NA', 'US', { startDate: '2026-10-01', endDate: '2026-10-03' });

            expect(doc.source).toBe('daily_sku_finance');
            expect(doc.totalSales.amount).toBe(290);
        });

        it('defaults to the 30 days ending yesterday', async () => {
            mockRows = [];
            await loadLiveEconomics(USER, 'NA', 'US');
            const y = new Date(Date.now() - DAY).toISOString().slice(0, 10);
            const s = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
            expect(mockPipelines[0][0].$match.date).toEqual({ $gte: s, $lte: y });
        });

        it('neither a fresh doc nor rows -> null', async () => {
            mockHead = { _id: 'em1', createdAt: new Date('2026-03-25') };
            mockRows = [];
            expect(await loadLiveEconomics(USER, 'NA', 'US')).toBeNull();
        });

        it('no doc at all and no rows -> null', async () => {
            expect(await loadLiveEconomics(USER, 'NA', 'US')).toBeNull();
        });
    });

    describe('comparison windows', () => {
        it('previousWindow is the equal-length window just before', () => {
            expect(previousWindow('2026-10-01', '2026-10-03')).toEqual({ startStr: '2026-09-28', endStr: '2026-09-30' });
            expect(previousWindow('2026-03-01', '2026-03-31')).toEqual({ startStr: '2026-01-29', endStr: '2026-02-28' });
        });

        it('loadEconomicsComparison builds both sides live', async () => {
            mockRows = [
                ...fixture(),
                row('2026-09-29', 'A1', { sales: 30, units: 1, fba: -3, referral: -4 }),
            ];
            const r = await loadEconomicsComparison(USER, 'NA', 'US', { startDate: '2026-10-01', endDate: '2026-10-03' });
            expect(r.current.totalSales.amount).toBe(290);
            expect(r.previous.totalSales.amount).toBe(30);
            expect(r.previousWindow).toEqual({ startDate: '2026-09-28', endDate: '2026-09-30' });
        });

        it('previous window with no rows -> previous null', async () => {
            mockRows = fixture();
            const r = await loadEconomicsComparison(USER, 'NA', 'US', { startDate: '2026-10-01', endDate: '2026-10-03' });
            expect(r.current).not.toBeNull();
            expect(r.previous).toBeNull();
        });
    });
});

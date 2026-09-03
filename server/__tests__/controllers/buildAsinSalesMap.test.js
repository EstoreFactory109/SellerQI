/**
 * Tests for buildAsinSalesMap — per-ASIN sales for the Your Products v3 tabs
 * (Sellable Products, Without A+, Not Targeted in Ads).
 *
 * Background: these tabs sourced sales from EconomicsMetrics alone. That
 * collection stopped being written in April 2026, so the map came back empty and
 * every row rendered "—". The first fix fell back to BuyBoxData, which made the
 * column populate but introduced a subtler problem: a BuyBox snapshot covers a
 * SINGLE DAY, so a one-day figure was being shown in a column that implies 30.
 *
 * The source of truth is now DailySkuFinance — live, and summed over the same
 * window the rest of the page reports on. The properties that matter:
 *
 *   1. Live finance wins, so these tabs agree with the Profitability page.
 *   2. A one-day BuyBox figure is TAGGED (`windowDays: 1`) rather than passed off
 *      as monthly, so the UI can label it.
 *   3. An ASIN in no source stays absent, so callers render "—" rather than a
 *      fabricated $0.00 that a seller would read as "this sold nothing".
 *   4. Any one source failing degrades to the others instead of 500-ing the page.
 */

const mockGetAsinFinance = jest.fn();
jest.mock('../../Services/Finance/AsinFinanceWindowService.js', () => ({
    getAsinFinanceForWindow: (...a) => mockGetAsinFinance(...a),
    DEFAULT_WINDOW_DAYS: 30,
}));

const mockGetAsinPpcSales = jest.fn();
jest.mock('../../Services/Calculations/ProfitabilityService.js', () => ({
    getAsinPpcSalesFromEconomics: (...a) => mockGetAsinPpcSales(...a),
    fetchProfitabilityData: jest.fn(),
}));

let mockBuyBoxDoc = null;
let mockBuyBoxThrows = null;
jest.mock('../../models/MCP/BuyBoxDataModel.js', () => ({
    findOne: () => ({
        sort: () => ({
            select: () => ({
                lean: async () => {
                    if (mockBuyBoxThrows) throw mockBuyBoxThrows;
                    return mockBuyBoxDoc;
                }
            })
        })
    })
}));

const { buildAsinSalesMap } = require('../../controllers/analytics/PageWiseDataController.js');

const buyBox = (rows) => ({ asinBuyBoxData: rows });

describe('buildAsinSalesMap', () => {
    beforeEach(() => {
        mockGetAsinFinance.mockReset().mockResolvedValue({});
        mockGetAsinPpcSales.mockReset().mockResolvedValue({ asinPpcSales: {} });
        mockBuyBoxDoc = null;
        mockBuyBoxThrows = null;
    });

    describe('source precedence', () => {
        it('prefers live finance over both other sources', async () => {
            mockGetAsinFinance.mockResolvedValue({ B001: { sales: 1093.06 } });
            mockGetAsinPpcSales.mockResolvedValue({ asinPpcSales: { B001: { sales: 500 } } });
            mockBuyBoxDoc = buyBox([{ childAsin: 'B001', sales: { amount: 24.99 } }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', {});

            // 24.99 was the one-day BuyBox figure this ASIN used to show for a
            // product that actually sold $1,093 over the window.
            expect(map.get('B001')).toEqual({ amount: 1093.06, source: 'dailySkuFinance', windowDays: 30 });
        });

        it('falls back to economics for an ASIN finance does not cover', async () => {
            mockGetAsinFinance.mockResolvedValue({ B001: { sales: 100 } });
            mockGetAsinPpcSales.mockResolvedValue({ asinPpcSales: { B002: { sales: 500 } } });

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', {});

            expect(map.get('B001').source).toBe('dailySkuFinance');
            expect(map.get('B002')).toEqual({ amount: 500, source: 'economicsMetrics', windowDays: 30 });
        });

        it('uses BuyBox only as a last resort, and tags it as a single day', async () => {
            mockBuyBoxDoc = buyBox([{ childAsin: 'B003', sales: { amount: 24.99 } }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            // The tag is the whole point: without it the UI shows a 1-day number
            // in a column that reads as 30-day.
            expect(map.get('B003')).toEqual({ amount: 24.99, source: 'buyBox', windowDays: 1 });
        });

        it('uses parentAsin when a BuyBox row has no childAsin', async () => {
            mockBuyBoxDoc = buyBox([{ parentAsin: 'B009', sales: { amount: 5 } }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map.get('B009').amount).toBe(5);
        });

        it('normalises ASIN casing and whitespace across all three sources', async () => {
            mockGetAsinFinance.mockResolvedValue({ ' b00fin ': { sales: 10 } });
            mockGetAsinPpcSales.mockResolvedValue({ asinPpcSales: { b00eco: { sales: 20 } } });
            mockBuyBoxDoc = buyBox([{ childAsin: ' b00bb ', sales: { amount: 30 } }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', {});

            // Callers look up by product.asin.toUpperCase().
            expect(map.get('B00FIN').amount).toBe(10);
            expect(map.get('B00ECO').amount).toBe(20);
            expect(map.get('B00BB').amount).toBe(30);
        });
    });

    describe('unknown vs zero', () => {
        it('omits an ASIN no source knows, so the UI can render "—"', async () => {
            mockBuyBoxDoc = buyBox([{ childAsin: 'B001', sales: { amount: 1 } }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map.has('B_UNKNOWN')).toBe(false);
        });

        it('keeps a genuine zero as 0, not as missing', async () => {
            mockGetAsinFinance.mockResolvedValue({ B001: { sales: 0 } });

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map.has('B001')).toBe(true);
            expect(map.get('B001').amount).toBe(0);
        });

        it('treats a BuyBox row with no sales object as 0', async () => {
            mockBuyBoxDoc = buyBox([{ childAsin: 'B001' }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map.get('B001').amount).toBe(0);
        });
    });

    describe('resilience', () => {
        it('degrades to the other sources when live finance throws', async () => {
            mockGetAsinFinance.mockRejectedValue(new Error('aggregation failed'));
            mockGetAsinPpcSales.mockResolvedValue({ asinPpcSales: { B001: { sales: 42 } } });

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', {});

            expect(map.get('B001').amount).toBe(42);
        });

        it('degrades to the other sources when the BuyBox read throws', async () => {
            mockGetAsinFinance.mockResolvedValue({ B001: { sales: 42 } });
            mockBuyBoxThrows = new Error('connection reset');

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', {});

            // Sales is one column — it must never take the whole product list down.
            expect(map.get('B001').amount).toBe(42);
        });

        it('returns an empty map, not a rejection, when every source is unavailable', async () => {
            mockGetAsinFinance.mockRejectedValue(new Error('down'));
            mockGetAsinPpcSales.mockResolvedValue({ asinPpcSales: null });
            mockBuyBoxThrows = new Error('connection reset');

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map).toBeInstanceOf(Map);
            expect(map.size).toBe(0);
        });

        it('handles a BuyBox document with no asinBuyBoxData array', async () => {
            mockBuyBoxDoc = {};

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map.size).toBe(0);
        });
    });
});

/**
 * Tests for buildAsinSalesMap — per-ASIN sales for the Your Products v3 tabs
 * (Sellable Products, Without A+, Not Targeted in Ads).
 *
 * Background: these tabs sourced sales from EconomicsMetrics alone. That collection
 * stopped being written, so the map came back empty and every row rendered "—" while
 * the Optimization tab showed real figures — it goes through ProductPerformanceService,
 * which already falls back to BuyBoxData. The fix mirrors that precedence.
 *
 * Three properties matter, and each has a distinct failure mode:
 *   1. Economics wins per ASIN, so the tabs can't disagree with Optimization/Profitability.
 *   2. An ASIN absent from BOTH sources stays absent, so callers render "—" instead of
 *      a fabricated $0.00 that a seller would read as "this product sold nothing".
 *   3. A BuyBox read failure degrades to economics-only rather than 500-ing the page.
 */

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
        mockGetAsinPpcSales.mockReset().mockResolvedValue({ asinPpcSales: {} });
        mockBuyBoxDoc = null;
        mockBuyBoxThrows = null;
    });

    describe('source precedence', () => {
        it('prefers the economics figure when that ASIN has one', async () => {
            mockGetAsinPpcSales.mockResolvedValue({ asinPpcSales: { B001: { sales: 500 } } });
            mockBuyBoxDoc = buyBox([{ childAsin: 'B001', sales: { amount: 12.34 } }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', {});

            // BuyBox is a narrower window; letting it override economics would make this
            // tab disagree with the Profitability table on the same ASIN.
            expect(map.get('B001')).toBe(500);
        });

        it('falls back to BuyBox for an ASIN economics does not cover', async () => {
            mockGetAsinPpcSales.mockResolvedValue({ asinPpcSales: { B001: { sales: 500 } } });
            mockBuyBoxDoc = buyBox([
                { childAsin: 'B001', sales: { amount: 12.34 } },
                { childAsin: 'B002', sales: { amount: 69.98 } }
            ]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', {});

            expect(map.get('B001')).toBe(500);
            expect(map.get('B002')).toBe(69.98);
        });

        // The reported bug: no economics document at all.
        it('populates entirely from BuyBox when economics is empty', async () => {
            mockGetAsinPpcSales.mockResolvedValue({ asinPpcSales: {} });
            mockBuyBoxDoc = buyBox([
                { childAsin: 'B001', sales: { amount: 34.99 } },
                { childAsin: 'B002', sales: { amount: 24.99 } }
            ]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map.size).toBe(2);
            expect(map.get('B001')).toBe(34.99);
        });

        it('uses parentAsin when a BuyBox row has no childAsin', async () => {
            mockBuyBoxDoc = buyBox([{ parentAsin: 'B009', sales: { amount: 5 } }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map.get('B009')).toBe(5);
        });

        it('normalises ASIN casing on both sources', async () => {
            mockGetAsinPpcSales.mockResolvedValue({ asinPpcSales: { b00lower: { sales: 10 } } });
            mockBuyBoxDoc = buyBox([{ childAsin: ' b00buybox ', sales: { amount: 20 } }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', {});

            // Callers look up by product.asin.toUpperCase().
            expect(map.get('B00LOWER')).toBe(10);
            expect(map.get('B00BUYBOX')).toBe(20);
        });
    });

    describe('unknown vs zero', () => {
        it('omits an ASIN neither source knows, so the UI can render "—"', async () => {
            mockBuyBoxDoc = buyBox([{ childAsin: 'B001', sales: { amount: 1 } }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map.has('B_UNKNOWN')).toBe(false);
        });

        // A BuyBox row that exists but reports nothing is measured information, not
        // absence — and it is what the Optimization tab already shows for that ASIN.
        it('keeps a genuine zero from BuyBox as 0, not as missing', async () => {
            mockBuyBoxDoc = buyBox([{ childAsin: 'B001', sales: { amount: 0 } }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map.has('B001')).toBe(true);
            expect(map.get('B001')).toBe(0);
        });

        it('treats a BuyBox row with no sales object as 0', async () => {
            mockBuyBoxDoc = buyBox([{ childAsin: 'B001' }]);

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map.get('B001')).toBe(0);
        });
    });

    describe('resilience', () => {
        it('returns the economics-only map when the BuyBox read throws', async () => {
            mockGetAsinPpcSales.mockResolvedValue({ asinPpcSales: { B001: { sales: 42 } } });
            mockBuyBoxThrows = new Error('connection reset');

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', {});

            // Sales is one column — it must never take the whole product list down.
            expect(map.get('B001')).toBe(42);
        });

        it('returns an empty map, not a rejection, when both sources are unavailable', async () => {
            mockGetAsinPpcSales.mockResolvedValue({ asinPpcSales: null });
            mockBuyBoxThrows = new Error('connection reset');

            await expect(buildAsinSalesMap('u1', 'FE', 'AU', null)).resolves.toBeInstanceOf(Map);
        });

        it('handles a BuyBox document with no asinBuyBoxData array', async () => {
            mockBuyBoxDoc = {};

            const map = await buildAsinSalesMap('u1', 'FE', 'AU', null);

            expect(map.size).toBe(0);
        });
    });
});

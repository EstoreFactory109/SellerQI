/**
 * Tests for AsinFinanceWindowService — per-ASIN sales/units/fees from the live
 * DailySkuFinance collection.
 *
 * This service exists because the two previous per-ASIN sources went dead
 * (EconomicsMetrics April 2026, ProductWiseSales December 2025). With no rows to
 * read, profitability computed against `sales: 0` and reported PROFITABLE
 * products as "losing money on every sale — Revenue: $0.00". On one real account
 * that was 7 of 9 flagged products.
 *
 * The properties worth locking down are the ones that would silently corrupt
 * money if they broke:
 *
 *   1. SIGN. DailySkuFinance stores fees NEGATIVE (`totalExpenses: -11.75`), but
 *      callers do `grossProfit = sales - adsSpend - totalFees`. Returning the raw
 *      negative would ADD the fees back and inflate profit.
 *   2. DATE TYPE. `date` is a 'YYYY-MM-DD' STRING; matching it against a BSON
 *      Date silently returns nothing, which is exactly how the old sources
 *      failed quietly.
 *   3. Failure returns {} rather than throwing, so the dashboard degrades.
 */

let mockRows = [];
let mockThrows = null;
let capturedPipeline = null;

jest.mock('../../../models/finance/DailySkuFinanceModel.js', () => ({
    aggregate: (pipeline) => {
        capturedPipeline = pipeline;
        if (mockThrows) return Promise.reject(mockThrows);
        return Promise.resolve(mockRows);
    }
}));

const {
    getAsinFinanceForWindow,
    resolveWindow,
    toYyyyMmDd,
} = require('../../../Services/Finance/AsinFinanceWindowService.js');

const USER = '6a40e42712ce56d674f734a0';

describe('AsinFinanceWindowService', () => {
    beforeEach(() => {
        mockRows = [];
        mockThrows = null;
        capturedPipeline = null;
    });

    describe('sign convention', () => {
        it('returns fees as a POSITIVE magnitude even though storage holds them negative', async () => {
            // Shape taken from a real row: sales +29.99, totalExpenses -11.75.
            mockRows = [{ _id: 'B001', sales: 29.99, unitsSold: 1, expenses: -11.75, fbaFees: -7.46, referralFees: -4.29 }];

            const map = await getAsinFinanceForWindow(USER, 'AU', 'FE', '2026-08-03', '2026-09-01');

            expect(map.B001.sales).toBe(29.99);
            expect(map.B001.totalFees).toBe(11.75);
            expect(map.B001.fbaFees).toBe(7.46);
            expect(map.B001.referralFees).toBe(4.29);
        });

        it('produces a profit, not an inflated one, when the caller subtracts totalFees', async () => {
            mockRows = [{ _id: 'B001', sales: 1093.06, unitsSold: 47, expenses: -599.32, fbaFees: -350.61, referralFees: -119.07 }];

            const map = await getAsinFinanceForWindow(USER, 'AU', 'FE');
            const adsSpend = 104.2;
            const grossProfit = map.B001.sales - adsSpend - map.B001.totalFees;

            // The real numbers for the ASIN that used to render "Revenue: $0.00":
            // profitable at ~35% margin, not the -$104 loss we were reporting.
            expect(grossProfit).toBeCloseTo(389.54, 2);
        });
    });

    describe('window handling', () => {
        it('matches `date` as a STRING range, not a BSON Date', async () => {
            await getAsinFinanceForWindow(USER, 'AU', 'FE', '2026-08-03', '2026-09-01');

            const match = capturedPipeline[0].$match;
            expect(typeof match.date.$gte).toBe('string');
            expect(match.date).toEqual({ $gte: '2026-08-03', $lte: '2026-09-01' });
        });

        it('accepts Date objects and normalises them', () => {
            expect(toYyyyMmDd(new Date('2026-08-03T12:34:56Z'))).toBe('2026-08-03');
        });

        it('swaps a reversed window rather than querying an empty range', () => {
            expect(resolveWindow('2026-09-01', '2026-08-03')).toEqual({ startStr: '2026-08-03', endStr: '2026-09-01' });
        });

        it('falls back to a 30-day window when dates are missing', () => {
            const w = resolveWindow(null, null);
            expect(w.startStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(w.startStr < w.endStr).toBe(true);
        });

        it('scopes the query to the account and marketplace', async () => {
            await getAsinFinanceForWindow(USER, 'AU', 'FE');

            const match = capturedPipeline[0].$match;
            expect(match.country).toBe('AU');
            expect(match.region).toBe('FE');
            expect(String(match.User)).toBe(USER);
        });

        it('excludes rows with no ASIN, which cannot be attributed to a product', async () => {
            expect(capturedPipeline).toBeNull();
            await getAsinFinanceForWindow(USER, 'AU', 'FE');
            expect(capturedPipeline[0].$match.asin).toEqual({ $nin: [null, ''] });
        });
    });

    describe('degradation', () => {
        it('returns {} instead of throwing when the aggregation fails', async () => {
            mockThrows = new Error('server selection timed out');

            await expect(getAsinFinanceForWindow(USER, 'AU', 'FE')).resolves.toEqual({});
        });

        it('returns {} for a missing country or region rather than querying everything', async () => {
            expect(await getAsinFinanceForWindow(USER, '', 'FE')).toEqual({});
            expect(await getAsinFinanceForWindow(USER, 'AU', '')).toEqual({});
            expect(capturedPipeline).toBeNull();
        });

        it('returns {} for an unusable userId', async () => {
            expect(await getAsinFinanceForWindow('not-an-objectid', 'AU', 'FE')).toEqual({});
        });

        it('returns an empty map for an account with no rows in the window', async () => {
            mockRows = [];

            expect(await getAsinFinanceForWindow(USER, 'AU', 'FE')).toEqual({});
        });

        it('skips a grouped row with a null asin', async () => {
            mockRows = [{ _id: null, sales: 5, unitsSold: 1, expenses: -1 }];

            expect(await getAsinFinanceForWindow(USER, 'AU', 'FE')).toEqual({});
        });
    });

    describe('shape compatibility', () => {
        it('emits the field names ProfitabilityCalculation\'s economicsAsinData branch reads', async () => {
            mockRows = [{ _id: 'B001', sales: 10, unitsSold: 2, expenses: -3, fbaFees: -2, referralFees: -1 }];

            const map = await getAsinFinanceForWindow(USER, 'AU', 'FE');

            // Consumed at ProfitabilityCalculation.js:49-77.
            expect(map.B001).toEqual(expect.objectContaining({
                sales: expect.any(Number),
                unitsSold: expect.any(Number),
                totalFees: expect.any(Number),
                amazonFees: expect.any(Number),
                fbaFees: expect.any(Number),
                storageFees: expect.any(Number),
            }));
        });

        it('rounds money to 2dp and units to whole numbers', async () => {
            mockRows = [{ _id: 'B001', sales: 10.005999, unitsSold: 2.4, expenses: -3.014999 }];

            const map = await getAsinFinanceForWindow(USER, 'AU', 'FE');

            expect(map.B001.sales).toBe(10.01);
            expect(map.B001.totalFees).toBe(3.01);
            expect(map.B001.unitsSold).toBe(2);
        });
    });
});

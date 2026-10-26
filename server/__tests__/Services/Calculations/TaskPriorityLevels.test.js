/**
 * tasks-logics.xlsx P1-P4 per task type, and the "Amazon Ready" rule built on it.
 */
const { priorityLevelFor, blocksAmazonReady } = require('../../../Services/Calculations/TaskPriorityLevels.js');
const { getTaskPriorityMeta } = require('../../../Services/Calculations/TaskPrioritizationService.js');

const lvl = (errorCategory, errorType, renderData) => priorityLevelFor({ errorCategory, errorType, renderData });

describe('priorityLevelFor', () => {
    it('follows the spreadsheet', () => {
        expect(lvl('account', 'PolicyViolations')).toBe('P1');
        expect(lvl('inventory', 'inbound_shortage')).toBe('P1');
        expect(lvl('conversion', 'no_buybox')).toBe('P2');
        expect(lvl('inventory', 'unfulfillable_inventory')).toBe('P3');
        expect(lvl('conversion', 'insufficient_images')).toBe('P4');
    });

    it('makes a suppressed top seller P1', () => {
        expect(lvl('inventory', 'listing_suppressed', { topSeller: false })).toBe('P2');
        expect(lvl('inventory', 'listing_suppressed', { topSeller: true })).toBe('P1');
    });

    it('reads prefixed and field-named types', () => {
        expect(lvl('inventory', 'replenishment_needed_SKU-1')).toBe('P2');
        expect(lvl('ranking', 'bulletpoints_restricted_words')).toBe('P2');
        expect(lvl('ranking', 'titleresult_char_limit')).toBe('P3');
        expect(lvl('ranking', 'description_char_limit')).toBe('P4');
        expect(lvl('ranking', 'titleresult_too_short')).toBe('P4');
    });

    it('puts a status that keeps slipping one level below, and defaults to P3', () => {
        expect(lvl('account', 'accountStatus_unstable')).toBe('P2');
        expect(lvl('conversion', 'something_new')).toBe('P3');
    });

    it('is on every task the client reads', () => {
        expect(getTaskPriorityMeta({ errorCategory: 'account', errorType: 'a_z_claims' }).priorityLevel).toBe('P1');
    });

    it('only P1-P3 block Amazon Ready', () => {
        expect(['P1', 'P2', 'P3', 'P4'].map(blocksAmazonReady)).toEqual([true, true, true, false]);
    });
});

describe('Amazon Ready = no open P1-P3 task (analyseData)', () => {
    const { analyseData } = require('../../../Services/Calculations/DashboardCalculation.js');
    const { classifyBuyBoxLoss } = require('../../../Services/Calculations/RecoverableAmountUtils.js');
    const day = (date, rows) => ({
        date, dateRange: { startDate: date, endDate: date }, createdAt: new Date(`${date}T06:00:00Z`),
        asinBuyBoxData: Object.entries(rows).map(([childAsin, [buyBoxPercentage, sessions]]) => ({
            childAsin, parentAsin: childAsin, buyBoxPercentage, sessions, sales: { amount: 0 }
        }))
    });

    it('drops a product with a P2 task, keeps one with none, never adds an unscraped one', async () => {
        const products = ['A', 'B', 'C'].map((asin) => ({ asin, status: 'Active', quantity: 5 }));
        const { dashboardData } = await analyseData({
            Country: 'US',
            TotalProducts: products,
            // A loses the Buy Box (no_buybox, P2); B holds it. C was never scraped.
            BuyBoxData: classifyBuyBoxLoss([
                day('2026-10-13', { A: [0, 30], B: [100, 30] }),
                day('2026-10-12', { A: [0, 30], B: [100, 30] })
            ]),
            ConversionData: { AmazonReadyCandidates: ['A', 'B'], AmazonReadyproducts: [] }
        }, null, { persistTasks: false });
        expect(dashboardData.amazonReadyProducts).toEqual(['B']);
    });
});

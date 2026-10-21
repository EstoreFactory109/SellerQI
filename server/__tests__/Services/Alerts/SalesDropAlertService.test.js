/**
 * SalesDropAlertService reads datewise sales through the live economics loader.
 *
 * The rule that matters: missing data is never a drop. EconomicsMetrics stopped
 * in March 2026; a reader that turned "no rows" into $0 would email every seller
 * a "100% sales drop".
 */

let mockEconomics = null;
let mockLoadArgs = null;
jest.mock('../../../Services/Finance/LiveEconomicsService.js', () => ({
    loadLiveEconomics: async (...args) => {
        mockLoadArgs = args;
        return mockEconomics;
    }
}));

const {
    detectSalesDrop,
    getDatewiseSalesForRange,
    detectSalesDrops,
} = require('../../../Services/Alerts/Other-Alerts/SalesDropAlertService.js');

const day = (date, amount) => ({ date, sales: { amount, currencyCode: 'USD' }, grossProfit: { amount: 0, currencyCode: 'USD' } });
const RANGE = { startDate: '2026-10-01', endDate: '2026-10-08' };

describe('SalesDropAlertService', () => {
    beforeEach(() => {
        mockEconomics = null;
        mockLoadArgs = null;
    });

    it('no economics at all -> no alert', async () => {
        const r = await detectSalesDrop('u1', 'NA', 'US', RANGE);

        expect(r.detected).toBe(false);
        expect(r.drops).toEqual([]);
        expect(r.error).toMatch(/No sales data/);
    });

    it('loads the alert window through the live loader', async () => {
        await detectSalesDrop('u1', 'NA', 'US', RANGE);

        expect(mockLoadArgs).toEqual(['u1', 'NA', 'US', RANGE]);
    });

    it('flags a real day-over-day revenue drop from live data', async () => {
        mockEconomics = {
            source: 'daily_sku_finance',
            datewiseSales: [day('2026-10-01', 100), day('2026-10-02', 50), day('2026-10-03', 48)],
        };

        const r = await detectSalesDrop('u1', 'NA', 'US', RANGE);

        expect(r.detected).toBe(true);
        expect(r.drops).toHaveLength(1);
        expect(r.drops[0]).toEqual(expect.objectContaining({
            date: '2026-10-02', previousDate: '2026-10-01',
            revenueDropPct: 50, previousRevenue: 100, currentRevenue: 50, currencyCode: 'USD',
        }));
    });

    it('a day with no rows is absent, not a 100% drop', async () => {
        // 10-02 and 10-03 have no finance rows yet; 10-04 is back to normal.
        mockEconomics = { datewiseSales: [day('2026-10-01', 100), day('2026-10-04', 95)] };

        const r = await detectSalesDrop('u1', 'NA', 'US', RANGE);

        expect(r.detected).toBe(false);
        expect(r.drops).toEqual([]);
    });

    it('does not compare across a gap even when the later day is lower', () => {
        const drops = detectSalesDrops([day('2026-10-01', 100), day('2026-10-03', 10)]);
        expect(drops).toEqual([]);
    });

    it('a row without a sales figure is dropped, not read as $0', () => {
        const rows = getDatewiseSalesForRange({
            datewiseSales: [day('2026-10-01', 100), { date: '2026-10-02' }, day('2026-10-03', 90)],
        }, '2026-10-01', '2026-10-08');

        expect(rows.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-03']);
        expect(rows[0]).toEqual({ date: '2026-10-01', sales: { amount: 100, currencyCode: 'USD' }, unitsOrdered: 0 });
    });

    it('fewer than two days of data -> no alert', async () => {
        mockEconomics = { datewiseSales: [day('2026-10-08', 100)] };

        const r = await detectSalesDrop('u1', 'NA', 'US', RANGE);

        expect(r.detected).toBe(false);
        expect(r.datewiseSales).toHaveLength(1);
    });
});

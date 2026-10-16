/**
 * Dashboard TACoS. It was hard-coded to 0 on the main dashboard; it is now PPC spend ÷ total sales,
 * with the total sales aggregated over EXACTLY the days the PPC rollup covers.
 */

const PPCCampaignAnalysisService = require('../../../Services/Calculations/PPCCampaignAnalysisService.js');
const { resolveDashboardTacos } = require('../../../Services/Calculations/DashboardSummaryService.js');

const rollup = (totalSpend) => ({
    found: true,
    dateRange: { startDate: '2026-09-16', endDate: '2026-10-15' },
    summary: { totalSpend },
});

describe('resolveDashboardTacos', () => {
    let spy;
    beforeEach(() => {
        spy = jest.spyOn(PPCCampaignAnalysisService, 'aggregateTotalSales');
    });

    test('spend ÷ total sales × 100, over the rollup window', async () => {
        spy.mockResolvedValue({ totalSales: 4000 });
        const tacos = await resolveDashboardTacos('507f1f77bcf86cd799439011', 'US', 'NA', rollup(500));
        expect(tacos).toBe(12.5);
        expect(spy).toHaveBeenCalledWith('507f1f77bcf86cd799439011', 'US', 'NA', '2026-09-16', '2026-10-15');
    });

    test('no total sales -> 0, not Infinity', async () => {
        spy.mockResolvedValue({ totalSales: 0 });
        expect(await resolveDashboardTacos('u', 'US', 'NA', rollup(500))).toBe(0);
    });

    test('no PPC data -> 0 without querying sales', async () => {
        expect(await resolveDashboardTacos('u', 'US', 'NA', { found: false })).toBe(0);
        expect(await resolveDashboardTacos('u', 'US', 'NA', null)).toBe(0);
        expect(spy).not.toHaveBeenCalled();
    });

    test('a failing sales query never breaks the dashboard', async () => {
        spy.mockRejectedValue(new Error('mongo down'));
        expect(await resolveDashboardTacos('u', 'US', 'NA', rollup(500))).toBe(0);
    });
});

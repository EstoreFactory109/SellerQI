/**
 * QMate's Buy Box context must quote the same numbers as the dashboard: the
 * 7-day effective doc (classifyBuyBoxLoss) counted over ACTIVE ASINs
 * (summarizeBuyBoxCounts). It used to read the newest single day's raw stored
 * counts (all ASINs, one day) and listed never-measured (null) products as
 * "without Buy Box" because null < 50 is true.
 */

let mockDays = [];
let mockRecentDaysArgs = null;
jest.mock('../../../models/MCP/BuyBoxDataModel.js', () => ({
    findRecentDays: async (...args) => {
        mockRecentDaysArgs = args;
        return mockDays;
    }
}));

let mockProducts = [];
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
    findOne: () => ({ lean: async () => ({ sellerAccount: [{ products: mockProducts }] }) })
}));

const { getBuyBoxData } = require('../../../Services/AI/QMateMetricsService.js');

const day = (date, rows) => ({
    date,
    dateRange: { startDate: date, endDate: date },
    createdAt: new Date(`${date}T06:00:00Z`),
    // Raw stored counts deliberately disagree with the rows: QMate must not read them.
    totalProducts: 99, productsWithBuyBox: 50, productsWithoutBuyBox: 49,
    asinBuyBoxData: Object.entries(rows).map(([childAsin, [buyBoxPercentage, sessions]]) => ({
        childAsin, parentAsin: childAsin, buyBoxPercentage, sessions, sales: { amount: 0 }
    }))
});

describe('QMateMetricsService.getBuyBoxData', () => {
    beforeEach(() => {
        // A: lost 2 traffic days (flagged). B: one-day blip (carried forward). N: no reading.
        // L: 30% today. X: lost but inactive.
        mockDays = [
            day('2026-10-13', { A: [0, 10], B: [0, 10], N: [null, 0], L: [30, 10], X: [0, 10] }),
            day('2026-10-12', { A: [0, 10], B: [100, 10], N: [null, 0], L: [30, 10], X: [0, 10] })
        ];
        mockProducts = ['A', 'B', 'N', 'L'].map((asin) => ({ asin, status: 'Active' }))
            .concat([{ asin: 'X', status: 'Inactive' }]);
        mockRecentDaysArgs = null;
    });

    it('loads 7 days and counts active ASINs from the effective doc', async () => {
        const r = await getBuyBoxData('6a40e42712ce56d674f734a0', 'US', 'NA');

        expect(mockRecentDaysArgs[3]).toBe(7);
        expect(r.success).toBe(true);
        expect(r.data.summary).toEqual(expect.objectContaining({
            totalProducts: 4,
            productsWithBuyBox: 2, // B (carried forward 100) and L
            productsWithoutBuyBox: 1, // A only — X is inactive
            productsWithLowBuyBox: 1,
            productsWithUnknownBuyBox: 1
        }));
    });

    it('lists lost and low ASINs, never unknown (null) or inactive ones', async () => {
        const r = await getBuyBoxData('6a40e42712ce56d674f734a0', 'US', 'NA');

        expect(r.data.productsWithoutBuyBox.map((p) => p.asin).sort()).toEqual(['A', 'L']);
    });

    it('no Buy Box days -> no data, not "every product lost"', async () => {
        mockDays = [];
        const r = await getBuyBoxData('6a40e42712ce56d674f734a0', 'US', 'NA');
        expect(r.success).toBe(false);
    });
});

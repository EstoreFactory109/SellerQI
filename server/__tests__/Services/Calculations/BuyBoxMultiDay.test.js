/**
 * Buy Box issues are judged from several days, not the newest doc.
 *
 * In the 14 days to 2026-10-15, 539 of 3,279 buyboxdatas docs were empty
 * (totalProducts 0) and wiped every Buy Box issue for their run, and 1,082 ASINs
 * had exactly one 0% day out of 3+ — each a week-long "No Buy Box" task. These
 * tests pin the multi-day rule (classifyBuyBoxLoss), the loader (findRecentDays)
 * and that the dashboard count equals the task list.
 */

const mongoose = require('mongoose');
const {
    classifyBuyBoxLoss,
    latestCapturePerBuyBoxDay,
    countActiveBuyBoxLosses
} = require('../../../Services/Calculations/RecoverableAmountUtils.js');
const BuyBoxData = require('../../../models/MCP/BuyBoxDataModel.js');
const { analyseData } = require('../../../Services/Calculations/DashboardCalculation.js');
const { summarizeBuyBoxDays } = require('../../../Services/Calculations/DashboardSummaryService.js');

/** One day's doc. `rows` = { ASIN: [pct, sessions, sales?] }. */
const day = (date, rows, extra = {}) => ({
    date,
    dateRange: { startDate: date, endDate: date },
    createdAt: new Date(`${date}T06:00:00Z`),
    totalProducts: Object.keys(rows).length,
    asinBuyBoxData: Object.entries(rows).map(([childAsin, [buyBoxPercentage, sessions, sales = 0]]) => ({
        childAsin,
        parentAsin: childAsin,
        buyBoxPercentage,
        sessions,
        pageViews: sessions,
        unitsOrdered: 0,
        sales: { amount: sales, currencyCode: 'USD' }
    })),
    ...extra
});

const row = (doc, asin) => doc.asinBuyBoxData.find((r) => r.childAsin === asin);

describe('classifyBuyBoxLoss', () => {
    it('returns null when no days are loaded (no data -> no Buy Box issues)', () => {
        expect(classifyBuyBoxLoss([])).toBeNull();
        expect(classifyBuyBoxLoss(null)).toBeNull();
        expect(classifyBuyBoxLoss(undefined)).toBeNull();
    });

    it('ignores a single 0% blip between days that held the Buy Box', () => {
        const eff = classifyBuyBoxLoss([
            day('2026-10-13', { A: [0, 10] }),
            day('2026-10-12', { A: [80, 12] }),
            day('2026-10-11', { A: [90, 9] })
        ]);
        const a = row(eff, 'A');
        expect(a.buyBoxLost).toBe(false);
        // Latest observed non-zero value, marked so the benchmark can skip it.
        expect(a.buyBoxPercentage).toBe(80);
        expect(a.buyBoxPercentageCarriedForward).toBe(true);
        expect(a.zeroDays).toBe(1);
        expect(eff.productsWithoutBuyBox).toBe(0);
        expect(eff.productsWithBuyBox).toBe(1);
    });

    it('flags an ASIN at 0% on its two most recent traffic days', () => {
        const eff = classifyBuyBoxLoss([
            day('2026-10-13', { A: [0, 10] }),
            day('2026-10-12', { A: [0, 8] }),
            day('2026-10-11', { A: [100, 9] })
        ]);
        const a = row(eff, 'A');
        expect(a.buyBoxLost).toBe(true);
        expect(a.buyBoxPercentage).toBe(0);
        expect(a.zeroDays).toBe(2);
        expect(a.trafficDays).toBe(3);
        expect(eff.productsWithoutBuyBox).toBe(1);
    });

    it('does not flag when it holds the Buy Box on the newest traffic day', () => {
        const eff = classifyBuyBoxLoss([
            day('2026-10-13', { A: [50, 10] }),
            day('2026-10-12', { A: [0, 8] }),
            day('2026-10-11', { A: [0, 9] })
        ]);
        expect(row(eff, 'A').buyBoxLost).toBe(false);
        expect(row(eff, 'A').buyBoxPercentage).toBe(50);
    });

    it('skips no-traffic days when looking for two in a row', () => {
        // 0% on the newest day, no sessions the day before, 0% again before that:
        // the two most recent TRAFFIC days are both 0%.
        const flagged = classifyBuyBoxLoss([
            day('2026-10-13', { A: [0, 4] }),
            day('2026-10-12', { A: [100, 0] }),
            day('2026-10-11', { A: [0, 6] })
        ]);
        expect(row(flagged, 'A').buyBoxLost).toBe(true);

        // A 0% on a zero-session day is no evidence either way.
        const notFlagged = classifyBuyBoxLoss([
            day('2026-10-13', { A: [0, 4] }),
            day('2026-10-12', { A: [0, 0] }),
            day('2026-10-11', { A: [70, 6] })
        ]);
        expect(row(notFlagged, 'A').buyBoxLost).toBe(false);
        expect(row(notFlagged, 'A').buyBoxPercentage).toBe(70);
    });

    it('does not flag an ASIN with only one day of traffic, even at 0%', () => {
        const eff = classifyBuyBoxLoss([
            day('2026-10-13', { A: [0, 5], B: [100, 5] }),
            day('2026-10-12', { A: [0, 0], B: [100, 5] })
        ]);
        const a = row(eff, 'A');
        expect(a.buyBoxLost).toBe(false);
        // Never seen with the Buy Box, never confirmed without it: unknown, kept
        // (its sessions still matter to the product pages) but not counted.
        expect(a.buyBoxPercentage).toBeNull();
        expect(a.sessions).toBe(5);
        expect(eff.productsWithoutBuyBox).toBe(0);
        expect(eff.productsWithBuyBox).toBe(1);
        expect(eff.totalProducts).toBe(2);
    });

    it('does not flag from a single day of data', () => {
        const eff = classifyBuyBoxLoss([day('2026-10-13', { A: [0, 50] })]);
        expect(row(eff, 'A').buyBoxLost).toBe(false);
        expect(eff.observedDays).toBe(1);
    });

    it('treats a missing percentage as no data, not 0%', () => {
        const eff = classifyBuyBoxLoss([
            day('2026-10-13', { A: [null, 10] }),
            day('2026-10-12', { A: [0, 10] }),
            day('2026-10-11', { A: [100, 10] })
        ]);
        expect(row(eff, 'A').buyBoxLost).toBe(false);
        expect(row(eff, 'A').buyBoxPercentage).toBe(100);
    });

    it('keeps a flagged ASIN that is absent from the newest day', () => {
        const eff = classifyBuyBoxLoss([
            day('2026-10-13', { B: [100, 5] }),
            day('2026-10-12', { A: [0, 3], B: [100, 5] }),
            day('2026-10-11', { A: [0, 4], B: [100, 5] })
        ]);
        expect(row(eff, 'A')).toMatchObject({ buyBoxPercentage: 0, buyBoxLost: true });
        expect(eff.totalProducts).toBe(2);
        expect(eff.productsWithoutBuyBox).toBe(1);
    });

    it('recomputes the summary counts from the effective rows', () => {
        // Stored counts on the newest doc say 3 without Buy Box; only C is a real loss.
        const newest = day('2026-10-13', { A: [0, 5], B: [0, 0], C: [0, 9], D: [30, 9], E: [100, 9] },
            { productsWithBuyBox: 2, productsWithoutBuyBox: 3, productsWithLowBuyBox: 1 });
        const eff = classifyBuyBoxLoss([
            newest,
            day('2026-10-12', { A: [60, 5], B: [0, 0], C: [0, 9], D: [30, 9], E: [100, 9] })
        ]);
        expect(eff.totalProducts).toBe(5);
        expect(eff.productsWithoutBuyBox).toBe(1); // C
        expect(eff.productsWithBuyBox).toBe(3); // A (carried 60), D, E
        expect(eff.productsWithLowBuyBox).toBe(1); // D
        expect(row(eff, 'B').buyBoxPercentage).toBeNull();
        expect(eff.observedDays).toBe(2);
        expect(eff.observedDates).toEqual(['2026-10-13', '2026-10-12']);
        expect(eff.date).toBe('2026-10-13');
        // The input doc is not mutated.
        expect(newest.productsWithoutBuyBox).toBe(3);
        expect(row(newest, 'A').buyBoxPercentage).toBe(0);
    });

    it('averages sessions and sales across all observed days (absent day = 0)', () => {
        const eff = classifyBuyBoxLoss([
            day('2026-10-13', { A: [0, 10, 4], B: [100, 1] }),
            day('2026-10-12', { A: [0, 20, 2], B: [100, 1] }),
            day('2026-10-11', { B: [100, 1] }),
            day('2026-10-10', { A: [100, 10, 6], B: [100, 1] })
        ]);
        const a = row(eff, 'A');
        expect(a.avgDailySessions).toBe(10); // (10 + 20 + 0 + 10) / 4
        expect(a.avgDailySales).toBe(3); // (4 + 2 + 0 + 6) / 4
        expect(a.sessions).toBe(10); // newest day's own value is kept for display
    });
});

describe('latestCapturePerBuyBoxDay', () => {
    it('keeps the first (latest) capture of each day and stops at the limit', () => {
        const docs = [
            { _id: 1, date: '2026-10-13' },
            { _id: 2, date: '2026-10-13' },
            { _id: 3, dateRange: { endDate: '2026-10-12' } },
            { _id: 4, date: '2026-10-12' },
            { _id: 5, date: '2026-10-11' }
        ];
        expect(latestCapturePerBuyBoxDay(docs).map((d) => d._id)).toEqual([1, 3, 5]);
        expect(latestCapturePerBuyBoxDay(docs, 2).map((d) => d._id)).toEqual([1, 3]);
    });

    it('treats an undated doc as its own day', () => {
        expect(latestCapturePerBuyBoxDay([{ _id: 1 }, { _id: 2 }])).toHaveLength(2);
        expect(latestCapturePerBuyBoxDay(null)).toEqual([]);
    });
});

describe('BuyBoxData.findRecentDays', () => {
    let chain;
    beforeEach(() => {
        chain = {
            sort: jest.fn(() => chain),
            limit: jest.fn(() => chain),
            select: jest.fn(() => chain),
            lean: jest.fn(() => Promise.resolve([
                { _id: 'a', date: '2026-10-13', totalProducts: 4 },
                { _id: 'b', date: '2026-10-13', totalProducts: 4 },
                { _id: 'c', date: '2026-10-12', totalProducts: 4 },
                { _id: 'd', dateRange: { endDate: '2026-10-11' }, totalProducts: 4 }
            ]))
        };
        jest.spyOn(BuyBoxData, 'find').mockReturnValue(chain);
    });

    it('queries non-empty docs newest data day first and dedupes by day', async () => {
        const userId = new mongoose.Types.ObjectId();
        const days = await BuyBoxData.findRecentDays(userId, 'NA', 'US', 7);

        expect(BuyBoxData.find).toHaveBeenCalledWith({
            User: userId, region: 'NA', country: 'US', totalProducts: { $gt: 0 }
        });
        expect(chain.sort).toHaveBeenCalledWith({ date: -1, createdAt: -1 });
        expect(chain.limit).toHaveBeenCalledWith(21);
        expect(chain.select).not.toHaveBeenCalled();
        expect(chain.lean).toHaveBeenCalled();
        expect(days.map((d) => d._id)).toEqual(['a', 'c', 'd']);
    });

    it('returns at most n days and applies an optional projection', async () => {
        const days = await BuyBoxData.findRecentDays('u', 'NA', 'US', 2, 'date asinBuyBoxData.childAsin');
        expect(chain.limit).toHaveBeenCalledWith(6);
        expect(chain.select).toHaveBeenCalledWith('date asinBuyBoxData.childAsin');
        expect(days.map((d) => d._id)).toEqual(['a', 'c']);
    });
});

describe('BuyBoxData.findLatest', () => {
    it('sorts by data day then capture time and returns lean', () => {
        const chain = { sort: jest.fn(() => chain), lean: jest.fn(() => 'doc') };
        jest.spyOn(BuyBoxData, 'findOne').mockReturnValue(chain);
        expect(BuyBoxData.findLatest('u', 'NA', 'US')).toBe('doc');
        expect(chain.sort).toHaveBeenCalledWith({ date: -1, createdAt: -1 });
        expect(chain.lean).toHaveBeenCalled();
    });
});

describe('dashboard count equals the active Buy Box task list', () => {
    // A: lost, active. B: lost, inactive. C: blip, active. D: holds it, active.
    const days = () => [
        day('2026-10-13', { A: [0, 10], B: [0, 10], C: [0, 10], D: [100, 10] }),
        day('2026-10-12', { A: [0, 10], B: [0, 10], C: [100, 10], D: [100, 10] }),
        day('2026-10-11', { A: [100, 10], B: [0, 10], C: [100, 10], D: [100, 10] })
    ];
    const products = [
        { asin: 'A', status: 'Active' },
        { asin: 'B', status: 'Inactive' },
        { asin: 'C', status: 'Active' },
        { asin: 'D', status: 'Active' }
    ];

    it('countActiveBuyBoxLosses counts flagged Active ASINs only', () => {
        const eff = classifyBuyBoxLoss(days());
        expect(eff.productsWithoutBuyBox).toBe(2); // A and B
        expect(countActiveBuyBoxLosses(eff, new Set(['A', 'C', 'D']))).toBe(1);
        expect(countActiveBuyBoxLosses(null, new Set(['A']))).toBe(0);
    });

    it('DashboardSummaryService reports the same count as the task list', () => {
        expect(summarizeBuyBoxDays(days(), products)).toEqual({
            totalProducts: 4,
            productsWithBuyBox: 2,
            productsWithoutBuyBox: 1
        });
        expect(summarizeBuyBoxDays([], products)).toEqual({
            totalProducts: 0, productsWithBuyBox: 0, productsWithoutBuyBox: 0
        });
    });

    it('DashboardCalculation: count == active flagged list, estimate from average sessions', async () => {
        const eff = classifyBuyBoxLoss(days());
        // D sold 2 units for $40 on 10 sessions -> benchmark CVR 0.2, price $20.
        Object.assign(row(eff, 'D'), { unitsOrdered: 2, sales: { amount: 40, currencyCode: 'USD' } });
        // C's blip day is carried forward at 100% but must not dilute the benchmark.
        // A had 10 sessions on the newest day but averages 5/day.
        row(eff, 'A').avgDailySessions = 5;
        row(eff, 'A').avgDailySales = 0;

        const { dashboardData } = await analyseData({
            Country: 'US',
            TotalProducts: products,
            BuyBoxData: eff
        }, null, { persistTasks: false });

        const buyBoxTasks = dashboardData.conversionProductWiseErrors
            .filter((p) => p.productsWithOutBuyboxErrorData)
            .map((p) => p.productsWithOutBuyboxErrorData);
        expect(buyBoxTasks.map((t) => t.asin)).toEqual(['A']);
        expect(dashboardData.productsWithoutBuyBox).toBe(buyBoxTasks.length);
        expect(dashboardData.productsWithOutBuyboxError).toBe(buyBoxTasks.length);

        // 5 sessions/day x 0.2 x $20 = $20/day, x 30 days. One-day sessions (10)
        // would have given 1200; diluting the benchmark with C would lower it.
        expect(buyBoxTasks[0].lostRevenueAmount).toBeCloseTo(600);
        expect(buyBoxTasks[0].observedDays).toBe(3);
        expect(buyBoxTasks[0]).not.toHaveProperty('estimatedFromSingleDaySnapshot');
    });

    it('DashboardCalculation: no Buy Box data means no Buy Box issues', async () => {
        const { dashboardData } = await analyseData({
            Country: 'US',
            TotalProducts: products,
            BuyBoxData: classifyBuyBoxLoss([])
        }, null, { persistTasks: false });
        expect(dashboardData.productsWithoutBuyBox).toBe(0);
        expect(dashboardData.conversionProductWiseErrors.filter((p) => p.productsWithOutBuyboxErrorData)).toHaveLength(0);
    });
});

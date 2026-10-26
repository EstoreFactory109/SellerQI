/**
 * tasks-logics.xlsx "ACoS": product ACoS over 14 days above break-even ACoS (margin
 * before ad spend; the target ACoS without COGS). Min data: spend over the greater
 * of $30 or 2x price, and 20+ clicks.
 */
const { detectProductAcos, breakEvenAcosByAsin } = require('../../../../Services/Calculations/kpi/AlignedDetectors.js');

const NOW = new Date('2026-10-26T12:00:00Z');
const day = (offset) => new Date(Date.UTC(2026, 9, 25 - offset)).toISOString().slice(0, 10);
// 14 days of $5 spend, 2 clicks a day = $70, 28 clicks.
const rows = (asin, { sales = 7, spend = 5, clicks = 2, days = 14 } = {}) =>
    Array.from({ length: days }, (_, i) => ({ asin, date: day(i), spend, sales, clicks }));
const products = new Map([['A1', { asin: 'A1', price: 20, itemName: 'Widget' }]]);
const run = (adsRows, extra = {}) => detectProductAcos({ adsRows, country: 'US', productsByAsin: products, now: NOW, ...extra });

describe('detectProductAcos', () => {
    it('flags ACoS above the COGS break-even', () => {
        // Break-even: ($1000 - $300 fees - $10 x 50) / $1000 = 20%. ACoS = 70/98 = 71%.
        const { tasks, covered } = run(rows('A1'), {
            profitRows: [{ asin: 'A1', sales: 1000, amzFee: 300, quantity: 50 }], cogsMap: { A1: 10 }
        });
        expect(covered).toBe(true);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ errorType: 'product_acos_above_breakeven', errorCategory: 'sponsoredAds' });
        expect(tasks[0].renderData).toMatchObject({ acos: 71.4, breakEvenAcos: 20, breakEvenFromCogs: true, clicks: 28 });
        expect(tasks[0].error).toContain('above your break-even of 20%');
        // $70 spend - $98 x 20% = $50.40 over break-even.
        expect(tasks[0].amount).toBe(50.4);
    });

    it('uses the target ACoS without COGS, and says so', () => {
        const { tasks } = run(rows('A1', { sales: 150 })); // ACoS 70/2100 = 3.3%
        expect(tasks).toHaveLength(0);
        const [task] = run(rows('A1')).tasks; // 71% > 40%
        expect(task.renderData.breakEvenFromCogs).toBe(false);
        expect(task.error).toContain('your target of 40%');
    });

    it('needs spend over max($30, 2x price) and 20+ clicks', () => {
        expect(run(rows('A1', { spend: 2.8 })).tasks).toHaveLength(0); // $39.20 <= $40 (2 x $20)
        expect(run(rows('A1', { clicks: 1 })).tasks).toHaveLength(0); // 14 clicks
    });

    it('only counts the last 14 ads days', () => {
        const old = rows('A1', { days: 30 }).filter((_, i) => i >= 14);
        expect(run(old).tasks).toHaveLength(0);
    });

    it('makes no verdict on stale ads data', () => {
        const stale = rows('A1').map((r) => ({ ...r, date: '2026-09-01' }));
        expect(run(stale)).toEqual({ tasks: [], covered: false });
    });

    it('skips rows without sales or COGS in the break-even map', () => {
        const map = breakEvenAcosByAsin([{ asin: 'A1', sales: 0, amzFee: 1, quantity: 1 }, { asin: 'B1', sales: 10, quantity: 1 }], { A1: 1 });
        expect(map.size).toBe(0);
    });
});

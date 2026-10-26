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

describe('proposeBidCuts', () => {
    const { proposeBidCuts } = require('../../../../Services/Calculations/kpi/AlignedDetectors.js');
    const groups = [{ asin: 'A1', adGroupId: 'G1' }, { asin: 'A1', adGroupId: 'G2' }, { asin: 'B9', adGroupId: 'G2' }];
    const snap = [
        { keywordId: 'K1', keywordText: 'garlic press', adGroupId: 'G1', campaignId: 'C1', bid: 1.0, state: 'ENABLED' },
        { keywordId: 'K2', keywordText: 'press', adGroupId: 'G2', campaignId: 'C1', bid: 0.8, state: 'enabled' },
        { keywordId: 'K3', keywordText: 'no bid', adGroupId: 'G1', campaignId: 'C1', state: 'enabled' },
        { keywordId: 'K4', keywordText: 'other product', adGroupId: 'G9', campaignId: 'C1', bid: 1, state: 'enabled' }
    ];
    const perf = (keywordId, adGroupId, cost, sales, clicks) => ({ keywordId, adGroupId, date: '2026-10-20', cost, attributedSales30d: sales, clicks });
    const run = (rows, bePct = 20) => proposeBidCuts({ asin: 'A1', bePct, adGroupsByAsin: groups, keywordRows: rows, keywordSnapshot: snap, country: 'US', from: '2026-10-12' });

    it('cuts toward break-even, at most 30%, and flags shared ad groups', () => {
        // K1: ACoS 25% vs break-even 20% -> x0.8 = 0.80. K2: no sales -> max cut 30% -> 0.56.
        const cuts = run([perf('K1', 'G1', 25, 100, 20), perf('K2', 'G2', 10, 0, 12)]);
        expect(cuts.map(c => [c.keywordId, c.newBid, c.sharedAdGroup])).toEqual([['K1', 0.8, false], ['K2', 0.56, true]]);
    });

    it('skips keywords under 10 clicks, under break-even, without a bid, or in other products\' ad groups', () => {
        expect(run([perf('K1', 'G1', 25, 100, 9)])).toEqual([]);
        expect(run([perf('K1', 'G1', 10, 100, 20)])).toEqual([]);
        expect(run([perf('K3', 'G1', 25, 0, 20)])).toEqual([]);
        expect(run([perf('K4', 'G9', 25, 0, 20)])).toEqual([]);
    });

    it('never goes below the minimum bid', () => {
        const low = snap.map(k => (k.keywordId === 'K1' ? { ...k, bid: 0.02 } : k));
        expect(proposeBidCuts({ asin: 'A1', bePct: 20, adGroupsByAsin: groups, keywordRows: [perf('K1', 'G1', 25, 0, 20)], keywordSnapshot: low, country: 'US', from: '2026-10-12' })).toEqual([]);
    });
});

describe('proposeBidCuts with product and auto targets', () => {
    const { proposeBidCuts } = require('../../../../Services/Calculations/kpi/AlignedDetectors.js');
    const groups = [{ asin: 'A1', adGroupId: 'G1' }];
    const target = (over) => ({ targetId: 'T1', adGroupId: 'G1', campaignId: 'C2', expression: 'close-match', bid: 1.2, cost: 30, sales: 60, clicks: 25, ...over });
    const run = (targets) => proposeBidCuts({ asin: 'A1', bePct: 20, adGroupsByAsin: groups, keywordRows: [], keywordSnapshot: [], targets, country: 'US', from: '2026-10-12' });

    it('cuts a target above break-even, marked as a target', () => {
        // ACoS 50% vs 20% -> factor 0.4, capped at a 30% cut -> 0.84.
        expect(run([target()])).toEqual([expect.objectContaining({ kind: 'target', targetId: 'T1', keyword: 'close-match', currentBid: 1.2, newBid: 0.84 })]);
    });

    it('skips targets without a bid, under 10 clicks, or in other ad groups', () => {
        expect(run([target({ bid: null })])).toEqual([]);
        expect(run([target({ clicks: 9 })])).toEqual([]);
        expect(run([target({ adGroupId: 'G9' })])).toEqual([]);
    });
});

describe('targetsFromReport', () => {
    const { targetsFromReport } = require('../../../../Services/AmazonAds/AdsTargets.js');
    it('keeps targets that spent, not keywords', () => {
        const rows = [
            { keywordId: 1, keywordType: 'TARGETING_EXPRESSION_PREDEFINED', targeting: 'close-match', adGroupId: 9, campaignId: 8, cost: 5, sales7d: 0, clicks: 3 },
            { keywordId: 2, keywordType: 'TARGETING_EXPRESSION', targeting: 'asin="B0X"', adGroupId: 9, campaignId: 8, cost: 0, sales7d: 0, clicks: 0 },
            { keywordId: 3, keywordType: 'EXACT', targeting: 'garlic', adGroupId: 9, campaignId: 8, cost: 7, sales7d: 1, clicks: 2 }
        ];
        expect(targetsFromReport(rows)).toEqual([expect.objectContaining({ targetId: '1', expression: 'close-match', adGroupId: '9', cost: 5 })]);
    });
});

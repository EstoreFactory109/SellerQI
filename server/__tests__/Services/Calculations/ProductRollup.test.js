/**
 * Tests for the product-level rollup and the ads→product attribution behind it.
 *
 * The invariants here are about honesty with money: attribution may only move
 * dollars between buckets, never create or destroy them, and an inferred figure
 * must always be labelled inferred.
 */

const {
    buildProductRollupFromTasks,
    MAX_PRODUCTS,
    MAX_TASKS_PER_PRODUCT
} = require('../../../Services/Calculations/TaskOpportunityGroupsService.js');
const {
    buildCampaignAsinIndex,
    attributeAdsTasksToAsins,
    splitAcrossAsins
} = require('../../../Services/Calculations/AdsProductAttributionService.js');

let n = 0;
const task = (over = {}) => ({
    taskId: over.taskId || `t${++n}`,
    productName: over.productName || 'Product',
    asin: over.asin || 'B0AAAAAAAA',
    errorCategory: over.errorCategory || 'profitability',
    errorType: over.errorType || 'negative_profit',
    amount: over.amount ?? 0,
    amountIsEstimated: over.amountIsEstimated ?? false,
    ...over
});

const adsTask = (over = {}) => task({
    errorCategory: 'sponsoredAds',
    errorType: 'wasted_spend_keyword',
    asin: over.keywordId || '999999',
    renderData: { campaignId: over.campaignId, campaignName: over.campaignName },
    ...over
});

const sum = (arr, f) => Math.round(arr.reduce((s, x) => s + f(x), 0) * 100) / 100;

describe('splitAcrossAsins', () => {
    it('gives the whole amount to a single-ASIN campaign', () => {
        expect(splitAcrossAsins(10, new Map([['B01', 5]]))).toEqual([{ asin: 'B01', amount: 10 }]);
    });

    it('splits in proportion to each ASIN\'s own ad spend', () => {
        const parts = splitAcrossAsins(100, new Map([['B01', 75], ['B02', 25]]));
        expect(parts).toEqual([{ asin: 'B01', amount: 75 }, { asin: 'B02', amount: 25 }]);
    });

    it('splits equally when the campaign has no recorded spend', () => {
        const parts = splitAcrossAsins(10, new Map([['B01', 0], ['B02', 0]]));
        expect(parts.map(p => p.amount)).toEqual([5, 5]);
    });

    // The whole point: attribution reshuffles money, it never mints it.
    it('always sums back to the original amount, even with awkward rounding', () => {
        for (const amount of [0.01, 0.07, 10, 33.33, 187.41, 1000.005]) {
            const parts = splitAcrossAsins(amount, new Map([['B01', 1], ['B02', 1], ['B03', 1]]));
            expect(sum(parts, p => p.amount)).toBe(Math.round(amount * 100) / 100);
        }
    });

    it('returns nothing for a campaign with no ASINs', () => {
        expect(splitAcrossAsins(10, new Map())).toEqual([]);
    });
});

describe('attributeAdsTasksToAsins', () => {
    const index = buildCampaignAsinIndex([
        { asin: 'B01', campaignId: 'c1', campaignName: 'Campaign One', spend: 30 },
        { asin: 'B02', campaignId: 'c1', campaignName: 'Campaign One', spend: 10 },
        { asin: 'B03', campaignId: 'c2', campaignName: 'Campaign Two', spend: 5 }
    ]);

    it('joins on campaignId', () => {
        const r = attributeAdsTasksToAsins([adsTask({ amount: 40, campaignId: 'c1' })], index);
        expect(r.byAsin.get('B01').amount).toBe(30); // 30/40 of the spend
        expect(r.byAsin.get('B02').amount).toBe(10);
        expect(r.attributedAmount).toBe(40);
        expect(r.splitTasks).toBe(1);
    });

    it('falls back to campaignName when the task predates campaignId being stored', () => {
        const r = attributeAdsTasksToAsins([adsTask({ amount: 8, campaignName: 'Campaign Two' })], index);
        expect(r.byAsin.get('B03').amount).toBe(8);
        expect(r.attributedTasks).toBe(1);
    });

    it('leaves an unmatched campaign unattributed rather than guessing', () => {
        const r = attributeAdsTasksToAsins([adsTask({ amount: 25, campaignId: 'nope' })], index);
        expect(r.byAsin.size).toBe(0);
        expect(r.unattributedAmount).toBe(25);
        expect(r.unattributedTasks).toBe(1);
    });

    it('conserves money across attributed and unattributed', () => {
        const tasks = [
            adsTask({ amount: 40, campaignId: 'c1' }),
            adsTask({ amount: 8, campaignId: 'c2' }),
            adsTask({ amount: 25, campaignId: 'missing' })
        ];
        const r = attributeAdsTasksToAsins(tasks, index);
        expect(r.attributedAmount + r.unattributedAmount).toBe(73);
        expect(sum([...r.byAsin.values()], v => v.amount)).toBe(r.attributedAmount);
    });

    it('does not throw on malformed input', () => {
        expect(() => attributeAdsTasksToAsins([null, {}, undefined], index)).not.toThrow();
        expect(() => attributeAdsTasksToAsins(null, index)).not.toThrow();
    });
});

describe('buildProductRollupFromTasks', () => {
    it('returns nothing for empty input', () => {
        expect(buildProductRollupFromTasks([]).products).toEqual([]);
        expect(buildProductRollupFromTasks(null).products).toEqual([]);
    });

    it('sums a product\'s own tasks exactly', () => {
        const { products } = buildProductRollupFromTasks([
            task({ asin: 'B01', amount: 10 }),
            task({ asin: 'B01', errorCategory: 'ranking', errorType: 'titleresult_char_limit', amount: 0 }),
            task({ asin: 'B01', errorCategory: 'conversion', errorType: 'no_buybox', amount: 5 })
        ]);
        expect(products).toHaveLength(1);
        expect(products[0].profitGap).toBe(15);
        expect(products[0].profitImpact).toBe(15);
        expect(products[0].taskCount).toBe(3);
        expect(products[0].categories.sort()).toEqual(['conversion', 'profitability', 'ranking']);
    });

    // A search term can itself be an ASIN-shaped string, which a shape-based test
    // mistakes for a product — double-counting the money.
    it('never treats a sponsored-ads task as its own product, even when its id looks like an ASIN', () => {
        const { products, potentialProfitImpact } = buildProductRollupFromTasks([
            adsTask({ asin: 'b07fmhwfwt', amount: 9.17, campaignId: 'unmatched' })
        ]);
        expect(products).toEqual([]);
        expect(potentialProfitImpact).toBe(0);
    });

    // netProfit already has ad spend subtracted, so a product's loss ALREADY
    // contains its wasted ad spend. Adding them reported figures above breakeven.
    it('caps ad waste against the profit gap instead of adding it', () => {
        const { products } = buildProductRollupFromTasks(
            [task({ asin: 'B01', amount: 100 })],
            { adsByAsin: new Map([['B01', { amount: 25, taskCount: 4 }]]) }
        );
        expect(products[0].profitGap).toBe(100);
        expect(products[0].adWasteComponent).toBe(25);
        expect(products[0].profitImpact).toBe(100);            // NOT 125
        expect(products[0].amountIsEstimated).toBe(true);
        // Split ad issues count once per product, so they stay in their own tally.
        expect(products[0].taskCount).toBe(1);
        expect(products[0].adsTaskCount).toBe(4);
    });

    it('uses the ad waste when it exceeds the gap, since removing it really does gain that much', () => {
        const { products } = buildProductRollupFromTasks(
            [task({ asin: 'B01', amount: 20 })],
            { adsByAsin: new Map([['B01', { amount: 50, taskCount: 2 }]]) }
        );
        // Removing $50 of waste from a product losing $20 turns it profitable.
        expect(products[0].profitImpact).toBe(50);
    });

    // The specific defect that shipped: a figure above what is obtainable.
    it('never reports more than max(profit gap, ad waste) for any product', () => {
        const { products } = buildProductRollupFromTasks(
            [
                task({ asin: 'B01', amount: 122.29 }),
                task({ asin: 'B02', amount: 72.08 }),
                task({ asin: 'B03', amount: 0, errorCategory: 'ranking', errorType: 'titleresult_char_limit' })
            ],
            {
                adsByAsin: new Map([
                    ['B01', { amount: 24.28, taskCount: 12 }],
                    ['B02', { amount: 40.19, taskCount: 23 }],
                    ['B03', { amount: 5, taskCount: 1 }]
                ]),
                maxProducts: 999
            }
        );
        products.forEach(p => {
            expect(p.profitImpact).toBeLessThanOrEqual(Math.max(p.profitGap, p.adWasteComponent) + 0.001);
        });
        // The real regression case, exactly.
        expect(products.find(p => p.asin === 'B01').profitImpact).toBe(122.29);
    });

    it('tracks capital separately and keeps it out of profit entirely', () => {
        const { products, potentialProfitImpact, capitalTiedUp } = buildProductRollupFromTasks([
            task({ asin: 'B01', errorCategory: 'inventory', errorType: 'unfulfillable_inventory', amount: 0, capitalAmount: 7902.24 }),
            task({ asin: 'B01', amount: 10 })
        ]);
        expect(products[0].capitalTiedUp).toBe(7902.24);
        expect(products[0].profitImpact).toBe(10);   // capital must not inflate profit
        expect(potentialProfitImpact).toBe(10);
        expect(capitalTiedUp).toBe(7902.24);
    });

    it('keeps a product measured when it has no inferred money', () => {
        const { products } = buildProductRollupFromTasks([task({ asin: 'B01', amount: 10 })]);
        expect(products[0].amountIsEstimated).toBe(false);
    });

    it('surfaces a product whose only problem is attributed ad waste', () => {
        const { products } = buildProductRollupFromTasks(
            [task({ asin: 'B01', amount: 1 })],
            { adsByAsin: new Map([['B99', { amount: 500, taskCount: 9 }]]) }
        );
        expect(products[0].asin).toBe('B99');
        expect(products[0].taskCount).toBe(0);
        expect(products[0].categories).toEqual(['sponsoredAds']);
    });

    it('ranks by recoverable money, descending', () => {
        const { products } = buildProductRollupFromTasks([
            task({ asin: 'B01', amount: 5 }),
            task({ asin: 'B02', amount: 500 }),
            task({ asin: 'B03', amount: 50 })
        ]);
        expect(products.map(p => p.asin)).toEqual(['B02', 'B03', 'B01']);
    });

    it('keeps a money-free product in the list but below every product with money', () => {
        const { products } = buildProductRollupFromTasks([
            task({ asin: 'B01', errorCategory: 'ranking', errorType: 'titleresult_char_limit', amount: 0 }),
            task({ asin: 'B02', amount: 0.01 })
        ]);
        expect(products.map(p => p.asin)).toEqual(['B02', 'B01']);
    });

    it('caps the product list and each product\'s task list', () => {
        const many = Array.from({ length: 40 }, (_, i) => task({ asin: `B${String(i).padStart(9, '0')}`, amount: i }));
        expect(buildProductRollupFromTasks(many).products.length).toBe(MAX_PRODUCTS);

        const oneProduct = Array.from({ length: 20 }, (_, i) => task({ asin: 'B01', amount: i }));
        expect(buildProductRollupFromTasks(oneProduct).products[0].topTasks.length).toBe(MAX_TASKS_PER_PRODUCT);
    });

    it('excludes account-level tasks, which belong to no product', () => {
        const { products } = buildProductRollupFromTasks([
            task({ asin: 'ACCOUNT', errorCategory: 'account', errorType: 'accountStatus', amount: 0 }),
            task({ asin: 'B01', amount: 10 })
        ]);
        expect(products.map(p => p.asin)).toEqual(['B01']);
    });

    // Money is no longer "conserved" against the naive sum — that is the fix. The
    // de-duplicated total must be at or below it, and strictly below when overlap exists.
    it('reports at most the naive sum, and strictly less when a product overlaps', () => {
        const tasks = [
            task({ asin: 'B01', amount: 100 }),
            task({ asin: 'B02', amount: 50 })
        ];
        const naive = 150 + 20; // if ad waste were wrongly added on top
        const r = buildProductRollupFromTasks(tasks, {
            adsByAsin: new Map([['B01', { amount: 20, taskCount: 2 }]]),
            maxProducts: 999
        });
        expect(r.potentialProfitImpact).toBe(150);
        expect(r.potentialProfitImpact).toBeLessThan(naive);
    });

    it('still counts ad waste on an ASIN that has no profit gap of its own', () => {
        const r = buildProductRollupFromTasks(
            [task({ asin: 'B01', amount: 100 })],
            { adsByAsin: new Map([['B99', { amount: 60, taskCount: 3 }]]), maxProducts: 999 }
        );
        expect(r.potentialProfitImpact).toBe(160);
    });

    it('does not throw on malformed tasks', () => {
        expect(() => buildProductRollupFromTasks([null, undefined, {}, { asin: 'B01' }])).not.toThrow();
    });
});

/**
 * Tests for TaskOpportunityGroupsService — the single ranking authority shared by
 * the Dashboard's "Top things to fix" and the Tasks page's buckets.
 *
 * The invariant these protect: a dashboard group must always be exactly the sum
 * of the task rows a seller sees on the Tasks page. If that breaks, the two pages
 * start telling the seller different things, which is the whole reason this
 * module exists.
 */

const {
    buildGroupsFromTasks,
    compareByImpact,
    getGroupCopy,
    GROUP_COPY,
    CONFIDENCE,
    MAX_GROUPS,
    MAX_EXAMPLES_PER_GROUP
} = require('../../../Services/Calculations/TaskOpportunityGroupsService.js');
const { IMPACT_WEIGHT } = require('../../../Services/Calculations/TaskPrioritizationService.js');
const { validateSelections } = require('../../../Services/AI/TopOpportunitiesService.js');

let n = 0;
const task = (over = {}) => ({
    taskId: over.taskId || `t${++n}`,
    productName: over.productName || 'Product',
    asin: over.asin || 'B000',
    errorCategory: 'sponsoredAds',
    errorType: 'wasted_spend_keyword',
    amount: 0,
    amountIsEstimated: false,
    ...over
});

describe('buildGroupsFromTasks', () => {
    it('returns nothing for empty or invalid input', () => {
        expect(buildGroupsFromTasks([])).toEqual({ groups: [], totalRecoverableAmount: 0, tasksConsidered: 0 });
        expect(buildGroupsFromTasks(null).groups).toEqual([]);
    });

    it('collapses many tasks of one type into a single group', () => {
        const { groups } = buildGroupsFromTasks([
            task({ amount: 10 }), task({ amount: 20 }), task({ amount: 30 })
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].id).toBe('sponsoredAds:wasted_spend_keyword');
        expect(groups[0].count).toBe(3);
        expect(groups[0].totalAmount).toBe(60);
    });

    it('separates groups by category AND errorType', () => {
        const { groups } = buildGroupsFromTasks([
            task({ errorCategory: 'profitability', errorType: 'negative_profit', amount: 5 }),
            task({ errorCategory: 'profitability', errorType: 'low_margin', amount: 5 }),
            task({ errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword', amount: 5 })
        ]);
        expect(groups).toHaveLength(3);
    });

    it('collapses SKU-suffixed replenishment tasks into one group', () => {
        const { groups } = buildGroupsFromTasks(
            Array.from({ length: 5 }, (_, i) =>
                task({ errorCategory: 'inventory', errorType: `replenishment_needed_SKU-${i}`, amount: 1 }))
        );
        expect(groups).toHaveLength(1);
        expect(groups[0].issueType).toBe('replenishment_needed');
        expect(groups[0].count).toBe(5);
    });

    // ── THE core sync invariant ──
    it('makes every group exactly the sum and count of its member tasks', () => {
        const tasks = [
            ...Array.from({ length: 93 }, (_, i) => task({ errorType: 'wasted_spend_keyword', amount: (i + 1) / 10 })),
            ...Array.from({ length: 9 }, (_, i) => task({ errorCategory: 'profitability', errorType: 'negative_profit', amount: i * 11 })),
            ...Array.from({ length: 27 }, () => task({ errorCategory: 'ranking', errorType: 'titleresult_char_limit', amount: 0 }))
        ];

        const { groups, totalRecoverableAmount } = buildGroupsFromTasks(tasks, { maxGroups: 999 });

        for (const g of groups) {
            const members = tasks.filter(t => t.errorCategory === g.category && t.errorType === g.issueType);
            const sum = Math.round(members.reduce((s, t) => s + t.amount, 0) * 100) / 100;
            expect(g.count).toBe(members.length);
            expect(g.totalAmount).toBe(sum);
        }

        // And the headline figure equals every task summed — what the Tasks page shows.
        const allTasks = Math.round(tasks.reduce((s, t) => s + t.amount, 0) * 100) / 100;
        expect(totalRecoverableAmount).toBe(allTasks);
    });

    it('caps and orders examples biggest-dollar first', () => {
        const { groups } = buildGroupsFromTasks(
            Array.from({ length: 20 }, (_, i) => task({ productName: `kw${i}`, amount: i + 1 }))
        );
        expect(groups[0].topExamples).toHaveLength(MAX_EXAMPLES_PER_GROUP);
        expect(groups[0].topExamples[0].amount).toBe(20);
        expect(groups[0].totalAmount).toBe(210); // full total, not just the examples
    });

    it('caps the number of groups returned', () => {
        const tasks = Array.from({ length: 30 }, (_, i) =>
            task({ errorCategory: 'ranking', errorType: `made_up_type_${i}`, amount: i }));
        expect(buildGroupsFromTasks(tasks).groups.length).toBeLessThanOrEqual(MAX_GROUPS);
    });

    it('marks a group estimated when any member dollar is estimated', () => {
        const { groups } = buildGroupsFromTasks([
            task({ errorCategory: 'conversion', errorType: 'no_buybox', amount: 10, amountIsEstimated: true }),
            task({ errorCategory: 'conversion', errorType: 'no_buybox', amount: 10 })
        ]);
        expect(groups[0].confidence).toBe(CONFIDENCE.ESTIMATED);
    });

    it('keeps a group measured when every dollar is measured', () => {
        const { groups } = buildGroupsFromTasks([task({ amount: 10 }), task({ amount: 20 })]);
        expect(groups[0].confidence).toBe(CONFIDENCE.MEASURED);
    });

    it('flags the growth-only ads opportunity', () => {
        const { groups } = buildGroupsFromTasks([
            task({ errorType: 'auto_campaign_migration_needed', amount: 0 })
        ]);
        expect(groups[0].isGrowthOpportunity).toBe(true);
    });

    it('does not throw on malformed tasks', () => {
        expect(() => buildGroupsFromTasks([null, undefined, {}, { errorCategory: 'x' }])).not.toThrow();
        expect(buildGroupsFromTasks([null, {}]).groups).toEqual([]);
    });
});

describe('ordering — money first, then severity', () => {
    it('puts real money above any weight, however severe', () => {
        const { groups } = buildGroupsFromTasks([
            task({ errorCategory: 'account', errorType: 'accountStatus', amount: 0 }),   // weight 100
            task({ errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword', amount: 1 })
        ]);
        expect(groups[0].id).toBe('sponsoredAds:wasted_spend_keyword');
        expect(groups[1].id).toBe('account:accountStatus');
    });

    it('orders money groups by amount descending', () => {
        const { groups } = buildGroupsFromTasks([
            task({ errorType: 'search_term_zero_sales', amount: 50 }),
            task({ errorType: 'wasted_spend_keyword', amount: 500 }),
            task({ errorCategory: 'profitability', errorType: 'negative_profit', amount: 200 })
        ]);
        expect(groups.map(g => g.totalAmount)).toEqual([500, 200, 50]);
    });

    it('orders zero-money groups by impact weight, so a suspension beats a description tweak', () => {
        const { groups } = buildGroupsFromTasks([
            task({ errorCategory: 'ranking', errorType: 'description_char_limit', amount: 0 }),
            task({ errorCategory: 'account', errorType: 'accountStatus', amount: 0 }),
            task({ errorCategory: 'conversion', errorType: 'no_buybox', amount: 0 })
        ]);
        expect(groups.map(g => g.id)).toEqual([
            'account:accountStatus',      // 100
            'conversion:no_buybox',       // 80
            'ranking:description_char_limit' // 20
        ]);
    });

    it('cannot be outvoted by sheer volume of $0 items', () => {
        const { groups } = buildGroupsFromTasks([
            ...Array.from({ length: 500 }, () => task({ errorType: 'auto_campaign_migration_needed', amount: 0 })),
            task({ errorType: 'wasted_spend_keyword', amount: 1 })
        ]);
        expect(groups[0].id).toBe('sponsoredAds:wasted_spend_keyword');
    });

    it('compareByImpact is total and reflexive', () => {
        const a = { id: 'a', totalAmount: 5, impactWeight: 1, confidence: CONFIDENCE.MEASURED, count: 1 };
        const b = { id: 'b', totalAmount: 0, impactWeight: 99, confidence: CONFIDENCE.MEASURED, count: 1 };
        expect(compareByImpact(a, b)).toBeLessThan(0);
        expect(compareByImpact(b, a)).toBeGreaterThan(0);
        expect(compareByImpact(a, a)).toBe(0);
    });
});

describe('seller-facing copy', () => {
    // Every issue type the prioritization tables know about must also have a title
    // the dashboard can display — otherwise a group renders as a generic stub.
    const ALL_KEYS = Object.keys(IMPACT_WEIGHT);

    it.each(ALL_KEYS)('has non-generic copy for %s', (key) => {
        const [category, ...rest] = key.split(':');
        const copy = getGroupCopy(category, rest.join(':'));
        expect(copy.title).toBeTruthy();
        expect(copy.action).toBeTruthy();
        expect(copy.title).not.toMatch(/issues needing attention$/);
    });

    it('reuses the wording sellers already see for the ten original dashboard groups', () => {
        expect(GROUP_COPY['sponsoredAds:wasted_spend_keyword'].title).toBe('Keywords spending money with zero sales');
        expect(GROUP_COPY['profitability:negative_profit'].title).toBe('Products losing money on every sale');
        expect(GROUP_COPY['inventory:unfulfillable_inventory'].title).toBe('Unsellable stock sitting in FBA');
        expect(GROUP_COPY['conversion:no_buybox'].title).toBe('Products not winning the Buy Box');
    });

    it('generates readable copy for ranking checks that have no explicit entry', () => {
        const copy = getGroupCopy('ranking', 'bulletpoints_restricted_words');
        expect(copy.title).toBe('Listings with a bullet points containing restricted words');
    });

    it('falls back safely for a completely unknown type', () => {
        const copy = getGroupCopy('someNewCategory', 'some_new_type');
        expect(copy.title).toBeTruthy();
        expect(copy.action).toBeTruthy();
    });
});

describe('TopOpportunitiesService enforces money-before-zero', () => {
    const candidates = [
        { id: 'money', category: 'sponsoredAds', issueType: 'wasted_spend_keyword', title: 'Money', action: 'a', totalAmount: 100, count: 1, confidence: CONFIDENCE.MEASURED, isGrowthOpportunity: false, topExamples: [] },
        { id: 'zero', category: 'account', issueType: 'accountStatus', title: 'Zero', action: 'a', totalAmount: 0, count: 1, confidence: CONFIDENCE.MEASURED, isGrowthOpportunity: false, topExamples: [] }
    ];

    it('reorders a model that ranks a $0 item above real money', () => {
        // The prompt forbids this, but a prompt is not a guarantee.
        const selections = validateSelections(
            [{ candidateId: 'zero', rank: 1, why: 'w', action: 'a' }, { candidateId: 'money', rank: 2, why: 'w', action: 'a' }],
            candidates
        );
        expect(selections.map(s => s.candidateId)).toEqual(['money', 'zero']);
        expect(selections.map(s => s.rank)).toEqual([1, 2]);
    });

    it('leaves a correctly-ordered response alone', () => {
        const selections = validateSelections(
            [{ candidateId: 'money', rank: 1, why: 'w', action: 'a' }, { candidateId: 'zero', rank: 2, why: 'w', action: 'a' }],
            candidates
        );
        expect(selections.map(s => s.candidateId)).toEqual(['money', 'zero']);
    });
});

describe('cross-surface consistency', () => {
    const { buildProductRollupFromTasks } = require('../../../Services/Calculations/TaskOpportunityGroupsService.js');

    let m = 0;
    const t = (over = {}) => ({
        taskId: `x${++m}`,
        productName: 'P',
        asin: over.asin || 'B0AAAAAAAA',
        errorCategory: over.errorCategory || 'profitability',
        errorType: over.errorType || 'negative_profit',
        amount: over.amount ?? 0,
        amountIsEstimated: false,
        ...over
    });

    // Issue-level totals stay a faithful sum of the task rows — they describe one
    // issue type each, so there is no cross-type overlap to remove.
    it('issue-level total equals the sum of every task row', () => {
        const tasks = [
            ...Array.from({ length: 40 }, (_, i) => t({ asin: `B0${String(i % 7).padStart(8, '0')}`, amount: (i + 1) / 7 })),
            ...Array.from({ length: 15 }, () => t({ errorCategory: 'ranking', errorType: 'titleresult_char_limit', asin: 'B0AAAAAAAA', amount: 0 })),
            ...Array.from({ length: 10 }, (_, i) => t({ errorCategory: 'conversion', errorType: 'no_buybox', asin: `B0${String(i).padStart(8, '0')}`, amount: i * 3 }))
        ];
        const taskTotal = Math.round(tasks.reduce((s, x) => s + x.amount, 0) * 100) / 100;

        expect(buildGroupsFromTasks(tasks, { maxGroups: 999 }).totalRecoverableAmount).toBe(taskTotal);
    });

    // The product-level total deliberately does NOT match it once ad waste overlaps
    // a profit gap: that difference is the double-count being removed.
    it('product-level total is at or below the issue-level total, and strictly below when ad waste overlaps', () => {
        const tasks = [t({ asin: 'B01', amount: 100 }), t({ asin: 'B02', amount: 50 })];

        const issueTotal = buildGroupsFromTasks(tasks, { maxGroups: 999 }).totalRecoverableAmount;
        const noOverlap = buildProductRollupFromTasks(tasks, { maxProducts: 999 });
        expect(noOverlap.potentialProfitImpact).toBe(issueTotal);

        const withOverlap = buildProductRollupFromTasks(tasks, {
            adsByAsin: new Map([['B01', { amount: 20, taskCount: 1 }]]),
            maxProducts: 999
        });
        // The naive figure would be issueTotal + 20; capping keeps it at issueTotal.
        expect(withOverlap.potentialProfitImpact).toBe(issueTotal);
        expect(withOverlap.potentialProfitImpact).toBeLessThan(issueTotal + 20);
    });

    // A headline built from only the displayed slice understates the account, which
    // is exactly how the product view came to disagree with the Dashboard.
    it('the account totals count groups and products BELOW the displayed cut', () => {
        const tasks = Array.from({ length: 30 }, (_, i) =>
            t({ asin: `B0${String(i).padStart(8, '0')}`, amount: 100 - i }));

        const { groups, totalRecoverableAmount } = buildGroupsFromTasks(tasks, { maxGroups: 2 });
        const roll = buildProductRollupFromTasks(tasks, { maxProducts: 3 });
        const taskTotal = Math.round(tasks.reduce((s, x) => s + x.amount, 0) * 100) / 100;

        // Only a slice is returned for display...
        expect(groups.length).toBeLessThanOrEqual(2);
        expect(roll.products.length).toBe(3);
        // ...but the totals still describe the whole account.
        expect(totalRecoverableAmount).toBe(taskTotal);
        expect(roll.potentialProfitImpact).toBe(taskTotal);
        // And summing only what is shown is strictly smaller — the trap to avoid.
        const shownOnly = roll.products.reduce((s, p) => s + p.profitImpact, 0);
        expect(shownOnly).toBeLessThan(taskTotal);
    });

    it('capital never leaks into the profit total', () => {
        const tasks = [
            t({ asin: 'B01', amount: 10 }),
            t({ asin: 'B01', errorCategory: 'inventory', errorType: 'unfulfillable_inventory', amount: 0, capitalAmount: 7902.24 })
        ];
        const roll = buildProductRollupFromTasks(tasks, { maxProducts: 999 });
        expect(roll.potentialProfitImpact).toBe(10);
        expect(roll.capitalTiedUp).toBe(7902.24);
    });
});

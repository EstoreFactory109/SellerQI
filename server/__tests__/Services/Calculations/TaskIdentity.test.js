/**
 * The same real problem stays the same task while its label moves with its state.
 *
 * Pinned: each drifting family's labels share one identity; every other type keeps exactly
 * its old identity; the planner then updates the SAME row (status kept, type and text
 * refreshed), reopens a completed task at once only when the problem got worse, takes the
 * cooldown from the new state, prefers the row carrying the seller's decision when old rows
 * share an identity, and the generators emit one task per identity.
 */
const T = require('../../../Services/Calculations/TaskIdentity.js');
const { planReconcile } = require('../../../Services/Calculations/TaskReconcilePlanner.js');

const id = (asin, errorCategory, errorType, renderData) => T.identityKeyOf({ asin, errorCategory, errorType, renderData });

describe('identityKeyOf', () => {
    it('account health: unstable and sustained are one problem', () => {
        expect(id('ACCOUNT', 'account', 'orderWithDefectsStatus_unstable')).toBe(id('ACCOUNT', 'account', 'orderWithDefectsStatus'));
        expect(id('ACCOUNT', 'account', 'orderWithDefectsStatus')).not.toBe(id('ACCOUNT', 'account', 'lateShipmentRateStatus'));
    });

    it('stock: restock (with or without the old SKU suffix) and out of stock are one problem per product', () => {
        const out = id('B01', 'inventory', 'out_of_stock');
        expect(id('B01', 'inventory', 'replenishment_needed')).toBe(out);
        expect(id('B01', 'inventory', 'replenishment_needed_SKU-ABC-123')).toBe(out);
        expect(id('B02', 'inventory', 'out_of_stock')).not.toBe(out);
    });

    it('length checks: too long and too short are one problem per section', () => {
        expect(id('B01', 'ranking', 'titleresult_too_short')).toBe(id('B01', 'ranking', 'titleresult_char_limit'));
        expect(id('B01', 'ranking', 'backend_keywords_underused')).toBe(id('B01', 'ranking', 'backend_keywords_char_limit'));
        expect(id('B01', 'ranking', 'titleresult_char_limit')).not.toBe(id('B01', 'ranking', 'bulletpoints_char_limit'));
        expect(id('B01', 'ranking', 'backend_keywords_duplicate_words')).not.toBe(id('B01', 'ranking', 'backend_keywords_char_limit'));
    });

    it('profitability: loss, thin margin and ad spend with no sales are one problem per product', () => {
        const loss = id('B01', 'profitability', 'negative_profit');
        expect(id('B01', 'profitability', 'low_margin')).toBe(loss);
        expect(id('B01', 'profitability', 'ad_spend_no_sales')).toBe(loss);
        expect(id('ACCOUNT', 'profitability', 'cogs_missing')).not.toBe(id('ACCOUNT', 'profitability', 'negative_profit'));
    });

    it('ads keyword: the same whether keywordId came back or not, and whatever the case', () => {
        const rd = { campaignId: 'C1', adGroupId: 'G1', keyword: 'Red Shoes' };
        expect(id('123456', 'sponsoredAds', 'wasted_spend_keyword', rd))
            .toBe(id('red shoes', 'sponsoredAds', 'wasted_spend_keyword', { ...rd, keyword: '  red  shoes ' }));
        expect(id('123456', 'sponsoredAds', 'wasted_spend_keyword', rd))
            .not.toBe(id('123456', 'sponsoredAds', 'wasted_spend_keyword', { ...rd, adGroupId: 'G2' }));
    });

    it('ads search term: case and spacing do not make a new task', () => {
        expect(id('Blue Mug', 'sponsoredAds', 'search_term_zero_sales', { searchTerm: 'Blue Mug' }))
            .toBe(id('blue  mug', 'sponsoredAds', 'search_term_zero_sales', { searchTerm: 'blue  mug ' }));
    });

    it('removal shortfall: keyed by SKU whether or not the catalogue still has the ASIN', () => {
        expect(id('B01', 'inventory', 'removal_shortfall', { sku: 'S1' })).toBe(id('SKU:S1', 'inventory', 'removal_shortfall', { sku: 'S1' }));
    });

    it('every other type keeps exactly its old identity (asin + category + type)', () => {
        expect(id('B01', 'conversion', 'missing_aplus_content')).toBe(['B01', 'conversion', 'missing_aplus_content'].join(T.SEP));
        expect(id('CAMPAIGN:9', 'sponsoredAds', 'budget_limited_profitable')).toBe(['CAMPAIGN:9', 'sponsoredAds', 'budget_limited_profitable'].join(T.SEP));
    });
});

describe('listing issue groups', () => {
    it('follow Amazon\'s code (and attributes), not the wording', () => {
        const a = T.listingIssueGroupKey({ code: '90220', attributeNames: ['brand'], message: 'Brand is required' });
        const b = T.listingIssueGroupKey({ code: '90220', attributeNames: ['brand'], message: 'The brand field is missing.' });
        expect(a).toBe(b);
        expect(T.listingIssueGroupKey({ code: '90220', attributeNames: ['color'], message: 'x' })).not.toBe(a);
    });

    it('without a code, numbers and ASINs in the message do not matter', () => {
        expect(T.listingIssueGroupKey({ message: 'Image for B0ABCDEFGH is 500px, needs 1000px' }))
            .toBe(T.listingIssueGroupKey({ message: 'image for B0ZZZZZZZZ is 640px, needs 1000px' }));
        expect(T.listingIssueGroupKey({ message: 'Missing attributes value' })).toContain('attributes');
    });
});

describe('severityRank and collapseByIdentity', () => {
    it('ranks the worse state higher', () => {
        const r = (errorCategory, errorType) => T.severityRank({ errorCategory, errorType });
        expect(r('inventory', 'out_of_stock')).toBeGreaterThan(r('inventory', 'replenishment_needed'));
        expect(r('account', 'accountStatus')).toBeGreaterThan(r('account', 'accountStatus_unstable'));
        expect(r('profitability', 'negative_profit')).toBeGreaterThan(r('profitability', 'ad_spend_no_sales'));
        expect(r('profitability', 'ad_spend_no_sales')).toBeGreaterThan(r('profitability', 'low_margin'));
    });

    it('keeps one task per identity: the worst state, then the bigger amount', () => {
        const out = T.collapseByIdentity([
            { asin: 'B01', errorCategory: 'inventory', errorType: 'replenishment_needed', amount: 0 },
            { asin: 'X', errorCategory: 'sponsoredAds', errorType: 'search_term_zero_sales', renderData: { searchTerm: 'mug', adGroupId: 'G1' }, amount: 3 },
            { asin: 'B01', errorCategory: 'inventory', errorType: 'out_of_stock', amount: 50 },
            { asin: 'X', errorCategory: 'sponsoredAds', errorType: 'search_term_zero_sales', renderData: { searchTerm: 'Mug', adGroupId: 'G2' }, amount: 9 },
        ]);
        expect(out.map((t) => t.errorType)).toEqual(['out_of_stock', 'search_term_zero_sales']);
        expect(out[1].renderData.adGroupId).toBe('G2');
        expect(out.every((t) => typeof t.identityKey === 'string')).toBe(true);
    });
});

describe('the planner keeps one row per problem', () => {
    const NOW = new Date('2026-10-28T12:00:00Z');
    const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);
    const scope = { userId: 'u1', country: 'US', region: 'NA' };
    const coverage = { account: true, inventory: true, 'kpi.outOfStock': true, ranking: true, profitability: true };
    const stored = (over) => ({ _id: 'row1', taskId: 'task_old', productName: 'Account Health', amount: 0, status: 'completed', completedAt: daysAgo(2), lastSeenAt: daysAgo(1), createdAt: daysAgo(30), ...over });
    const wanted = (over) => ({ taskId: 'task_new', productName: 'Account Health', amount: 0, status: 'pending', ...over });
    const plan = (existing, desired) => planReconcile({ existing, desired, coverage, scope, now: NOW });

    it('a label change updates the same row: status kept, type and text refreshed, nothing inserted or resolved', () => {
        const { ops, summary } = plan(
            // Completed 6 hours ago: inside even the 1-day account cooldown.
            [stored({ asin: 'ACCOUNT', errorCategory: 'account', errorType: 'orderWithDefectsStatus', error: 'ODR high', status: 'completed', completedAt: daysAgo(0.25) })],
            [wanted({ asin: 'ACCOUNT', errorCategory: 'account', errorType: 'orderWithDefectsStatus_unstable', error: 'ODR (unstable)' })]
        );
        expect(summary.inserted).toBe(0);
        expect(summary.resolved).toBe(0);
        expect(ops).toHaveLength(1);
        const { filter, update } = ops[0].updateOne;
        expect(filter).toEqual({ _id: 'row1', status: 'completed' });
        expect(update.$set).toMatchObject({ errorType: 'orderWithDefectsStatus_unstable', error: 'ODR (unstable)' });
        expect(update.$set.status).toBeUndefined(); // got better: stays completed
        expect(update.$set.taskId).toBeUndefined(); // the id never changes
    });

    it('a completed task whose problem got worse reopens now, not after the cooldown', () => {
        const { ops, summary } = plan(
            [stored({ productName: 'Mug', asin: 'B01', errorCategory: 'inventory', errorType: 'replenishment_needed', completedAt: daysAgo(1) })],
            [wanted({ productName: 'Mug', asin: 'B01', errorCategory: 'inventory', errorType: 'out_of_stock', amount: 120 })]
        );
        expect(summary.escalated).toBe(1);
        expect(ops[0].updateOne.update.$set).toMatchObject({ status: 'pending', errorType: 'out_of_stock', stillDetected: true, reopenReason: 'escalated' });
        expect(ops[0].updateOne.update.$inc).toEqual({ reopenCount: 1 });
    });

    it('the cooldown comes from the problem\'s current state', () => {
        // negative_profit's cooldown is 30 days; low_margin's (unlisted) is the 7-day default.
        // Completed 10 days ago and now a thin margin: past low_margin's cooldown, so reopened.
        const { summary } = plan(
            [stored({ productName: 'Mug', asin: 'B01', errorCategory: 'profitability', errorType: 'negative_profit', completedAt: daysAgo(10) })],
            [wanted({ productName: 'Mug', asin: 'B01', errorCategory: 'profitability', errorType: 'low_margin' })]
        );
        expect(summary.stillDetected).toBe(1);
    });

    it('old rows sharing an identity: the one with the seller\'s decision is kept, the other resolves', () => {
        const done = stored({ _id: 'done', productName: 'Mug', asin: 'B01', errorCategory: 'ranking', errorType: 'titleresult_char_limit', status: 'completed', completedAt: daysAgo(1) });
        const open = stored({ _id: 'open', productName: 'Mug', asin: 'B01', errorCategory: 'ranking', errorType: 'titleresult_too_short', status: 'pending', completedAt: undefined });
        const { ops } = plan([open, done], [wanted({ productName: 'Mug', asin: 'B01', errorCategory: 'ranking', errorType: 'titleresult_too_short' })]);
        const byId = Object.fromEntries(ops.map((o) => [o.updateOne?.filter._id || o.deleteOne?.filter._id, o]));
        expect(byId.open.updateOne.update.$set.status).toBe('resolved');
        expect(byId.done.updateOne.update.$set.errorType).toBe('titleresult_too_short');
        expect(byId.done.updateOne.update.$set.status).toBeUndefined();
    });

    it('inserts carry their identity', () => {
        const { ops } = plan([], [wanted({ asin: 'ACCOUNT', errorCategory: 'account', errorType: 'accountStatus' })]);
        expect(ops[0].insertOne.document.identityKey).toBe(id('ACCOUNT', 'account', 'accountStatus'));
    });
});

describe('work the ESF team closed gets time to show on Amazon', () => {
    const NOW = new Date('2026-10-28T12:00:00Z');
    const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);
    const plan = (have, want) => planReconcile({ existing: [have], desired: [want], coverage: { account: true }, scope: { userId: 'u1', country: 'US', region: 'NA' }, now: NOW });
    const odr = { asin: 'ACCOUNT', errorCategory: 'account', errorType: 'orderWithDefectsStatus', productName: 'Account Health', amount: 0 };

    it('an account metric the team fixed stays done for 30 days, not 1', () => {
        const have = { _id: 'r1', ...odr, status: 'completed', completedBy: 'esf_team', completedAt: daysAgo(5), lastSeenAt: daysAgo(1) };
        expect(plan(have, { ...odr, taskId: 't' }).summary.stillDetected).toBe(0);
        const later = plan({ ...have, completedAt: daysAgo(31) }, { ...odr, taskId: 't' });
        expect(later.summary.stillDetected).toBe(1);
        expect(later.ops[0].updateOne.update.$unset).toMatchObject({ completedBy: '' });
    });

    it('the seller\'s own ticks keep the check\'s own waiting period', () => {
        const have = { _id: 'r1', ...odr, status: 'completed', completedAt: daysAgo(5), lastSeenAt: daysAgo(1) };
        expect(plan(have, { ...odr, taskId: 't' }).summary.stillDetected).toBe(1);
    });

    it('a longer check keeps its own longer wait (90 days for A+ content)', () => {
        const aplus = { asin: 'B01', errorCategory: 'conversion', errorType: 'missing_aplus_content', productName: 'Mug', amount: 0 };
        const have = { _id: 'r2', ...aplus, status: 'completed', completedBy: 'esf_team', completedAt: daysAgo(60), lastSeenAt: daysAgo(1) };
        expect(planReconcile({ existing: [have], desired: [{ ...aplus, taskId: 't' }], coverage: { conversion: true, 'conversion.aplus': true }, scope: { userId: 'u1', country: 'US', region: 'NA' }, now: NOW }).summary.stillDetected).toBe(0);
    });
});

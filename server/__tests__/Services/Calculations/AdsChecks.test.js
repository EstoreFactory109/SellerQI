/**
 * The keyword / search-term ad task rules (AdsSignals) and how
 * calculateSponsoredAdsErrors applies them.
 *
 * Production before: 4,584 wasted-keyword tasks ($24,315) — 3,123 with 2 clicks or
 * fewer, 1,547 under $1, 761 with all spend inside the attribution window, 498 on
 * keywords no longer ENABLED. Zero-sale search terms stayed flagged after the seller
 * added them as negatives.
 */
const {
    settleCutoffDay,
    isAdsDataStale,
    isWastedKeyword,
    buildNegatedIndex,
    isNegated,
    isAsinSearchTerm,
    newestRowDay,
} = require('../../../Services/Calculations/AdsSignals.js');
const { calculateSponsoredAdsErrors } = require('../../../Services/Calculations/DashboardCalculation.js');
const CreateTaskService = require('../../../Services/Calculations/CreateTasksService.js');

const NOW = new Date('2026-10-16T12:00:00Z'); // US marketplace yesterday: 2026-10-15
const OPTS = { country: 'US', now: NOW };

describe('AdsSignals', () => {
    it('settles spend older than the 7-day attribution window, anchored on the marketplace\'s yesterday', () => {
        // yesterday 2026-10-15 → the last 7 days are 10-09..10-15; earlier is settled.
        expect(settleCutoffDay('US', NOW)).toBe('2026-10-09');
    });

    it('calls ads data stale when its newest day is more than 7 days old, or undated', () => {
        expect(isAdsDataStale('2026-10-14', 'US', NOW)).toBe(false);
        expect(isAdsDataStale('2026-10-08', 'US', NOW)).toBe(false);
        expect(isAdsDataStale('2026-10-07', 'US', NOW)).toBe(true);
        expect(isAdsDataStale(null, 'US', NOW)).toBe(true);
    });

    it('finds the newest dated row', () => {
        expect(newestRowDay([{ date: '2026-10-02' }, { date: '2026-10-11' }, {}])).toBe('2026-10-11');
        expect(newestRowDay([{}])).toBeNull();
    });

    describe('isWastedKeyword', () => {
        const base = { clicks: 10, sales: 0, settledSpend: 3, status: 'ENABLED' };
        it('needs 10+ clicks', () => {
            expect(isWastedKeyword(base)).toBe(true);
            expect(isWastedKeyword({ ...base, clicks: 9 })).toBe(false);
        });
        it('needs the keyword to still be ENABLED', () => {
            expect(isWastedKeyword({ ...base, status: 'PAUSED' })).toBe(false);
            expect(isWastedKeyword({ ...base, status: null })).toBe(false);
        });
        it('needs some settled spend (not all inside the attribution window)', () => {
            expect(isWastedKeyword({ ...base, settledSpend: 0 })).toBe(false);
        });
        it('needs no sales', () => {
            expect(isWastedKeyword({ ...base, sales: 0.5 })).toBe(false);
        });
    });

    describe('negatives', () => {
        const index = buildNegatedIndex([
            { campaignId: 'c1', adGroupId: 'ag1', keywordText: 'Cheap Widget', state: 'enabled' },
            { campaignId: 'c2', adGroupId: '', keywordText: 'free widget' },
            { campaignId: 'c3', adGroupId: 'ag3', keywordText: 'paused one', state: 'paused' },
        ]);
        it('matches ad-group negatives case-insensitively', () => {
            expect(isNegated(index, { searchTerm: 'cheap widget', campaignId: 'c1', adGroupId: 'ag1' })).toBe(true);
            expect(isNegated(index, { searchTerm: 'cheap widget', campaignId: 'c1', adGroupId: 'other' })).toBe(false);
        });
        it('matches campaign-level negatives for any ad group', () => {
            expect(isNegated(index, { searchTerm: 'free widget', campaignId: 'c2', adGroupId: 'anything' })).toBe(true);
        });
        it('ignores negatives that are not enabled, and other campaigns', () => {
            expect(isNegated(index, { searchTerm: 'paused one', campaignId: 'c3', adGroupId: 'ag3' })).toBe(false);
            expect(isNegated(index, { searchTerm: 'cheap widget', campaignId: 'c9', adGroupId: 'ag1' })).toBe(false);
        });
    });

    it('recognises ASIN search terms', () => {
        expect(isAsinSearchTerm('b07fmhwfwt')).toBe(true);
        expect(isAsinSearchTerm('B07FMHWFWT')).toBe(true);
        expect(isAsinSearchTerm('blue widget')).toBe(false);
    });
});

// A converting keyword dated yesterday keeps the account's ads data current.
const CURRENT_KEYWORD = {
    date: '2026-10-15', adKeywordStatus: 'ENABLED', keyword: 'converting', campaignId: 'c9', adGroupId: 'ag9',
    cost: 5, attributedSales30d: 40, clicks: 12,
};
const kw = (over = {}) => ({
    date: '2026-10-01', adKeywordStatus: 'ENABLED', keyword: 'blue widget', campaignId: 'c1', adGroupId: 'ag1',
    cost: 20, attributedSales30d: 0, clicks: 15, ...over,
});
const term = (over = {}) => ({
    date: '2026-10-01', searchTerm: 'cheap widget', keyword: 'blue widget', campaignId: 'c1', adGroupId: 'ag1',
    clicks: 15, spend: 8, sales: 0, ...over,
});
const CURRENT_TERM = { date: '2026-10-15', searchTerm: 'converting', campaignId: 'c9', adGroupId: 'ag9', clicks: 3, spend: 1, sales: 30 };

const run = (keywords = [], terms = [], extra = {}) =>
    calculateSponsoredAdsErrors([], [...keywords, CURRENT_KEYWORD], [...terms, CURRENT_TERM], [], [], { ...OPTS, ...extra }).errorDetails;
const ofType = (details, t) => details.filter(d => d.errorType === t);

describe('calculateSponsoredAdsErrors', () => {
    it('flags a settled, enabled, 10+-click keyword with no sales', () => {
        expect(ofType(run([kw()]), 'wasted_spend_keyword')).toHaveLength(1);
    });

    it('does not flag a keyword whose spend is all inside the attribution window', () => {
        expect(ofType(run([kw({ date: '2026-10-13' })]), 'wasted_spend_keyword')).toHaveLength(0);
    });

    it('uses the keyword\'s latest status: paused today means not flagged', () => {
        const rows = [kw({ date: '2026-10-01' }), kw({ date: '2026-10-14', cost: 1, clicks: 1, adKeywordStatus: 'PAUSED' })];
        expect(ofType(run(rows), 'wasted_spend_keyword')).toHaveLength(0);
    });

    it('makes no keyword or search-term verdicts on stale ads data', () => {
        const details = calculateSponsoredAdsErrors([], [kw()], [term()], [], [], OPTS).errorDetails;
        expect(ofType(details, 'wasted_spend_keyword')).toHaveLength(0);
        expect(ofType(details, 'search_term_zero_sales')).toHaveLength(0);
    });

    // tasks-logics.xlsx: 15+ clicks, 0 orders, spend over the product price.
    it('needs 15+ clicks and spend over the reference price', () => {
        expect(ofType(run([], [term({ clicks: 14 })]), 'search_term_zero_sales')).toHaveLength(0);
        expect(ofType(run([], [term()], { referencePrice: 7.99 }), 'search_term_zero_sales')).toHaveLength(1);
        expect(ofType(run([], [term()], { referencePrice: 20 }), 'search_term_zero_sales')).toHaveLength(0);
    });

    it('drops a zero-sale search term the seller already added as a negative', () => {
        const negs = [{ campaignId: 'c1', adGroupId: 'ag1', keywordText: 'cheap widget', state: 'enabled' }];
        expect(ofType(run([], [term()]), 'search_term_zero_sales')).toHaveLength(1);
        expect(ofType(run([], [term()], { negativeKeywords: negs }), 'search_term_zero_sales')).toHaveLength(0);
    });

    it('does not count a term\'s spend twice when its keyword is itself wasted', () => {
        const details = run([kw()], [term()]);
        expect(ofType(details, 'wasted_spend_keyword')[0].amount).toBe(20);
        expect(ofType(details, 'search_term_zero_sales')[0].amount).toBe(0);
    });

    it('keeps the term\'s amount when its keyword is not flagged', () => {
        const details = run([kw({ attributedSales30d: 50 })], [term()]);
        expect(ofType(details, 'search_term_zero_sales')[0].amount).toBe(8);
    });

    it('treats a term as migrated only when a manual campaign has it as EXACT', () => {
        const campaigns = [{ campaignId: 'auto1', targetingType: 'auto' }, { campaignId: 'man1', targetingType: 'manual' }];
        const winning = { date: '2026-10-01', searchTerm: 'great widget', campaignId: 'auto1', adGroupId: 'a', clicks: 30, spend: 10, sales: 90 };
        const migrate = (keywords) => ofType(calculateSponsoredAdsErrors([], [CURRENT_KEYWORD], [winning, CURRENT_TERM], campaigns, keywords, OPTS).errorDetails, 'auto_campaign_migration_needed');
        expect(migrate([{ campaignId: 'man1', keywordText: 'great widget', matchType: 'BROAD' }])).toHaveLength(1);
        expect(migrate([{ campaignId: 'man1', keywordText: 'great widget', matchType: 'EXACT' }])).toHaveLength(0);
    });
});

describe('ASIN search-term wording', () => {
    it('advises a negative product target for an ASIN term with zero sales', () => {
        const { error, solution } = CreateTaskService.renderSponsoredAdsTaskText('search_term_zero_sales', { searchTerm: 'b07fmhwfwt', clicks: 12, spend: 8 });
        expect(error).toContain('Product Target with Zero Sales');
        expect(solution).toContain('negative product target');
        expect(solution).not.toMatch(/negative keyword/);
    });

    it('advises targeting the ASIN directly for an auto-campaign winner', () => {
        const { solution } = CreateTaskService.renderSponsoredAdsTaskText('auto_campaign_migration_needed', { searchTerm: 'B07FMHWFWT', sales: 90, campaignName: 'Auto' });
        expect(solution).toContain('product (ASIN) target');
    });

    it('keeps keyword advice for ordinary terms', () => {
        const { solution } = CreateTaskService.renderSponsoredAdsTaskText('search_term_zero_sales', { searchTerm: 'cheap widget', clicks: 12, spend: 8 });
        expect(solution).toContain('negative keyword');
    });
});

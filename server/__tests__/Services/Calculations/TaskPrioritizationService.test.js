/**
 * Tests for TaskPrioritizationService — the effort/impact domain tables that
 * decide which tasks are "quick wins" and how no-money tasks are ranked.
 */

const {
    normalizeErrorType,
    getTaskPriorityMeta,
    annotateTasks,
    EFFORT_MINUTES,
    IMPACT_WEIGHT,
    QUICK_WIN_MAX_MINUTES,
    DEFAULT_EFFORT_MINUTES,
    DEFAULT_IMPACT_WEIGHT
} = require('../../../Services/Calculations/TaskPrioritizationService.js');

/**
 * Every (category, errorType) pair the generators in CreateTasksService can
 * produce, PLUS the retired types still sitting in stored documents. If a new
 * errorType is added without a mapping, this list is what makes the coverage
 * test below fail instead of the task silently inheriting the defaults.
 */
const RANKING_SECTIONS = ['titleresult', 'bulletpoints', 'description'];
const RANKING_CHECKS = ['restricted_words', 'special_characters', 'char_limit', 'word_repetition', 'capitalization'];

const ALL_TASK_TYPES = [
    ...RANKING_SECTIONS.flatMap(s => RANKING_CHECKS.map(c => ['ranking', `${s}_${c}`])),
    ['ranking', 'backend_keywords_char_limit'],
    ['ranking', 'duplicate_words'],

    ['conversion', 'missing_aplus_content'],
    ['conversion', 'missing_brand_story'],
    ['conversion', 'insufficient_images'],
    ['conversion', 'missing_video'],
    ['conversion', 'low_star_rating'],
    ['conversion', 'no_buybox'],
    ['conversion', 'insufficient_reviews'], // retired generator, 2,186 stored docs

    ['inventory', 'long_term_storage_fees'],
    ['inventory', 'unfulfillable_inventory'],
    ['inventory', 'stranded_inventory'],
    ['inventory', 'inbound_non_compliance'],
    ['inventory', 'replenishment_needed'],

    ['profitability', 'negative_profit'],
    ['profitability', 'low_margin'],
    ['profitability', 'profitability_issue'],

    ['sponsoredAds', 'high_acos'],
    ['sponsoredAds', 'wasted_spend_keyword'],
    ['sponsoredAds', 'search_term_zero_sales'],
    ['sponsoredAds', 'auto_campaign_migration_needed'],
    ['sponsoredAds', 'ppc_optimization'],
    ['sponsoredAds', 'no_sales_high_spend'],   // retired
    ['sponsoredAds', 'marginal_profit'],       // retired
    ['sponsoredAds', 'keyword_no_sales'],      // retired
    ['sponsoredAds', 'extreme_high_acos'],     // retired
    ['sponsoredAds', 'low_ctr'],               // retired

    ['account', 'accountStatus'],
    ['account', 'PolicyViolations'],
    ['account', 'validTrackingRateStatus'],
    ['account', 'orderWithDefectsStatus'],
    ['account', 'lateShipmentRateStatus'],
    ['account', 'CancellationRate'],
    ['account', 'negativeFeedbacks'],
    ['account', 'NCX'],
    ['account', 'a_z_claims'],
    ['account', 'responseUnder24HoursCount']
];

describe('normalizeErrorType', () => {
    it('collapses the SKU-suffixed replenishment type', () => {
        expect(normalizeErrorType('replenishment_needed_CitSml-FBA')).toBe('replenishment_needed');
        expect(normalizeErrorType('replenishment_needed_ABC-123-XYZ')).toBe('replenishment_needed');
        expect(normalizeErrorType('replenishment_needed')).toBe('replenishment_needed');
    });

    it('leaves every other type untouched', () => {
        expect(normalizeErrorType('wasted_spend_keyword')).toBe('wasted_spend_keyword');
        expect(normalizeErrorType('titleresult_char_limit')).toBe('titleresult_char_limit');
    });

    it('handles missing or non-string input', () => {
        expect(normalizeErrorType(undefined)).toBe('');
        expect(normalizeErrorType(null)).toBe('');
        expect(normalizeErrorType(42)).toBe('');
    });
});

describe('effort/impact table coverage', () => {
    it.each(ALL_TASK_TYPES)('has an explicit effort + impact entry for %s:%s', (category, errorType) => {
        const meta = getTaskPriorityMeta({ errorCategory: category, errorType });
        expect(meta.isKnownTaskType).toBe(true);
        expect(EFFORT_MINUTES[`${category}:${errorType}`]).toBeGreaterThan(0);
        expect(IMPACT_WEIGHT[`${category}:${errorType}`]).toBeGreaterThan(0);
    });

    it('has no table entry that the task types above do not cover (no dead rows)', () => {
        const known = new Set(ALL_TASK_TYPES.map(([c, t]) => `${c}:${t}`));
        expect(Object.keys(EFFORT_MINUTES).filter(k => !known.has(k))).toEqual([]);
        expect(Object.keys(IMPACT_WEIGHT).filter(k => !known.has(k))).toEqual([]);
    });

    it('keeps every impact weight within 0-100', () => {
        Object.values(IMPACT_WEIGHT).forEach(w => {
            expect(w).toBeGreaterThan(0);
            expect(w).toBeLessThanOrEqual(100);
        });
    });
});

describe('getTaskPriorityMeta', () => {
    it('marks a keyword pause as a quick win', () => {
        const meta = getTaskPriorityMeta({ errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword' });
        expect(meta.effortMinutes).toBe(2);
        expect(meta.isQuickWin).toBe(true);
    });

    it('does not mark content production as a quick win', () => {
        expect(getTaskPriorityMeta({ errorCategory: 'conversion', errorType: 'missing_video' }).isQuickWin).toBe(false);
        expect(getTaskPriorityMeta({ errorCategory: 'conversion', errorType: 'missing_aplus_content' }).isQuickWin).toBe(false);
        expect(getTaskPriorityMeta({ errorCategory: 'inventory', errorType: 'replenishment_needed' }).isQuickWin).toBe(false);
    });

    it('resolves a SKU-suffixed replenishment task through the prefix', () => {
        const meta = getTaskPriorityMeta({ errorCategory: 'inventory', errorType: 'replenishment_needed_CitSml-FBA' });
        expect(meta.isKnownTaskType).toBe(true);
        expect(meta.effortMinutes).toBe(30);
        expect(meta.isQuickWin).toBe(false);
    });

    it('ranks an account suspension above everything else', () => {
        const suspension = getTaskPriorityMeta({ errorCategory: 'account', errorType: 'accountStatus' });
        const others = Object.entries(IMPACT_WEIGHT).filter(([k]) => k !== 'account:accountStatus');
        expect(suspension.impactWeight).toBe(100);
        others.forEach(([, w]) => expect(w).toBeLessThan(100));
    });

    it('never ranks the growth-only ads opportunity above money being lost', () => {
        const growth = IMPACT_WEIGHT['sponsoredAds:auto_campaign_migration_needed'];
        expect(growth).toBeLessThan(IMPACT_WEIGHT['sponsoredAds:wasted_spend_keyword']);
        expect(growth).toBeLessThan(IMPACT_WEIGHT['profitability:negative_profit']);
    });

    it('ranks title issues above bullet issues, and bullets above description', () => {
        expect(IMPACT_WEIGHT['ranking:titleresult_char_limit'])
            .toBeGreaterThan(IMPACT_WEIGHT['ranking:bulletpoints_char_limit']);
        expect(IMPACT_WEIGHT['ranking:bulletpoints_char_limit'])
            .toBeGreaterThan(IMPACT_WEIGHT['ranking:description_char_limit']);
    });

    describe('unknown task types fail safe', () => {
        const unknown = { errorCategory: 'conversion', errorType: 'some_future_check' };

        it('falls back to the defaults and flags itself as unmapped', () => {
            const meta = getTaskPriorityMeta(unknown);
            expect(meta.effortMinutes).toBe(DEFAULT_EFFORT_MINUTES);
            expect(meta.impactWeight).toBe(DEFAULT_IMPACT_WEIGHT);
            expect(meta.isKnownTaskType).toBe(false);
        });

        it('is NOT presented as a quick win — an unmapped fix must never be promised as under 5 minutes', () => {
            expect(DEFAULT_EFFORT_MINUTES).toBeGreaterThan(QUICK_WIN_MAX_MINUTES);
            expect(getTaskPriorityMeta(unknown).isQuickWin).toBe(false);
        });

        it('handles a task with no category or type at all without throwing', () => {
            expect(getTaskPriorityMeta({}).isQuickWin).toBe(false);
            expect(getTaskPriorityMeta(undefined).isQuickWin).toBe(false);
        });
    });
});

describe('annotateTasks', () => {
    it('adds metadata without mutating or dropping the task\'s own fields', () => {
        const input = [{ taskId: 't1', errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword', amount: 42, error: 'text' }];
        const [out] = annotateTasks(input);

        expect(out).toMatchObject({ taskId: 't1', amount: 42, error: 'text' });
        expect(out.effortMinutes).toBe(2);
        expect(out.isQuickWin).toBe(true);
        expect(input[0].effortMinutes).toBeUndefined(); // original untouched
    });

    it('returns an empty array for non-array input', () => {
        expect(annotateTasks(null)).toEqual([]);
        expect(annotateTasks(undefined)).toEqual([]);
    });
});

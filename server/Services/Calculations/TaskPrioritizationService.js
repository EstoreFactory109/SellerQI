/**
 * TaskPrioritizationService
 *
 * Owns the two pieces of domain knowledge needed to sort a seller's tasks into
 * "do this first" and "this takes two minutes":
 *
 *   EFFORT_MINUTES - how long the fix realistically takes in Seller Central
 *   IMPACT_WEIGHT  - how much this CLASS of problem typically hurts a seller,
 *                    used to order tasks that carry no dollar figure
 *
 * Why a weight is needed at all: only profitability, sponsored-ads, Buy-Box and
 * some inventory tasks ever carry a recoverable `amount`. Ranking tasks, most
 * conversion checks and every account-health task have no dollar value by
 * nature, and stored tasks written before the amount feature shipped have
 * `amount: 0` across the board. A money-only ranking would leave the whole
 * "high impact" list empty, so impact has to degrade to a weight rather than to
 * nothing.
 *
 * This module is deliberately LLM-free, network-free and DB-free — same
 * discipline as OpportunityRankingService.js — so it stays deterministic and
 * unit-testable. The SELECTION of which tasks fill each bucket lives in the
 * client (client/src/utils/taskBuckets.js), because it depends on the active
 * category filter and on which tasks the seller has ticked off.
 */

// A fix at or under this many minutes is a "quick win".
const QUICK_WIN_MAX_MINUTES = 5;

/**
 * Applied to any (category, errorType) pair that has no entry below.
 *
 * The effort default sits deliberately ABOVE QUICK_WIN_MAX_MINUTES: an
 * unrecognised task must never be advertised to a seller as "under 5 minutes".
 * Failing safe matters because errorType is not a closed set — e.g. 2,186
 * stored `insufficient_reviews` tasks exist whose generator no longer runs.
 */
const DEFAULT_EFFORT_MINUTES = 15;
const DEFAULT_IMPACT_WEIGHT = 30;

/**
 * errorTypes that carry a per-record suffix and must be collapsed before
 * lookup. `replenishment_needed_<SKU>` embeds the SKU, which is why production
 * holds ~3,088 distinct errorType strings that reduce to 39 real types.
 */
const PREFIXED_ERROR_TYPES = ['replenishment_needed'];

/**
 * Collapse a stored errorType to its canonical form.
 * @param {string} errorType
 * @returns {string}
 */
function normalizeErrorType(errorType) {
    if (!errorType || typeof errorType !== 'string') return '';
    for (const prefix of PREFIXED_ERROR_TYPES) {
        if (errorType.startsWith(prefix)) return prefix;
    }
    return errorType;
}

/** Lookup key. Category is part of the key because errorTypes are only unique within a category. */
const key = (category, errorType) => `${category}:${normalizeErrorType(errorType)}`;

/**
 * Minutes of hands-on work in Seller Central. Values at or under
 * QUICK_WIN_MAX_MINUTES are what put a task in the Quick wins bucket, so those
 * are the ones worth scrutinising.
 */
const EFFORT_MINUTES = {
    // ── Ranking: listing-copy edits. Title and backend keywords are single
    //    short fields; bullets are five fields; descriptions are long-form.
    'ranking:titleresult_special_characters': 3,
    'ranking:titleresult_capitalization': 3,
    'ranking:backend_keywords_char_limit': 3,
    'ranking:titleresult_char_limit': 5,
    'ranking:titleresult_restricted_words': 5,
    'ranking:titleresult_word_repetition': 5,
    'ranking:duplicate_words': 5,
    'ranking:bulletpoints_special_characters': 5,
    'ranking:bulletpoints_capitalization': 10,
    'ranking:bulletpoints_char_limit': 10,
    'ranking:bulletpoints_restricted_words': 10,
    'ranking:bulletpoints_word_repetition': 10,
    'ranking:description_special_characters': 10,
    'ranking:description_capitalization': 10,
    'ranking:description_char_limit': 10,
    'ranking:description_restricted_words': 10,
    'ranking:description_word_repetition': 10,

    // ── Conversion: content production, not edits. Nothing here is quick.
    'conversion:no_buybox': 15,          // check price/repricer/seller metrics
    'conversion:low_star_rating': 60,    // no single action; needs a plan
    'conversion:insufficient_reviews': 60,
    'conversion:insufficient_images': 120,
    'conversion:missing_video': 240,
    'conversion:missing_aplus_content': 240,

    // ── Inventory: Seller Central workflows (removal orders, shipments).
    'inventory:stranded_inventory': 10,  // usually one listing field to fix
    'inventory:long_term_storage_fees': 15,
    'inventory:unfulfillable_inventory': 15,
    'inventory:inbound_non_compliance': 20,
    'inventory:replenishment_needed': 30,

    // ── Profitability: needs a pricing/cost decision, never a one-click fix.
    'profitability:negative_profit': 15,
    'profitability:low_margin': 15,
    'profitability:profitability_issue': 15,

    // ── Sponsored Ads: the richest source of genuine quick wins — pausing a
    //    keyword or adding a negative is a couple of clicks.
    'sponsoredAds:wasted_spend_keyword': 2,
    'sponsoredAds:search_term_zero_sales': 2,
    'sponsoredAds:no_sales_high_spend': 2,
    'sponsoredAds:keyword_no_sales': 2,
    'sponsoredAds:high_acos': 5,
    'sponsoredAds:extreme_high_acos': 5,
    'sponsoredAds:marginal_profit': 5,
    'sponsoredAds:ppc_optimization': 5,
    'sponsoredAds:low_ctr': 10,          // needs image/title work, not a bid change
    'sponsoredAds:auto_campaign_migration_needed': 15,

    // ── Account health: mostly remediation plans; two are genuinely quick.
    'account:negativeFeedbacks': 5,
    'account:responseUnder24HoursCount': 5,
    'account:validTrackingRateStatus': 10,
    'account:a_z_claims': 15,
    'account:lateShipmentRateStatus': 20,
    'account:CancellationRate': 20,
    'account:PolicyViolations': 30,
    'account:orderWithDefectsStatus': 30,
    'account:NCX': 30,
    'account:accountStatus': 60
};

/**
 * 0-100 severity of the problem class, used ONLY to order tasks that have no
 * recoverable dollar amount. A real `amount` always outranks a weight — see
 * compareByImpact in the client selector.
 *
 * Ordering rationale: threats to the account itself first, then money already
 * being lost, then lost sales opportunity, then discoverability polish.
 */
const IMPACT_WEIGHT = {
    // Account-level: a suspension stops all revenue, so it outranks everything.
    'account:accountStatus': 100,
    'account:PolicyViolations': 90,
    'account:a_z_claims': 75,
    'account:orderWithDefectsStatus': 75,
    'account:lateShipmentRateStatus': 68,
    'account:CancellationRate': 68,
    'account:NCX': 55,
    'account:negativeFeedbacks': 50,
    'account:validTrackingRateStatus': 30,
    'account:responseUnder24HoursCount': 28,

    // Money leaving the account right now.
    'profitability:negative_profit': 85,
    'sponsoredAds:wasted_spend_keyword': 65,
    'sponsoredAds:search_term_zero_sales': 65,
    'sponsoredAds:no_sales_high_spend': 65,
    'sponsoredAds:keyword_no_sales': 65,
    'sponsoredAds:extreme_high_acos': 64,
    'sponsoredAds:high_acos': 58,
    'profitability:low_margin': 45,
    'profitability:profitability_issue': 45,
    'sponsoredAds:marginal_profit': 38,
    // Generic fallback for an ads issue we couldn't classify — real but undiagnosed.
    'sponsoredAds:ppc_optimization': 35,
    'sponsoredAds:low_ctr': 32,
    // Growth rather than loss — must not outrank money being lost.
    'sponsoredAds:auto_campaign_migration_needed': 32,

    // Sales the seller cannot make at all.
    'conversion:no_buybox': 80,
    'inventory:stranded_inventory': 70,
    'inventory:long_term_storage_fees': 60,
    'inventory:unfulfillable_inventory': 60,
    'inventory:replenishment_needed': 52,
    'inventory:inbound_non_compliance': 34,

    // Conversion drag.
    'conversion:insufficient_images': 55,
    'conversion:low_star_rating': 42,
    'conversion:missing_video': 40,
    'conversion:insufficient_reviews': 38,
    'conversion:missing_aplus_content': 36,

    // Discoverability. Title carries far more search weight than bullets, and
    // bullets more than the description.
    'ranking:titleresult_char_limit': 50,
    'ranking:titleresult_restricted_words': 50,
    'ranking:titleresult_word_repetition': 50,
    'ranking:titleresult_special_characters': 50,
    'ranking:titleresult_capitalization': 50,
    'ranking:duplicate_words': 45,
    'ranking:backend_keywords_char_limit': 36,
    'ranking:bulletpoints_char_limit': 35,
    'ranking:bulletpoints_restricted_words': 35,
    'ranking:bulletpoints_special_characters': 35,
    'ranking:bulletpoints_word_repetition': 35,
    'ranking:bulletpoints_capitalization': 35,
    'ranking:description_char_limit': 20,
    'ranking:description_restricted_words': 20,
    'ranking:description_special_characters': 20,
    'ranking:description_word_repetition': 20,
    'ranking:description_capitalization': 20
};

/**
 * Effort + impact for one task.
 *
 * @param {Object} task - needs `errorCategory` and `errorType`
 * @returns {{effortMinutes: number, impactWeight: number, isQuickWin: boolean, isKnownTaskType: boolean}}
 */
function getTaskPriorityMeta(task) {
    const lookup = key(task?.errorCategory, task?.errorType);
    const mappedEffort = EFFORT_MINUTES[lookup];
    const mappedWeight = IMPACT_WEIGHT[lookup];

    const effortMinutes = mappedEffort === undefined ? DEFAULT_EFFORT_MINUTES : mappedEffort;

    return {
        effortMinutes,
        impactWeight: mappedWeight === undefined ? DEFAULT_IMPACT_WEIGHT : mappedWeight,
        isQuickWin: effortMinutes <= QUICK_WIN_MAX_MINUTES,
        // Lets callers spot task types that slipped through without a mapping,
        // rather than silently inheriting the defaults.
        isKnownTaskType: mappedEffort !== undefined
    };
}

/**
 * Attach priority metadata to each task without mutating the input.
 * @param {Array} tasks
 * @returns {Array}
 */
function annotateTasks(tasks) {
    if (!Array.isArray(tasks)) return [];
    return tasks.map(task => ({ ...task, ...getTaskPriorityMeta(task) }));
}

module.exports = {
    normalizeErrorType,
    getTaskPriorityMeta,
    annotateTasks,
    EFFORT_MINUTES,
    IMPACT_WEIGHT,
    QUICK_WIN_MAX_MINUTES,
    DEFAULT_EFFORT_MINUTES,
    DEFAULT_IMPACT_WEIGHT,
    PREFIXED_ERROR_TYPES
};

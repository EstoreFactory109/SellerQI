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
    'ranking:backend_keywords_duplicate_words': 3,
    'ranking:duplicate_words': 5, // retired errorType (never generated: see CreateTasksService)
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
    // Cheaper than a full A+ page: one module, and the copy usually already
    // exists in the brand's other listings.
    'conversion:missing_brand_story': 90,

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
    // Pausing the ads on a product that is not selling is a couple of clicks.
    'profitability:ad_spend_no_sales': 5,

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
    'account:onTimeDeliveryRateStatus': 20,
    'account:PolicyViolations': 30,
    'account:orderWithDefectsStatus': 30,
    'account:NCX': 30,
    'account:accountStatus': 60,

    // Statuses Amazon keeps flipping (checkAccountHealth level 'warning'): the same
    // remediation, so the same effort as the sustained type.
    'account:accountStatus_unstable': 60,
    'account:PolicyViolations_unstable': 30,
    'account:orderWithDefectsStatus_unstable': 30,
    'account:lateShipmentRateStatus_unstable': 20,
    'account:CancellationRate_unstable': 20,
    'account:onTimeDeliveryRateStatus_unstable': 20,
    'account:validTrackingRateStatus_unstable': 10,

    // ── tasks-logics.xlsx detectors (kpi/) ──
    'inventory:listing_suppressed': 15,     // fix the flagged field or upload a document
    'inventory:out_of_stock': 30,           // create and send an FBA shipment
    'inventory:removal_shortfall': 20,      // open a case with the order and what arrived
    'inventory:removal_confirm_receipt': 5, // type in what arrived per order
    'sponsoredAds:ads_on_unbuyable': 3,     // pause the ad group: a couple of clicks
    'profitability:cogs_missing': 20,       // enter unit costs for the listed products
    'account:ahr_early_warning': 30,        // find what moved the score and fix it
    // Wave 2
    'conversion:sales_drop': 30,            // find the cause: price, Buy Box, reviews, ads
    'conversion:conversion_rate_drop': 30,
    'conversion:traffic_drop': 30,
    'sponsoredAds:tacos_rising': 30,        // review campaigns that grew spend
    'sponsoredAds:top_seller_not_advertised': 20, // set up an auto campaign
    'conversion:rating_drop': 60,           // read reviews, fix the cause
    'inventory:weeks_of_cover': 20,         // pause inbound, set a coupon
    // Wave 3
    'inventory:listing_warnings': 10,       // fix one flagged field
    'account:invoice_defect_rate': 15,      // upload missing invoices
    'inventory:low_inventory_fee_risk': 30, // create an FBA shipment
    'inventory:fba_fee_increase': 20,       // check dimensions, open a case
    'inventory:handling_time_long': 5,      // change one offer setting
    'inventory:new_seller_on_brand': 15,    // check the seller, test buy if unknown
    // Spreadsheet alignment
    'ranking:listing_errors': 10,           // fix the field Amazon flagged
    'inventory:lost_damaged_unreimbursed': 15, // file a claim
    'inventory:return_reason_spike': 30,    // read comments, fix listing or supplier
    'inventory:inbound_shortage': 20,       // open a case with documents
    'conversion:high_traffic_low_conversion': 45, // listing work
    'conversion:low_traffic_high_conversion': 20, // ads/keywords
    'sponsoredAds:product_acos_above_breakeven': 5, // lower bids / pause targets
    'ranking:backend_keywords_title_overlap': 3,
    'ranking:backend_keywords_underused': 10,  // add synonyms and alternate terms
    'ranking:titleresult_too_short': 10        // add searched details to the title
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
    // Spreadsheet P1, same tier as late shipment and cancellation.
    'account:onTimeDeliveryRateStatus': 68,
    'account:NCX': 55,
    'account:negativeFeedbacks': 50,
    'account:validTrackingRateStatus': 30,
    'account:responseUnder24HoursCount': 28,
    // A status that keeps slipping is a warning, not a sustained failure: about 60%
    // of the sustained type, so it sorts below real problems but above polish.
    'account:accountStatus_unstable': 60,
    'account:PolicyViolations_unstable': 55,
    'account:orderWithDefectsStatus_unstable': 45,
    'account:lateShipmentRateStatus_unstable': 41,
    'account:CancellationRate_unstable': 41,
    'account:onTimeDeliveryRateStatus_unstable': 41,
    'account:validTrackingRateStatus_unstable': 18,

    // Money leaving the account right now.
    'profitability:negative_profit': 85,
    // Real money leaving with nothing to show for it: weighted like wasted keywords.
    'profitability:ad_spend_no_sales': 65,
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
    // tasks-logics.xlsx: a listing shoppers cannot buy, or nothing on the shelf, is
    // the same class of loss as stranded stock; ads on them are money with no
    // possible return; a removal shortfall is a claim with a deadline.
    'inventory:listing_suppressed': 78,
    'inventory:out_of_stock': 74,
    'sponsoredAds:ads_on_unbuyable': 66,
    'inventory:removal_shortfall': 48,
    // Not a loss yet, only the question that finds one: below the claim itself.
    'inventory:removal_confirm_receipt': 30,
    // Without unit costs no profit figure is real: below money already being lost.
    'profitability:cogs_missing': 40,
    // At or above the client's account-risk floor (ACCOUNT_RISK_MIN_WEIGHT = 68),
    // so it shows as a risk, but below the sustained Amazon statuses.
    'account:ahr_early_warning': 70,
    // Business invoices: a real Amazon metric, but only for Amazon Business sellers.
    'account:invoice_defect_rate': 45,
    // Wave 2: sales already falling, then the signals that explain or precede it.
    'conversion:sales_drop': 64,
    'conversion:conversion_rate_drop': 62,
    'conversion:traffic_drop': 56,
    'conversion:rating_drop': 50,
    'sponsoredAds:tacos_rising': 44,
    'inventory:weeks_of_cover': 42,
    // Growth, not loss: below every loss above.
    'sponsoredAds:top_seller_not_advertised': 33,
    // Wave 3: fees being charged now, then warnings that can become blocks.
    'inventory:fba_fee_increase': 57,
    'inventory:low_inventory_fee_risk': 54,
    'inventory:listing_warnings': 46,
    // A later promised delivery date costs conversion, but it is a setting, not a loss.
    'inventory:handling_time_long': 30,
    // A hijacker takes sales and a counterfeit costs reviews and the account's standing.
    'inventory:new_seller_on_brand': 60,

    // Conversion drag.
    'conversion:insufficient_images': 55,
    'conversion:low_star_rating': 42,
    'conversion:missing_video': 40,
    'conversion:insufficient_reviews': 38,
    'conversion:missing_aplus_content': 36,
    // Below A+ content: it sits under the A+ description, so it lifts trust and
    // cross-sell rather than the primary conversion decision.
    'conversion:missing_brand_story': 24,

    // Discoverability. Title carries far more search weight than bullets, and
    // bullets more than the description.
    'ranking:titleresult_char_limit': 50,
    'ranking:titleresult_restricted_words': 50,
    'ranking:titleresult_word_repetition': 50,
    'ranking:titleresult_special_characters': 50,
    'ranking:titleresult_capitalization': 50,
    'ranking:duplicate_words': 45, // retired errorType
    'ranking:backend_keywords_char_limit': 36,
    'ranking:backend_keywords_duplicate_words': 36,
    'ranking:backend_keywords_title_overlap': 30,
    // Spreadsheet P4: worth doing, never ahead of a real problem.
    'ranking:backend_keywords_underused': 14,
    'ranking:titleresult_too_short': 16,
    // Amazon itself flagged it, and unfixed it can lead to suppression (spreadsheet P2).
    'ranking:listing_errors': 66,
    // Spreadsheet P1 with a deadline: money Amazon owes, lost if the window closes.
    'inventory:lost_damaged_unreimbursed': 72,
    'inventory:return_reason_spike': 45,
    'inventory:inbound_shortage': 72,
    // Spreadsheet P3 / P4.
    'conversion:high_traffic_low_conversion': 50,
    'conversion:low_traffic_high_conversion': 30,
    // Same family as high_acos (58), but judged on the product's own break-even.
    'sponsoredAds:product_acos_above_breakeven': 60,
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
        // tasks-logics.xlsx P1-P4 label (TaskPriorityLevels requires this file, so lazily).
        priorityLevel: require('./TaskPriorityLevels.js').priorityLevelFor(task),
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

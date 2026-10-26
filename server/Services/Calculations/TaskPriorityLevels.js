/**
 * tasks-logics.xlsx priority per task type: P1 Urgent, P2 High, P3 Medium, P4 Low.
 *
 * Separate from TaskPrioritizationService's impact weights (which rank tasks within
 * a list): this is the spreadsheet's label, shown to the seller, and what "Amazon
 * Ready" is judged on (an ASIN with no open P1-P3 task).
 *
 * Where the spreadsheet is silent: a status that keeps slipping (`_unstable`) is one
 * level below the sustained problem; the older ad checks it does not list are P4
 * when they are optimisation, P3 when money is being spent without return; anything
 * else unlisted is P3.
 */

const { normalizeErrorType } = require('./TaskPrioritizationService.js');

const LEVELS = ['P1', 'P2', 'P3', 'P4'];
const DEFAULT_LEVEL = 'P3';

const PRIORITY_LEVEL = {
    // ── Account health
    'account:accountStatus': 'P1',
    'account:PolicyViolations': 'P1',
    'account:validTrackingRateStatus': 'P1',
    'account:orderWithDefectsStatus': 'P1',
    'account:lateShipmentRateStatus': 'P1',
    'account:CancellationRate': 'P1',
    'account:onTimeDeliveryRateStatus': 'P1',
    'account:a_z_claims': 'P1',
    'account:ahr_early_warning': 'P1',
    'account:negativeFeedbacks': 'P2',
    'account:negative_feedback_order': 'P2',
    'inventory:storage_utilization_risk': 'P3',
    'account:NCX': 'P2',
    'account:invoice_defect_rate': 'P2',
    'account:responseUnder24HoursCount': 'P3',

    // ── Money owed, with a claim deadline
    'inventory:lost_damaged_unreimbursed': 'P1',
    'inventory:inbound_shortage': 'P1',
    'inventory:refund_not_returned': 'P1',
    'inventory:removal_shortfall': 'P2',
    'inventory:removal_confirm_receipt': 'P2',

    // ── Inventory
    'inventory:listing_suppressed': 'P2', // P1 for a top-20% seller, see priorityLevelFor
    'inventory:out_of_stock': 'P2',
    'inventory:replenishment_needed': 'P2',
    'inventory:stranded_inventory': 'P2',
    'inventory:new_seller_on_brand': 'P2',
    'inventory:unfulfillable_inventory': 'P3',
    'inventory:long_term_storage_fees': 'P3',
    'inventory:inbound_non_compliance': 'P3',
    'inventory:weeks_of_cover': 'P3',
    'inventory:low_inventory_fee_risk': 'P3',
    'inventory:fba_fee_increase': 'P3',
    'inventory:return_reason_spike': 'P3',
    'inventory:returns_fee_risk': 'P3',
    'conversion:priced_above_featured_offer': 'P3',
    'inventory:subscribe_and_save': 'P4',
    'inventory:inbound_placement_fees': 'P4',
    'sponsoredAds:budget_limited_profitable': 'P3',
    'inventory:listing_warnings': 'P4',
    'inventory:handling_time_long': 'P4',

    // ── Conversion and trends
    'conversion:no_buybox': 'P2',
    'conversion:low_star_rating': 'P2',
    'conversion:sales_drop': 'P2',
    'conversion:conversion_rate_drop': 'P2',
    'conversion:rating_drop': 'P2',
    'conversion:traffic_drop': 'P3',
    'conversion:high_traffic_low_conversion': 'P3',
    'conversion:missing_aplus_content': 'P3',
    'conversion:low_traffic_high_conversion': 'P4',
    'conversion:insufficient_images': 'P4',
    'conversion:missing_video': 'P4',
    'conversion:missing_brand_story': 'P4',
    'conversion:insufficient_reviews': 'P4',

    // ── Advertising
    'sponsoredAds:ads_on_unbuyable': 'P2',
    'sponsoredAds:high_acos': 'P3',
    'sponsoredAds:extreme_high_acos': 'P3',
    'sponsoredAds:product_acos_above_breakeven': 'P3',
    'sponsoredAds:wasted_spend_keyword': 'P3',
    'sponsoredAds:search_term_zero_sales': 'P3',
    'sponsoredAds:keyword_no_sales': 'P3',
    'sponsoredAds:no_sales_high_spend': 'P3',
    'sponsoredAds:tacos_rising': 'P3',
    'sponsoredAds:top_seller_not_advertised': 'P4',
    'sponsoredAds:auto_campaign_migration_needed': 'P4',
    'sponsoredAds:ppc_optimization': 'P4',
    'sponsoredAds:marginal_profit': 'P4',
    'sponsoredAds:low_ctr': 'P4',

    // ── Profitability
    'profitability:negative_profit': 'P3',
    'profitability:cogs_missing': 'P3',
    'profitability:ad_spend_no_sales': 'P3',
    'profitability:low_margin': 'P3',
    'profitability:profitability_issue': 'P3',

    // ── Listing text (Rankings)
    'ranking:listing_errors': 'P2',
    'ranking:detail_page_changed': 'P2',
    'ranking:backend_keywords_char_limit': 'P2', // over Amazon's limit: all ignored
    'ranking:backend_keywords_duplicate_words': 'P4',
    'ranking:backend_keywords_title_overlap': 'P4',
    'ranking:backend_keywords_underused': 'P4',
    'ranking:titleresult_too_short': 'P4',
    'ranking:duplicate_words': 'P4'
};

/**
 * Rankings errorTypes are `<field>_<check>`. Restricted words are P2 wherever they
 * appear; title length, repetition and characters P3; bullets and description P4.
 */
function rankingLevel(errorType) {
    if (/_restricted_words$/.test(errorType)) return 'P2';
    if (errorType.startsWith('titleresult_')) return 'P3';
    if (errorType.startsWith('bulletpoints_') || errorType.startsWith('description_')) return 'P4';
    return null;
}

/**
 * @param {Object} task - stored task ({errorCategory, errorType, renderData})
 * @returns {'P1'|'P2'|'P3'|'P4'}
 */
function priorityLevelFor(task) {
    const category = task?.errorCategory;
    let type = normalizeErrorType(task?.errorType);
    let demote = 0;
    if (type.endsWith('_unstable')) {
        type = type.slice(0, -'_unstable'.length);
        demote = 1;
    }
    let level = PRIORITY_LEVEL[`${category}:${type}`]
        || (category === 'ranking' ? rankingLevel(type) : null)
        || DEFAULT_LEVEL;
    if (category === 'inventory' && type === 'listing_suppressed' && task?.renderData?.topSeller === true) level = 'P1';
    // Missing A+ is P3 for a top-20%-revenue product, P4 otherwise. Tasks stored
    // before the flag existed keep P3.
    if (category === 'conversion' && type === 'missing_aplus_content' && task?.renderData?.topSeller === false) level = 'P4';
    return LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(level) + demote)];
}

/** Whether an open task of this level stops its ASIN counting as Amazon Ready (P1-P3). */
const blocksAmazonReady = (level) => level === 'P1' || level === 'P2' || level === 'P3';

module.exports = { PRIORITY_LEVEL, LEVELS, DEFAULT_LEVEL, priorityLevelFor, blocksAmazonReady };

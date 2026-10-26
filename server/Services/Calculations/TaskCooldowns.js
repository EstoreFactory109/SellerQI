/**
 * tasks-logics.xlsx cooldown per check: how long a task the seller marked done
 * stays done while the issue is still detected, before it is raised again.
 *
 * "Until resolved" (account health) comes back after 1 day: it is not done until
 * Amazon says so. "Per event / order / claim / shipment / seller" checks are about
 * one event each, so they come back after 30 days only if the issue is still there.
 * Unlisted types keep the previous fixed 7 days.
 */
const { normalizeErrorType } = require('./TaskPrioritizationService.js');

const DEFAULT_COOLDOWN_DAYS = 7;
const UNTIL_RESOLVED = 1;
const PER_EVENT = 30;

const COOLDOWN_DAYS = {
    // Account health
    'account:accountStatus': UNTIL_RESOLVED,
    'account:PolicyViolations': UNTIL_RESOLVED,
    'account:validTrackingRateStatus': UNTIL_RESOLVED,
    'account:orderWithDefectsStatus': UNTIL_RESOLVED,
    'account:lateShipmentRateStatus': UNTIL_RESOLVED,
    'account:CancellationRate': UNTIL_RESOLVED,
    'account:onTimeDeliveryRateStatus': UNTIL_RESOLVED,
    'account:invoice_defect_rate': UNTIL_RESOLVED,
    'account:a_z_claims': PER_EVENT,
    'account:negativeFeedbacks': PER_EVENT,
    'account:negative_feedback_order': PER_EVENT,
    'account:NCX': 30,
    'account:responseUnder24HoursCount': 1,
    'account:ahr_early_warning': 7,

    // Money owed
    'inventory:lost_damaged_unreimbursed': PER_EVENT,
    'inventory:inbound_shortage': PER_EVENT,
    'inventory:refund_not_returned': PER_EVENT,
    'inventory:removal_shortfall': PER_EVENT,
    'inventory:removal_confirm_receipt': PER_EVENT,

    // Inventory
    'inventory:replenishment_needed': 7,
    'inventory:out_of_stock': 7,
    'inventory:listing_suppressed': 3,
    'inventory:stranded_inventory': 7,
    'inventory:inbound_non_compliance': PER_EVENT,
    'inventory:unfulfillable_inventory': 30,
    'inventory:long_term_storage_fees': 30,
    'inventory:weeks_of_cover': 30,
    'inventory:low_inventory_fee_risk': 7,
    'inventory:fba_fee_increase': 30,
    'inventory:returns_fee_risk': 30,
    'inventory:return_reason_spike': 30,
    'inventory:listing_warnings': 30,
    'inventory:handling_time_long': 30,
    'inventory:new_seller_on_brand': PER_EVENT,
    'inventory:inbound_placement_fees': 30,
    'inventory:subscribe_and_save': 90,

    // Conversion and trends
    'conversion:no_buybox': 7,
    'conversion:low_star_rating': 30,
    'conversion:insufficient_reviews': 90,
    'conversion:insufficient_images': 90,
    'conversion:missing_video': 90,
    'conversion:missing_aplus_content': 90,
    'conversion:missing_brand_story': 90,
    'conversion:sales_drop': 14,
    'conversion:conversion_rate_drop': 14,
    'conversion:traffic_drop': 14,
    'conversion:rating_drop': 30,
    'conversion:high_traffic_low_conversion': 60,
    'conversion:low_traffic_high_conversion': 60,
    'conversion:priced_above_featured_offer': 14,

    // Advertising
    'sponsoredAds:product_acos_above_breakeven': 14,
    'sponsoredAds:high_acos': 14,
    'sponsoredAds:extreme_high_acos': 14,
    'sponsoredAds:tacos_rising': 30,
    'sponsoredAds:search_term_zero_sales': 30,
    'sponsoredAds:wasted_spend_keyword': 30,
    'sponsoredAds:ads_on_unbuyable': 3,
    'sponsoredAds:top_seller_not_advertised': 60,
    'sponsoredAds:budget_limited_profitable': 14,

    // Profitability
    'profitability:negative_profit': 30,
    'profitability:cogs_missing': 30,

    // Listing text
    'ranking:listing_errors': 14,
    'ranking:detail_page_changed': 7,
    'ranking:titleresult_too_short': 30,
    'ranking:backend_keywords_underused': 30,
    'ranking:backend_keywords_title_overlap': 30,
    'ranking:backend_keywords_duplicate_words': 30,
    'ranking:backend_keywords_char_limit': 30
};

/** Rankings errorTypes are <field>_<check>: restricted words 14, titles 30, bullets/description 90. */
function rankingCooldown(type) {
    if (/_restricted_words$/.test(type)) return 14;
    if (type.startsWith('titleresult_') || type.startsWith('backend_keywords_')) return 30;
    if (type.startsWith('bulletpoints_') || type.startsWith('description_')) return 90;
    return null;
}

/**
 * @param {Object} task - { errorCategory, errorType }
 * @returns {number} days
 */
function cooldownDaysFor(task) {
    let type = normalizeErrorType(task?.errorType);
    if (type.endsWith('_unstable')) type = type.slice(0, -'_unstable'.length);
    const category = task?.errorCategory;
    return COOLDOWN_DAYS[`${category}:${type}`]
        ?? (category === 'ranking' ? rankingCooldown(type) : null)
        ?? DEFAULT_COOLDOWN_DAYS;
}

module.exports = { COOLDOWN_DAYS, DEFAULT_COOLDOWN_DAYS, cooldownDaysFor };

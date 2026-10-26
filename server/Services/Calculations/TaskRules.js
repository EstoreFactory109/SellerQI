/**
 * TaskRules — the thresholds that decide whether something is an issue (and so a
 * task), kept in one place.
 *
 * Detection (DashboardCalculation) and the recoverable-$ formulas
 * (RecoverableAmountUtils) must agree on these: a product flagged for missing a
 * 10% margin has its shortfall measured against that same 10%. They used to be
 * literals in one file and constants in the other.
 */

// A product below this net margin is a low_margin issue; its recoverable amount is
// the shortfall to it.
const TARGET_PROFIT_MARGIN_PERCENT = 10;

// A campaign above this ACOS (with sales) is a high_acos issue; its recoverable
// amount is the spend above it.
const TARGET_ACOS_PERCENT = 40;

// tasks-logics.xlsx "Search terms with spend and no sales": 15+ clicks, 0 orders and
// spend over the product's price in 30 days. Search-term rows carry no ASIN, so
// the price is the median price of the account's active products.
const SEARCH_TERM_MIN_CLICKS = 15;

// An auto-campaign search term with more than this in sales has proven itself and
// should move to a manual campaign.
const AUTO_MIGRATION_MIN_SALES = 30;

// A keyword needs this many clicks with no sales before its spend counts as wasted.
// There was no floor: 3,123 of 4,584 flagged keywords in production had 2 clicks or
// fewer and 1,547 had spent under $1 — noise, not waste. Same floor as search terms.
const KEYWORD_MIN_CLICKS = 10;

// Ads sales are 7-day attributed (the reports' `sales7d`, stored as
// attributedSales30d). A click from the last 7 days can still pick up its sale, so
// spend that recent cannot yet be called wasted. 761 flagged keywords had ALL their
// spend inside that window.
const ATTRIBUTION_SETTLE_DAYS = 7;

// Ads rows whose newest day is older than this (vs the marketplace's yesterday) are
// stale: a stopped sync would otherwise keep re-issuing the last 30 stored days as
// current problems.
const ADS_DATA_MAX_AGE_DAYS = 7;

module.exports = {
    TARGET_PROFIT_MARGIN_PERCENT,
    TARGET_ACOS_PERCENT,
    SEARCH_TERM_MIN_CLICKS,
    AUTO_MIGRATION_MIN_SALES,
    KEYWORD_MIN_CLICKS,
    ATTRIBUTION_SETTLE_DAYS,
    ADS_DATA_MAX_AGE_DAYS
};

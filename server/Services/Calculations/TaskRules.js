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

// A search term needs at least this many clicks with no sales before it counts as
// wasted, so a term with one stray click is not flagged.
const SEARCH_TERM_MIN_CLICKS = 10;

// An auto-campaign search term with more than this in sales has proven itself and
// should move to a manual campaign.
const AUTO_MIGRATION_MIN_SALES = 30;

module.exports = {
    TARGET_PROFIT_MARGIN_PERCENT,
    TARGET_ACOS_PERCENT,
    SEARCH_TERM_MIN_CLICKS,
    AUTO_MIGRATION_MIN_SALES
};

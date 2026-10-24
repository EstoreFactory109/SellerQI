/**
 * KpiRules — thresholds for the tasks specified in tasks-logics.xlsx, in one place.
 *
 * Each value carries the spreadsheet's "threshold basis": an Amazon rule is
 * Amazon's number and should not be tuned; an internal one is ours to tune
 * after a production preview.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Listing blocked / suppressed / inactive ──
// Spreadsheet: SKU with stock or sales in the last 60 days. Per-ASIN sales here
// cover the dashboard window (about 30 days), so the sales half is narrower.
// The Suppressed Listings report is daily; a week tolerates missed runs (same
// guard as the other daily inventory reports, InventoryReportFreshness.js).
const SUPPRESSED_REPORT_MAX_AGE_DAYS = 7;
// Spreadsheet: P1 when the ASIN is in the top 20% of account revenue. Internal.
const TOP_REVENUE_SHARE = 0.2;

// ── Out of stock ──
// FBA Inventory API rows are refreshed daily (INIT phase); older rows cannot
// say the shelf is empty today. Internal.
const FBA_STOCK_MAX_AGE_DAYS = 3;

// ── Ads running on products that cannot sell ──
// Spreadsheet: under 50% Featured Offer counts as unbuyable for this rule. Internal.
const ADS_UNBUYABLE_BUYBOX_PCT = 50;
// "Active ads" = spend on the ASIN in the newest days of ads data. Internal.
const ADS_ACTIVE_LOOKBACK_DAYS = 3;
// The recoverable amount is the spend over this many newest days. Internal.
const ADS_SPEND_MEASURE_DAYS = 7;

// ── Account Health early warning ──
// Spreadsheet: score down 20+ points in 7 days, or below 250. Internal buffer
// above Amazon's 200 At-Risk cutoff, not an Amazon threshold.
const AHR_DROP_POINTS = 20;
const AHR_WARNING_FLOOR = 250;
const AHR_LOOKBACK_DAYS = 7;

// ── Removal order shortfall ──
// Spreadsheet: about 60 days from shipment to claim (Amazon rule).
const REMOVAL_CLAIM_WINDOW_DAYS = 60;
// The removal report is weekly; allow one missed run. Internal.
const REMOVAL_REPORT_MAX_AGE_DAYS = 10;

module.exports = {
    DAY_MS,
    SUPPRESSED_REPORT_MAX_AGE_DAYS,
    TOP_REVENUE_SHARE,
    FBA_STOCK_MAX_AGE_DAYS,
    ADS_UNBUYABLE_BUYBOX_PCT,
    ADS_ACTIVE_LOOKBACK_DAYS,
    ADS_SPEND_MEASURE_DAYS,
    AHR_DROP_POINTS,
    AHR_WARNING_FLOOR,
    AHR_LOOKBACK_DAYS,
    REMOVAL_CLAIM_WINDOW_DAYS,
    REMOVAL_REPORT_MAX_AGE_DAYS
};

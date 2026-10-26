/**
 * KpiRules — thresholds for the tasks specified in tasks-logics.xlsx, in one place.
 *
 * Each value carries the spreadsheet's "threshold basis": an Amazon rule is
 * Amazon's number and should not be tuned; an internal one is ours to tune
 * after a production preview.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Listing blocked / suppressed / inactive ──
// Spreadsheet: SKU with stock or sales in the last 60 days (Lookback is internal).
const SUPPRESSED_SALES_LOOKBACK_DAYS = 60;
// The Suppressed Listings report is daily; a week tolerates missed runs (same
// guard as the other daily inventory reports, InventoryReportFreshness.js).
const SUPPRESSED_REPORT_MAX_AGE_DAYS = 7;
// Spreadsheet: P1 when the ASIN is in the top 20% of account revenue. Internal.
const TOP_REVENUE_SHARE = 0.2;

// ── Sales window ──
// Per-ASIN sales cover the dashboard window, which ends where the account's last
// completed data run ended — weeks back on an account whose pipeline stopped
// (seen: a window ending 1 Sep read on 24 Oct, finance still called fresh). Rules
// that need "sold recently" only run when the window ends within this many days. Internal.
const SALES_WINDOW_MAX_AGE_DAYS = 7;

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

// ════════════════════════════ Wave 2 ════════════════════════════

// ── Sales, conversion and traffic trends (daily per-ASIN Sales & Traffic) ──
// The data lags Amazon by about 2 days; a newest day older than this is stale. Internal.
const TRAFFIC_MAX_AGE_DAYS = 5;
// Spreadsheet: last 14 days against the prior 60 (74-day lookback). Where an account
// has less history, at least TRAFFIC_MIN_BASELINE_DAYS of baseline is used (internal),
// so newer accounts are covered too; the task says which baseline it used.
const TRAFFIC_RECENT_DAYS = 14;
const TRAFFIC_BASELINE_DAYS = 60;
const TRAFFIC_MIN_BASELINE_DAYS = 28;
// Spreadsheet: conversion down 25%+ (relative), 200+ sessions in the 14 days.
const CVR_DROP_SHARE = 0.25;
const CVR_MIN_RECENT_SESSIONS = 200;
// Spreadsheet: sessions down 30%+ against the baseline daily average; baseline 300+ per 14 days.
const TRAFFIC_DROP_SHARE = 0.30;
const TRAFFIC_MIN_BASELINE_SESSIONS_14D = 300;
// Spreadsheet (Sales drop): units in the last 7 days down 30%+ against the average 7-day
// units of the prior 28 days; baseline 20+ units a week.
const SALES_RECENT_DAYS = 7;
const SALES_BASELINE_DAYS = 28;
const SALES_DROP_SHARE = 0.30;
const SALES_MIN_BASELINE_UNITS_WEEK = 20;

// Spreadsheet "High traffic, low conversion": sessions in the account's top 30% and
// conversion under half the account median over 30 days; 300+ sessions.
// "Low traffic, high conversion": conversion 1.5x+ the median, sessions in the bottom
// 30%; 10+ orders. Medians and percentiles over this account's ASINs with traffic.
const TRAFFIC_MIX_DAYS = 30;
// Fewer days than this in the 30-day window (gaps, new account) is not judged. Internal.
const TRAFFIC_MIX_MIN_DAYS = 21;
const TRAFFIC_MIX_TOP_SHARE = 0.30;
const HIGH_TRAFFIC_MIN_SESSIONS = 300;
const HIGH_TRAFFIC_CVR_RATIO = 0.5;
const LOW_TRAFFIC_CVR_RATIO = 1.5;
const LOW_TRAFFIC_MIN_ORDERS = 10;
// Too few products to call any of them "top 30%" or compare to a median. Internal.
const TRAFFIC_MIX_MIN_ASINS = 5;

// Spreadsheet "Potential reimbursements: lost or damaged": lost or damaged units still
// unreconciled (neither found nor reimbursed) 30 days after the event and still inside
// Amazon's 60-day claim window. Ledger reason codes: M and 5 lost; 6, 7, E, H, K, U
// damaged (the codes the Reimbursement page already uses).
const LOST_DAMAGED_WAIT_DAYS = 30;
const LOST_DAMAGED_CLAIM_DAYS = 60;
const LOST_REASON_CODES = ['M', '5'];
const DAMAGED_REASON_CODES = ['6', '7', 'E', 'H', 'K', 'U'];

// Spreadsheet "Detail page changed without us": changes in the last 7 days that no
// recorded edit (Fix It, an approved task fix) explains. A recorded edit up to 3 days
// before the change counts as ours (internal). A price that changed on 3+ of the last
// 7 days is a repricer, not a change to report (user decision, 2026-10-26).
const DETAIL_CHANGE_DAYS = 7;
const DETAIL_CHANGE_OURS_DAYS = 3;
const REPRICER_PRICE_DAYS = 3;

// Spreadsheet "Return reason spike": 'not as described', 'defective' or 'wrong item'
// make up 30%+ of a product's returns in 30 days. The 10-return floor is internal (2
// of 3 returns is not a spike). Codes per Amazon's returns report; ORDERED_WRONG_ITEM
// is the buyer's mistake, not a wrong item sent, so it is excluded. Codes checked
// against live AU and US reports (Oct 2026): DEFECTIVE, NOT_AS_DESCRIBED, SWITCHEROO.
const RETURN_SPIKE_DAYS = 30;
const RETURN_SPIKE_SHARE = 0.30;
const RETURN_SPIKE_MIN_RETURNS = 10;
const isProductFaultReturn = (reason) => {
    const r = String(reason || '').toUpperCase().replace(/[\s-]+/g, '_');
    if (r === 'ORDERED_WRONG_ITEM') return false;
    // SWITCHEROO is Amazon's code for "wrong item was sent" (seen in a live US report).
    return /DEFECTIVE|NOT_AS_DESCRIBED|WRONG_ITEM|SWITCHEROO|INACCURATE_WEBSITE_DESCRIPTION/.test(r);
};

// A day selling over this multiple of the account's median day is an event day (Prime
// Day, a deal) and is left out of every trend window. Internal.
const EVENT_DAY_MULTIPLE = 3;

// ── TACoS ──
// Spreadsheet: 30-day TACoS up 3+ points against the prior 30 days while total sales
// moved less than 5%; $1,000+ sales in 30 days.
const TACOS_WINDOW_DAYS = 30;
const TACOS_RISE_POINTS = 3;
const TACOS_SALES_FLAT_SHARE = 0.05;
const TACOS_MIN_SALES = 1000;
// Each window needs this many days with data before it is compared. Internal.
const TACOS_MIN_DAYS_PER_WINDOW = 25;

// ── Ratings and reviews (weekly listing scrape) ──
// Spreadsheet: rating down 0.2+ within 30 days, 20+ ratings. The scrape is weekly, so the
// comparison scrape is the one closest to 30 days before the newest, within this range.
const RATING_DROP = 0.2;
const RATING_MIN_COUNT = 20;
const RATING_COMPARE_MIN_DAYS = 21;
const RATING_COMPARE_MAX_DAYS = 45;
// Spreadsheet: under 50 reviews.
const LOW_REVIEW_COUNT = 50;
// A newest scrape older than this cannot describe the listing today. Internal.
const REVIEW_SCRAPE_MAX_AGE_DAYS = 10;

// ── Weeks of cover ──
// Spreadsheet: weeks of cover over 26 and stock value over $200 (local currency here).
// The excess is measured above a 12-week holding, the top of the spreadsheet's 8-12 week target.
const WEEKS_OF_COVER_MAX = 26;
const WEEKS_OF_COVER_MIN_VALUE = 200;
const WEEKS_OF_COVER_TARGET = 12;

// ── Top seller not advertised ──
// Spreadsheet: top 20% of revenue, no active ads for 14 days.
const TOP_SELLER_NO_ADS_DAYS = 14;

// ════════════════════════════ Wave 3 ════════════════════════════

// ── Listing warnings ──
// The same warning on at least this many listings is one grouped task. Internal.
const LISTING_WARNING_GROUP_MIN = 3;

// ── New seller on brand listing (weekly brand-offer check) ──
// The newest check must be this recent to compare. Internal.
const BRAND_OFFERS_MAX_AGE_DAYS = 10;

// ── Handling time (FBM) ──
// Spreadsheet: P4 task when handling time is over 2 days. Internal.
const HANDLING_TIME_MAX_DAYS = 2;

// ── Stale data (internal guard) ──
// Spreadsheet: latest pull older than 36 hours. Per source, its own cadence plus the
// lag Amazon builds in; the guard reports, the detectors already hold stale inputs.
const STALE_DAILY_HOURS = 36;

// ── Low-inventory-level fee ──
// Amazon rule: fee applies when historical days of supply is under 28 on BOTH the
// short (30-day) and long (90-day) measures. Early warning under 35 is internal.
const LOW_INVENTORY_FEE_DAYS = 28;
const LOW_INVENTORY_WARNING_DAYS = 35;

// ── FBA fee increase / size tier change (weekly fee-estimate snapshots) ──
// A per-unit fee rise under this share is treated as rounding. Internal.
const FBA_FEE_MIN_INCREASE_SHARE = 0.02;
// The newest snapshot must be this recent to compare. Internal.
const FBA_FEE_SNAPSHOT_MAX_AGE_DAYS = 10;

module.exports = {
    TRAFFIC_MAX_AGE_DAYS,
    TRAFFIC_RECENT_DAYS,
    TRAFFIC_BASELINE_DAYS,
    TRAFFIC_MIN_BASELINE_DAYS,
    CVR_DROP_SHARE,
    CVR_MIN_RECENT_SESSIONS,
    TRAFFIC_DROP_SHARE,
    TRAFFIC_MIN_BASELINE_SESSIONS_14D,
    SALES_RECENT_DAYS,
    SALES_BASELINE_DAYS,
    SALES_DROP_SHARE,
    SALES_MIN_BASELINE_UNITS_WEEK,
    EVENT_DAY_MULTIPLE,
    TRAFFIC_MIX_DAYS,
    TRAFFIC_MIX_MIN_DAYS,
    TRAFFIC_MIX_TOP_SHARE,
    HIGH_TRAFFIC_MIN_SESSIONS,
    HIGH_TRAFFIC_CVR_RATIO,
    LOW_TRAFFIC_CVR_RATIO,
    LOW_TRAFFIC_MIN_ORDERS,
    TRAFFIC_MIX_MIN_ASINS,
    DETAIL_CHANGE_DAYS,
    DETAIL_CHANGE_OURS_DAYS,
    REPRICER_PRICE_DAYS,
    RETURN_SPIKE_DAYS,
    RETURN_SPIKE_SHARE,
    RETURN_SPIKE_MIN_RETURNS,
    isProductFaultReturn,
    LOST_DAMAGED_WAIT_DAYS,
    LOST_DAMAGED_CLAIM_DAYS,
    LOST_REASON_CODES,
    DAMAGED_REASON_CODES,
    TACOS_WINDOW_DAYS,
    TACOS_RISE_POINTS,
    TACOS_SALES_FLAT_SHARE,
    TACOS_MIN_SALES,
    TACOS_MIN_DAYS_PER_WINDOW,
    RATING_DROP,
    RATING_MIN_COUNT,
    RATING_COMPARE_MIN_DAYS,
    RATING_COMPARE_MAX_DAYS,
    LOW_REVIEW_COUNT,
    REVIEW_SCRAPE_MAX_AGE_DAYS,
    WEEKS_OF_COVER_MAX,
    WEEKS_OF_COVER_MIN_VALUE,
    WEEKS_OF_COVER_TARGET,
    TOP_SELLER_NO_ADS_DAYS,
    LISTING_WARNING_GROUP_MIN,
    HANDLING_TIME_MAX_DAYS,
    BRAND_OFFERS_MAX_AGE_DAYS,
    STALE_DAILY_HOURS,
    LOW_INVENTORY_FEE_DAYS,
    LOW_INVENTORY_WARNING_DAYS,
    FBA_FEE_MIN_INCREASE_SHARE,
    FBA_FEE_SNAPSHOT_MAX_AGE_DAYS,
    DAY_MS,
    SUPPRESSED_SALES_LOOKBACK_DAYS,
    SUPPRESSED_REPORT_MAX_AGE_DAYS,
    SALES_WINDOW_MAX_AGE_DAYS,
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

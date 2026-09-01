/**
 * Shared formulas for computing a dollar "amount" recoverable by fixing a
 * given Profitability or Sponsored Ads error. Centralized here so the
 * target-margin / target-ACOS constants aren't duplicated across
 * DashboardCalculation.js and ProfitabilityIssuesService.js.
 */

const logger = require('../../utils/Logger.js');

const TARGET_PROFIT_MARGIN_PERCENT = 10;
const TARGET_ACOS_PERCENT = 40;

// The long-term storage fee report is a MONTHLY snapshot (snapShotDate lands on
// the 15th), and the sync that populates it runs weekly at most. 60 days
// therefore accepts the newest legitimate snapshot with slack, while rejecting
// genuinely stale data. This matters because the LTSF sync is currently
// unregistered in ScheduleConfig.js: without an age guard, documents written by
// a long-gone sync (real ones dated Aug 2025 were still being read in Aug 2026)
// get presented to sellers as money recoverable *today*.
const LTSF_MAX_SNAPSHOT_AGE_DAYS = 60;

/** Milliseconds for a Date or a date-ish string; NaN when undatable. */
function toTime(value) {
    if (!value) return NaN;
    const t = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(t) ? t : NaN;
}

/**
 * Builds {[asin]: long-term storage fee $} from an LTSF document, summing the
 * multiple aging buckets that can appear per ASIN per snapshot, and dropping
 * rows whose snapshot is too old to describe the seller's current position.
 *
 * A row is dated by its own `snapShotDate`; if that is unparseable the
 * document's `createdAt` is used; if neither can be dated the row is dropped
 * rather than trusted, since an undated fee cannot be shown as current.
 *
 * @param {Object|null} ltsfDoc - lean LongTermStorageFees document
 * @param {Date} [now]
 * @param {number} [maxAgeDays]
 * @returns {Object} asin -> summed fee (empty when the doc is missing or stale)
 */
function buildLtsfAmountMap(ltsfDoc, now = new Date(), maxAgeDays = LTSF_MAX_SNAPSHOT_AGE_DAYS) {
    const map = {};
    if (!ltsfDoc || !Array.isArray(ltsfDoc.data) || ltsfDoc.data.length === 0) return map;

    const cutoff = toTime(now) - maxAgeDays * 24 * 60 * 60 * 1000;
    const docTime = toTime(ltsfDoc.createdAt);

    let staleRows = 0;
    let undatedRows = 0;

    ltsfDoc.data.forEach(row => {
        if (!row || !row.asin) return;

        let rowTime = toTime(row.snapShotDate);
        if (!Number.isFinite(rowTime)) rowTime = docTime;

        if (!Number.isFinite(rowTime)) { undatedRows++; return; }
        if (rowTime < cutoff) { staleRows++; return; }

        map[row.asin] = (map[row.asin] || 0) + (parseFloat(row.amount) || 0);
    });

    // Loud on purpose: dropping every row looks identical to "this seller owes
    // no storage fees", so a silent skip would hide both stale data and a
    // date-format regression in the sync's parser.
    if (staleRows > 0 || undatedRows > 0) {
        logger.warn('LTSF rows ignored when building recoverable amounts', {
            staleRows,
            undatedRows,
            keptAsins: Object.keys(map).length,
            maxAgeDays
        });
    }

    return map;
}

/**
 * @param {Object} params
 * @param {number} params.netProfit
 * @param {number} params.profitMargin
 * @param {number} params.sales
 * @param {string} params.issueType - 'negative_profit' | 'low_margin'
 * @returns {number}
 */
function computeProfitabilityAmount({ netProfit, profitMargin, sales, issueType }) {
    if (issueType === 'negative_profit') {
        return Math.abs(netProfit || 0);
    }
    if (issueType === 'low_margin') {
        // $ shortfall versus a healthy TARGET_PROFIT_MARGIN_PERCENT margin
        return Math.max(0, (TARGET_PROFIT_MARGIN_PERCENT / 100) * (sales || 0) - (netProfit || 0));
    }
    return 0;
}

/**
 * @param {Object} params
 * @param {string} params.errorType
 * @param {number} params.spend
 * @param {number} params.sales
 * @returns {number}
 */
function computeSponsoredAdsAmount({ errorType, spend, sales }) {
    switch (errorType) {
        case 'high_acos_campaign':
            return Math.max(0, (spend || 0) - (sales || 0) * (TARGET_ACOS_PERCENT / 100));
        case 'wasted_spend_keyword':
        case 'search_term_zero_sales':
            return spend || 0;
        // auto_campaign_migration_needed is a scaling/efficiency opportunity
        // (sales are already > $30) — not a loss, so no recoverable $ amount.
        default:
            return 0;
    }
}

/**
 * The profit opportunity for ONE product, given both levers that apply to it.
 *
 * These do not add up. `netProfit` is already `sales - adsSpend - totalFees`
 * (ProfitabilityCalculation.js), so a product's loss ALREADY has its wasted ad
 * spend subtracted — removing that waste is part of closing the gap, not extra
 * on top. Summing them produced impossible figures: a product losing $122.29
 * with $24.28 of wasted keywords was reported as $146.57 recoverable, when
 * $122.29 is breakeven and therefore the ceiling.
 *
 * Taking the larger keeps the measured gap as the anchor, while still crediting a
 * guaranteed ad saving that happens to exceed the gap (removing $50 of waste from
 * a product losing $20 really does gain $50 and turns it profitable).
 *
 * @param {Object} params
 * @param {number} params.profitGap - |netProfit| or the shortfall to target margin
 * @param {number} params.adWaste - ad waste attributed to this product
 * @returns {number}
 */
function capProfitOpportunity({ profitGap, adWaste }) {
    return Math.max(Math.max(0, profitGap || 0), Math.max(0, adWaste || 0));
}

/**
 * Unfulfillable inventory: dead CAPITAL = per-unit cost x unfulfillable units.
 *
 * NOT profit. This is money locked in stock that cannot be sold; freeing it
 * returns working capital and stops storage fees accruing, but it never lands as
 * profit. It must be reported separately — on one real account a single ASIN
 * holds $7,902 of this, which would outrank every genuine profit issue by 62x if
 * the two were mixed.
 *
 * @param {Object} params
 * @param {number} params.costPerUnit - COGS per unit for this ASIN (0 if unknown)
 * @param {number} params.quantity - unfulfillable_quantity
 * @returns {number} capital, not profit
 */
function computeInventoryUnfulfillableAmount({ costPerUnit, quantity }) {
    return Math.max(0, (costPerUnit || 0) * (quantity || 0));
}

/**
 * Stranded inventory: CAPITAL tied up in units that can't be sold until the
 * listing issue is fixed — not profit, same as unfulfillable above.
 *
 * `quantity` here is a proxy (the ASIN's total FBA quantity, since a stranded
 * listing makes its whole inventory unsellable, not just some units) rather than
 * a native "stranded units" field, since Amazon's Stranded Inventory report
 * doesn't expose one.
 * @param {Object} params
 * @param {number} params.costPerUnit - COGS per unit for this ASIN (0 if unknown)
 * @param {number} params.quantity - proxy quantity (e.g. total FBA quantity for the ASIN)
 * @returns {number} capital, not profit
 */
function computeInventoryStrandedAmount({ costPerUnit, quantity }) {
    return Math.max(0, (costPerUnit || 0) * (quantity || 0));
}

const BUYBOX_EXTRAPOLATION_DAYS = 30;

/**
 * Derives a seller's own conversion rate + average price from the ASINs
 * that currently DO have the Buy Box, so Buy Box loss can be estimated
 * without an external/generic benchmark.
 * @param {Array} asinBuyBoxData - full array (with AND without Buy Box)
 * @returns {{benchmarkCVR: number, benchmarkPrice: number}}
 */
function computeBuyBoxBenchmark(asinBuyBoxData) {
    if (!Array.isArray(asinBuyBoxData)) {
        return { benchmarkCVR: 0, benchmarkPrice: 0 };
    }

    let benchmarkSessions = 0;
    let benchmarkUnits = 0;
    let benchmarkRevenue = 0;

    asinBuyBoxData.forEach(p => {
        if (p && p.buyBoxPercentage > 0) {
            benchmarkSessions += p.sessions || 0;
            benchmarkUnits += p.unitsOrdered || 0;
            benchmarkRevenue += p.sales?.amount || 0;
        }
    });

    return {
        benchmarkCVR: benchmarkSessions > 0 ? benchmarkUnits / benchmarkSessions : 0,
        benchmarkPrice: benchmarkUnits > 0 ? benchmarkRevenue / benchmarkUnits : 0
    };
}

/**
 * Buy Box loss: estimated 30-day lost revenue = the seller's own
 * benchmark conversion rate/price applied to the lost ASIN's sessions,
 * minus what it actually sold, extrapolated from a single-day snapshot.
 * @param {Object} params
 * @param {number} params.sessions
 * @param {number} params.actualRevenue
 * @param {number} params.benchmarkCVR
 * @param {number} params.benchmarkPrice
 * @param {number} [params.extrapolationDays]
 * @returns {number}
 */
function computeBuyBoxLostRevenueAmount({ sessions, actualRevenue, benchmarkCVR, benchmarkPrice, extrapolationDays = BUYBOX_EXTRAPOLATION_DAYS }) {
    const potentialDailyRevenue = (sessions || 0) * (benchmarkCVR || 0) * (benchmarkPrice || 0);
    const dailyLostRevenue = Math.max(0, potentialDailyRevenue - (actualRevenue || 0));
    return dailyLostRevenue * extrapolationDays;
}

/**
 * Converts Buy Box lost REVENUE into the profit it actually represents.
 *
 * Winning the Buy Box back returns revenue, not profit — only the margin on that
 * revenue reaches the bottom line. Counting the full revenue overstated the
 * opportunity roughly tenfold at a typical 10% margin, and made Buy Box issues
 * outrank real cash losses.
 *
 * Flooring at zero is deliberate and informative: on a product that loses money
 * per unit, winning more sales loses MORE money, so the honest profit opportunity
 * is nothing until the margin is fixed first.
 *
 * @param {Object} params
 * @param {number} params.lostRevenue - from computeBuyBoxLostRevenueAmount
 * @param {number} params.profitMargin - that ASIN's margin as a percentage (e.g. 12.5)
 * @returns {number} profit-equivalent amount
 */
function computeBuyBoxProfitImpact({ lostRevenue, profitMargin }) {
    const margin = Math.max(0, Number(profitMargin) || 0);
    return Math.max(0, (Number(lostRevenue) || 0) * (margin / 100));
}

/**
 * Single source of truth for the combined recoverable total, so consumers
 * (IssueSummaryService, IssuesDataChunks metadata, opportunity ranking)
 * can't drift on which categories are included.
 * @param {Object} amounts - any object carrying the per-category total* fields
 * @returns {number}
 */
function sumRecoverableAmounts(amounts = {}) {
    return (amounts.totalProfitabilityRecoverableAmount || 0)
        + (amounts.totalSponsoredAdsRecoverableAmount || 0)
        + (amounts.totalInventoryRecoverableAmount || 0)
        + (amounts.totalConversionRecoverableAmount || 0);
}

module.exports = {
    computeProfitabilityAmount,
    computeSponsoredAdsAmount,
    capProfitOpportunity,
    computeBuyBoxProfitImpact,
    computeInventoryUnfulfillableAmount,
    computeInventoryStrandedAmount,
    computeBuyBoxBenchmark,
    computeBuyBoxLostRevenueAmount,
    buildLtsfAmountMap,
    sumRecoverableAmounts,
    TARGET_PROFIT_MARGIN_PERCENT,
    TARGET_ACOS_PERCENT,
    BUYBOX_EXTRAPOLATION_DAYS,
    LTSF_MAX_SNAPSHOT_AGE_DAYS
};

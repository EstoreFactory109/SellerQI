/**
 * Shared formulas for computing a dollar "amount" recoverable by fixing a
 * given Profitability or Sponsored Ads error. Centralized here so the
 * target-margin / target-ACOS constants aren't duplicated across
 * DashboardCalculation.js and ProfitabilityIssuesService.js.
 */

const TARGET_PROFIT_MARGIN_PERCENT = 10;
const TARGET_ACOS_PERCENT = 40;

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
 * Unfulfillable inventory: dead capital = per-unit cost x unfulfillable units.
 * @param {Object} params
 * @param {number} params.costPerUnit - COGS per unit for this ASIN (0 if unknown)
 * @param {number} params.quantity - unfulfillable_quantity
 * @returns {number}
 */
function computeInventoryUnfulfillableAmount({ costPerUnit, quantity }) {
    return Math.max(0, (costPerUnit || 0) * (quantity || 0));
}

/**
 * Stranded inventory: capital tied up in units that can't be sold until the
 * listing issue is fixed. `quantity` here is a proxy (the ASIN's total FBA
 * quantity, since a stranded listing makes its whole inventory unsellable,
 * not just some units) rather than a native "stranded units" field, since
 * Amazon's Stranded Inventory report doesn't expose one.
 * @param {Object} params
 * @param {number} params.costPerUnit - COGS per unit for this ASIN (0 if unknown)
 * @param {number} params.quantity - proxy quantity (e.g. total FBA quantity for the ASIN)
 * @returns {number}
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
    computeInventoryUnfulfillableAmount,
    computeInventoryStrandedAmount,
    computeBuyBoxBenchmark,
    computeBuyBoxLostRevenueAmount,
    sumRecoverableAmounts,
    TARGET_PROFIT_MARGIN_PERCENT,
    TARGET_ACOS_PERCENT,
    BUYBOX_EXTRAPOLATION_DAYS
};

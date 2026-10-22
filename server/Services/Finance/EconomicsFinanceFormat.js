/**
 * EconomicsFinanceFormat
 *
 * Pure conversions from an EconomicsMetrics-shaped doc (stored, or built by
 * LiveEconomicsService from DailySkuFinance) to the figures the dashboard shows.
 *
 * They live here, not in Analyse.js, so the lightweight dashboard endpoints
 * (DashboardSummaryService) and the full pipeline (Analyse -> DashboardCalculation)
 * apply the SAME rule without the light path requiring Analyse's whole module graph.
 * A null doc means "no data": totals are null, never a fabricated 0.
 */

const logger = require('../../utils/Logger.js');

/**
 * Account totals from the doc: the sum of datewiseSales (so page load agrees with
 * a custom date filter over the same days), else the stored totals.
 *
 * @param {Object|null} economicsMetrics
 * @returns {{ totalSales: number|null, totalGrossProfit: number|null }}
 */
function sumEconomicsSales(economicsMetrics) {
    if (!economicsMetrics) return { totalSales: null, totalGrossProfit: null };

    let totalSales = 0;
    let totalGrossProfit = 0;
    if (Array.isArray(economicsMetrics.datewiseSales) && economicsMetrics.datewiseSales.length > 0) {
        economicsMetrics.datewiseSales.forEach(item => {
            totalSales += item.sales?.amount || 0;
            totalGrossProfit += item.grossProfit?.amount || 0;
        });
        // Round to 2 decimal places for consistency
        totalSales = parseFloat(totalSales.toFixed(2));
        totalGrossProfit = parseFloat(totalGrossProfit.toFixed(2));
    } else {
        // Fallback to stored value if datewiseSales not available
        totalSales = economicsMetrics.totalSales?.amount || 0;
        totalGrossProfit = economicsMetrics.grossProfit?.amount || 0;
    }
    return { totalSales, totalGrossProfit };
}

/**
 * Convert EconomicsMetrics data to legacy financeData format
 * Uses EconomicsMetrics for sales, fees, refunds but Amazon Ads API for PPC spend
 * @param {Object} economicsMetrics - EconomicsMetrics document
 * @param {number} adsPPCSpend - Total PPC spend from Amazon Ads API (primary source)
 * @returns {Object} Finance data in legacy format
 */
function convertEconomicsToFinanceFormat(economicsMetrics, adsPPCSpend = 0) {
    if (!economicsMetrics) {
        // No fresh economics and no live finance rows: "no data" (null), not $0.
        return {
            createdAt: new Date(),
            Gross_Profit: null,
            Total_Sales: null,
            ProductAdsPayment: adsPPCSpend, // Use Ads API PPC spend even if no economics data
            FBA_Fees: null,
            Storage: null,
            Amazon_Charges: null,
            Amazon_Fees: null,
            Other_Amazon_Fees: null, // Amazon fees excluding FBA fees (for Total Sales component)
            Refunds: null
        };
    }

    // Use Amazon Ads API PPC spend as PRIMARY source for ProductAdsPayment
    const ppcSpend = adsPPCSpend || 0;

    // CRITICAL: Calculate totalSales by summing datewiseSales for consistency
    // This ensures page load shows same value as custom filter for same dates
    const { totalSales } = sumEconomicsSales(economicsMetrics);
    let fbaFees = 0;
    let storageFees = 0;
    let refunds = 0;

    // Calculate fees from datewise data for consistency
    if (Array.isArray(economicsMetrics.datewiseFeesAndRefunds) && economicsMetrics.datewiseFeesAndRefunds.length > 0) {
        economicsMetrics.datewiseFeesAndRefunds.forEach(item => {
            fbaFees += item.fbaFulfillmentFee?.amount || 0;
            storageFees += item.storageFee?.amount || 0;
            refunds += item.refunds?.amount || 0;
        });
        fbaFees = parseFloat(fbaFees.toFixed(2));
        storageFees = parseFloat(storageFees.toFixed(2));
        refunds = parseFloat(refunds.toFixed(2));
    } else {
        // Fallback to stored values
        fbaFees = economicsMetrics.fbaFees?.amount || 0;
        storageFees = economicsMetrics.storageFees?.amount || 0;
        refunds = economicsMetrics.refunds?.amount || 0;
    }

    // Get Amazon fees - calculate from datewiseAmazonFees for consistency
    let amazonFees = 0;
    if (Array.isArray(economicsMetrics.datewiseAmazonFees) && economicsMetrics.datewiseAmazonFees.length > 0) {
        // PRIMARY: Calculate from datewiseAmazonFees (most accurate)
        economicsMetrics.datewiseAmazonFees.forEach(item => {
            amazonFees += item.totalAmount?.amount || 0;
        });
        amazonFees = parseFloat(amazonFees.toFixed(2));
        logger.info('Calculated amazonFees from datewiseAmazonFees', {
            amazonFees,
            dateCount: economicsMetrics.datewiseAmazonFees.length
        });
    } else {
        // Fallback 1: Get from summary level
        amazonFees = economicsMetrics.amazonFees?.amount || 0;

        // Fallback 2: Calculate from ASIN-wise data if still 0
        if (amazonFees === 0 && Array.isArray(economicsMetrics.asinWiseSales) && economicsMetrics.asinWiseSales.length > 0) {
            economicsMetrics.asinWiseSales.forEach(item => {
                amazonFees += item.amazonFees?.amount || item.totalFees?.amount || 0;
            });
            amazonFees = parseFloat(amazonFees.toFixed(2));
            logger.info('Calculated amazonFees from ASIN-wise data', {
                amazonFees,
                asinCount: economicsMetrics.asinWiseSales.length
            });
        }

        // Final fallback: use fbaFees + storageFees if still 0
        if (amazonFees === 0) {
            amazonFees = fbaFees + storageFees;
        }
    }

    // Calculate gross profit: Sales - Amazon Fees - Refunds
    // Note: PPC is subtracted in frontend for display, not in backend calculation
    const grossProfit = totalSales - amazonFees - refunds;

    // Calculate Other Amazon Fees = Total Amazon Fees - FBA Fees (for Total Sales component)
    const otherAmazonFees = Math.max(0, amazonFees - fbaFees);

    return {
        createdAt: economicsMetrics.createdAt || new Date(),
        Gross_Profit: parseFloat(grossProfit.toFixed(2)),
        Total_Sales: totalSales,
        ProductAdsPayment: ppcSpend, // PRIMARY: Amazon Ads API PPC spend
        FBA_Fees: fbaFees,
        Storage: storageFees,
        Amazon_Charges: amazonFees, // Total Amazon fees (for Profitability page)
        Amazon_Fees: amazonFees, // Total Amazon fees (FBA, storage, referral, etc.)
        Other_Amazon_Fees: parseFloat(otherAmazonFees.toFixed(2)), // Amazon fees excluding FBA (for Total Sales component)
        Refunds: refunds
    };
}

/**
 * The dashboard's date-wise sales series from the doc, in the shape the
 * TotalSales chart reads: [{ date, sales: {amount, currencyCode}, grossProfit, unitsSold }].
 * [] when there is no doc. Days carry no unit count when built from
 * DailySkuFinance, so unitsSold is null there rather than 0.
 *
 * @param {Object|null} economicsMetrics
 * @returns {Array}
 */
function toDatewiseSalesSeries(economicsMetrics) {
    if (!economicsMetrics || !Array.isArray(economicsMetrics.datewiseSales)) return [];
    return economicsMetrics.datewiseSales.map(day => ({
        date: day.date,
        sales: day.sales || null,
        grossProfit: day.grossProfit || null,
        unitsSold: day.unitsSold ?? null,
    }));
}

module.exports = {
    sumEconomicsSales,
    convertEconomicsToFinanceFormat,
    toDatewiseSalesSeries,
};

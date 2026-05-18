/**
 * Date-wise per-ASIN PPC spend + sales aggregation from ProductWiseSponsoredAdsItem.
 */

const mongoose = require('mongoose');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const { resolveReportDateRange } = require('../../utils/reportDateRange.js');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function attachDerivedMetrics(row) {
    const totalSpend = row.totalSpend || 0;
    const totalSales = row.totalSales || 0;
    const totalClicks = row.totalClicks || 0;
    const totalImpressions = row.totalImpressions || 0;
    const totalPurchases = row.totalPurchases || 0;

    return {
        date: row.date,
        asin: row.asin,
        totalSpend: round2(totalSpend),
        totalSales: round2(totalSales),
        totalClicks,
        totalImpressions,
        totalPurchases,
        totalUnitsSold: row.totalUnitsSold || 0,
        acos: totalSales > 0 ? round2((totalSpend / totalSales) * 100) : 0,
        roas: totalSpend > 0 ? round2(totalSales / totalSpend) : 0,
        ctr: totalImpressions > 0 ? round2((totalClicks / totalImpressions) * 100) : 0,
        cpc: totalClicks > 0 ? round2(totalSpend / totalClicks) : 0,
        conversionRate: totalClicks > 0 ? round2((totalPurchases / totalClicks) * 100) : 0,
    };
}

/**
 * @param {string} userId
 * @param {string} country
 * @param {string} region
 * @param {string|null} startDate YYYY-MM-DD (optional with endDate)
 * @param {string|null} endDate YYYY-MM-DD (optional with startDate)
 * @returns {Promise<{ dateRange: { startDate: string, endDate: string, isCustom: boolean }, rows: object[], rowCount: number }>}
 */
async function getAsinDailyAggregation(userId, country, region, startDate = null, endDate = null) {
    if (!userId || !country || !region) {
        throw new Error('userId, country, and region are required');
    }

    const userIdStr = String(userId).trim();
    if (!mongoose.Types.ObjectId.isValid(userIdStr)) {
        throw new Error(`Invalid userId: ${userId}`);
    }

    const normalizedCountry = String(country).trim().toUpperCase();
    const normalizedRegion = String(region).trim().toUpperCase();

    const { startDate: resolvedStart, endDate: resolvedEnd, isCustom } = resolveReportDateRange({
        startDate,
        endDate,
    });

    const rawRows = await ProductWiseSponsoredAdsItem.aggregateByAsinAndDate(
        userIdStr,
        normalizedCountry,
        normalizedRegion,
        resolvedStart,
        resolvedEnd
    );

    const rows = (rawRows || []).map(attachDerivedMetrics);

    return {
        dateRange: {
            startDate: resolvedStart,
            endDate: resolvedEnd,
            isCustom,
        },
        rowCount: rows.length,
        rows,
    };
}

module.exports = {
    getAsinDailyAggregation,
    attachDerivedMetrics,
};

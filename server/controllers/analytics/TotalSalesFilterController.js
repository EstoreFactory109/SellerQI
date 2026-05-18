/**
 * TotalSalesFilterController.js
 * 
 * Controller for filtering total sales component values from SalesOnlyMetrics model
 * Supports:
 * - Last 30 days: Returns total values from latest document
 * - Last 7 days: Gets datewise values from latest document, sums them
 * - Custom range: Checks all documents, gets datewise values for range, sums them
 */

const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const SalesOnlyMetrics = require('../../models/MCP/SalesOnlyMetricsModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');

/**
 * Filter total sales data based on date range
 * GET /api/total-sales/filter?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&periodType=last30|last31|last7|custom
 */
const filterTotalSales = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    let { startDate, endDate, periodType = 'last30' } = req.query;
    
    // Handle case where periodType is sent as string "undefined"
    if (periodType === 'undefined' || !periodType) {
        periodType = 'last30';
    }

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    // Validate dates for custom range
    if (periodType === 'custom' && (!startDate || !endDate)) {
        throw new ApiError(400, 'startDate and endDate are required for custom range');
    }

    try {
        let result = {};

        if (periodType === 'last31' || periodType === 'last30') {
            // Last 30 days: Return total values from recent documents (also accepts last31 for backward compat)
            result = await getLast31DaysData(userId, country, region);
        } else if (periodType === 'last7') {
            // Last 7 days: Get datewise values from latest document, sum them
            // Use dates from frontend if provided, otherwise calculate default
            result = await getLast7DaysData(userId, country, region, startDate, endDate);
        } else if (periodType === 'last14') {
            // Last 14 days: same pattern as last7 — delegate to custom if dates provided
            result = await getLast14DaysData(userId, country, region, startDate, endDate);
        } else if (periodType === 'custom') {
            // Custom range: Check all documents, get datewise values for range, sum them
            result = await getCustomRangeData(userId, country, region, startDate, endDate);
        } else {
            throw new ApiError(400, 'Invalid periodType. Must be: last31, last30, last7, last14, or custom');
        }

        logger.info('Total sales filter completed', {
            userId,
            country,
            region,
            periodType,
            startDate,
            endDate,
            resultKeys: Object.keys(result)
        });

        return res.status(200).json(
            new ApiResponse(200, result, 'Total sales data filtered successfully')
        );
    } catch (error) {
        logger.error('Error filtering total sales', {
            userId,
            country,
            region,
            periodType,
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
});

/**
 * Get last 31 days data - aggregate from per-day documents.
 * Uses the model's getRecentDays method for efficiency.
 */
async function getLast31DaysData(userId, country, region) {
    const recentData = await SalesOnlyMetrics.getRecentDays(userId, region, country, 31);

    if (!recentData || recentData.datewiseSales.length === 0) {
        logger.warn('No sales-only metrics found for last 31 days', { userId, country, region });
        return createEmptyResult();
    }

    const { startDate, endDate } = recentData.dateRange;
    if (!startDate || !endDate) {
        return createEmptyResult();
    }

    return await getCustomRangeData(userId, country, region, startDate, endDate);
}

/**
 * Get last 7 days data - get datewise values from latest document, sum them
 * Uses dates from frontend if provided, otherwise calculates default (7 days ending yesterday)
 * 
 * IMPORTANT: When custom dates are provided (startDateParam, endDateParam), this function
 * delegates to getCustomRangeData to ensure all historical documents are queried.
 * This is necessary because the "7 days" filter with custom dates might need data
 * from multiple documents (e.g., historical date ranges).
 * 
 * All totals are calculated by summing datewise values for consistency.
 */
async function getLast7DaysData(userId, country, region, startDateParam = null, endDateParam = null) {
    // If custom dates are provided, delegate to getCustomRangeData for full historical support
    // This ensures we query ALL documents, not just the latest one
    if (startDateParam && endDateParam) {
        logger.info('7-day filter with custom dates - delegating to getCustomRangeData for historical data support', {
            userId,
            country,
            region,
            startDate: startDateParam,
            endDate: endDateParam
        });
        return await getCustomRangeData(userId, country, region, startDateParam, endDateParam);
    }
    
    // Default behavior: Calculate last 7 days from yesterday.
    let startDate, endDate;
    
    // Default: Calculate last 7 days date range (6 days before yesterday to yesterday)
    endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); // Yesterday
    endDate.setHours(23, 59, 59, 999);
    startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6); // 6 days before yesterday = 7 days total
    startDate.setHours(0, 0, 0, 0);

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);
    return await getCustomRangeData(userId, country, region, startDateStr, endDateStr);
}

/**
 * Get last 14 days data — same pattern as getLast7DaysData.
 * Delegates to getCustomRangeData when custom dates are provided.
 */
async function getLast14DaysData(userId, country, region, startDateParam = null, endDateParam = null) {
    if (startDateParam && endDateParam) {
        return await getCustomRangeData(userId, country, region, startDateParam, endDateParam);
    }

    let startDate, endDate;
    endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);
    startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 13);
    startDate.setHours(0, 0, 0, 0);

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);
    return await getCustomRangeData(userId, country, region, startDateStr, endDateStr);
}

async function getTotalSalesFilteredData(userId, country, region, { periodType = 'last30', startDate = null, endDate = null } = {}) {
    if (periodType === 'last31' || periodType === 'last30') {
        return getLast31DaysData(userId, country, region);
    }
    if (periodType === 'last7') {
        return getLast7DaysData(userId, country, region, startDate, endDate);
    }
    if (periodType === 'last14') {
        return getLast14DaysData(userId, country, region, startDate, endDate);
    }
    if (periodType === 'custom') {
        if (!startDate || !endDate) {
            throw new Error('startDate and endDate are required for custom periodType');
        }
        return getCustomRangeData(userId, country, region, startDate, endDate);
    }
    throw new Error('Invalid periodType. Must be: last31, last30, last7, last14, or custom');
}

/**
 * Get custom range data - use aggregation on per-day documents.
 * Each SalesOnlyMetrics document represents a single day.
 */
async function getCustomRangeData(userId, country, region, startDateStr, endDateStr) {
    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    const salesData = await SalesOnlyMetrics.getSalesForDateRange(
        userId,
        region,
        country,
        startDateStr,
        endDateStr
    );

    if (!salesData || salesData.datewiseSales.length === 0) {
        logger.warn('No sales-only metrics found for custom range', { userId, country, region, startDateStr, endDateStr });
        return createEmptyResult();
    }

    logger.info('Processing custom date range from per-day documents', {
        userId,
        country,
        region,
        requestedRange: { startDate: startDateStr, endDate: endDateStr },
        daysFound: salesData.datewiseSales.length
    });

    const totalSales = salesData.totalSales?.amount || 0;
    const currencyCode = salesData.totalSales?.currencyCode || 'USD';

    let totalPpcSpent = await getDatewisePPCSpend(userId, country, region, startDateStr, endDateStr);

    const datewiseChartData = salesData.datewiseSales.map((item) => {
        const itemDate = new Date(item.date);
        const displayDate = itemDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return {
            date: displayDate,
            totalSales: item.sales?.amount || 0,
            grossProfit: item.grossProfit?.amount || 0,
            originalDate: item.date
        };
    }).sort((a, b) => new Date(a.originalDate) - new Date(b.originalDate));

    return {
        totalSales: { amount: parseFloat(totalSales.toFixed(2)), currencyCode },
        grossProfit: { amount: 0, currencyCode },
        ppcSpent: { amount: parseFloat(totalPpcSpent.toFixed(2)), currencyCode },
        fbaFees: { amount: 0, currencyCode },
        amazonFees: { amount: 0, currencyCode },
        otherAmazonFees: { amount: 0, currencyCode },
        refunds: { amount: 0, currencyCode },
        dateRange: {
            startDate: formatDate(startDate),
            endDate: formatDate(endDate)
        },
        datewiseChartData: datewiseChartData,
        asinWiseSales: [],
        currencyCode
    };
}

/**
 * Get actual datewise PPC spend from PPCMetrics model
 * Uses the calculateMetricsForDateRange method which searches ALL documents
 * and sums actual datewise spend values for the requested date range.
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<number>} Total PPC spend for the date range
 */
async function getDatewisePPCSpend(userId, country, region, startDate, endDate) {
    try {
        // Use PPCMetrics model's calculateMetricsForDateRange to get actual datewise PPC
        const ppcResult = await PPCMetrics.calculateMetricsForDateRange(
            userId,
            country,
            region,
            startDate,
            endDate
        );
        
        if (ppcResult && ppcResult.found && ppcResult.summary?.totalSpend > 0) {
            logger.info('Got actual datewise PPC spend from PPCMetrics', {
                userId,
                country,
                region,
                startDate,
                endDate,
                totalSpend: ppcResult.summary.totalSpend,
                daysWithData: ppcResult.numberOfDays
            });
            return ppcResult.summary.totalSpend;
        }
        
        return 0;
    } catch (error) {
        logger.warn('Error fetching datewise PPC spend, will use fallback', {
            userId,
            country,
            region,
            startDate,
            endDate,
            error: error.message
        });
        return 0;
    }
}

/**
 * Calculate proportional PPC spent for last 7 days (fallback when no datewise PPC data)
 */
function calculateProportionalPPC(totalPpcSpent, filteredDays, totalDays) {
    if (totalDays === 0) return 0;
    return (totalPpcSpent * filteredDays) / totalDays;
}

/**
 * Calculate overlap days between two date ranges
 */
function calculateOverlapDays(range1Start, range1End, range2Start, range2End) {
    const overlapStart = new Date(Math.max(range1Start.getTime(), range2Start.getTime()));
    const overlapEnd = new Date(Math.min(range1End.getTime(), range2End.getTime()));
    
    if (overlapStart > overlapEnd) return 0;
    
    return Math.ceil((overlapEnd - overlapStart + 1) / (1000 * 60 * 60 * 24));
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Create empty result structure
 */
function createEmptyResult() {
    return {
        totalSales: { amount: 0, currencyCode: 'USD' },
        grossProfit: { amount: 0, currencyCode: 'USD' },
        ppcSpent: { amount: 0, currencyCode: 'USD' },
        fbaFees: { amount: 0, currencyCode: 'USD' },
        amazonFees: { amount: 0, currencyCode: 'USD' }, // Total Amazon fees (for Profitability page)
        otherAmazonFees: { amount: 0, currencyCode: 'USD' }, // Amazon fees excluding FBA (for Total Sales component)
        refunds: { amount: 0, currencyCode: 'USD' },
        dateRange: { startDate: null, endDate: null },
        asinWiseSales: [], // Empty ASIN-wise data
        currencyCode: 'USD'
    };
}

module.exports = {
    filterTotalSales,
    getTotalSalesFilteredData,
};


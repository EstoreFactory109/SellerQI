/**
 * TotalSalesFilterController.js
 * 
 * Controller for filtering total sales component values from EconomicsMetrics model
 * Supports:
 * - Last 30 days: Returns total values from latest document
 * - Last 7 days: Gets datewise values from latest document, sums them
 * - Custom range: Checks all documents, gets datewise values for range, sums them
 */

const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');

/**
 * Filter total sales data based on date range
 * GET /api/total-sales/filter?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&periodType=last30|last7|custom
 */
const filterTotalSales = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { startDate, endDate, periodType = 'last30' } = req.query;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    // Validate dates for custom range
    if (periodType === 'custom' && (!startDate || !endDate)) {
        throw new ApiError(400, 'startDate and endDate are required for custom range');
    }

    try {
        let result = {};

        if (periodType === 'last30') {
            // Last 30 days: Return total values from latest document
            result = await getLast30DaysData(userId, country, region);
        } else if (periodType === 'last7') {
            // Last 7 days: Get datewise values from latest document, sum them
            result = await getLast7DaysData(userId, country, region);
        } else if (periodType === 'custom') {
            // Custom range: Check all documents, get datewise values for range, sum them
            result = await getCustomRangeData(userId, country, region, startDate, endDate);
        } else {
            throw new ApiError(400, 'Invalid periodType. Must be: last30, last7, or custom');
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
 * Get last 30 days data - return total values from latest document
 */
async function getLast30DaysData(userId, country, region) {
    // Get the latest economics metrics document
    const latestMetrics = await EconomicsMetrics.findOne({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!latestMetrics) {
        logger.warn('No economics metrics found for last 30 days', { userId, country, region });
        return createEmptyResult();
    }

    // Return total values from the document
    return {
        totalSales: latestMetrics.totalSales || { amount: 0, currencyCode: 'USD' },
        grossProfit: latestMetrics.grossProfit || { amount: 0, currencyCode: 'USD' },
        ppcSpent: latestMetrics.ppcSpent || { amount: 0, currencyCode: 'USD' },
        fbaFees: latestMetrics.fbaFees || { amount: 0, currencyCode: 'USD' },
        storageFees: latestMetrics.storageFees || { amount: 0, currencyCode: 'USD' },
        refunds: latestMetrics.refunds || { amount: 0, currencyCode: 'USD' },
        dateRange: latestMetrics.dateRange || { startDate: null, endDate: null },
        currencyCode: latestMetrics.totalSales?.currencyCode || 'USD'
    };
}

/**
 * Get last 7 days data - get datewise values from latest document, sum them
 * Note: Calendar sends 8 days ago to 1 day ago (8 days total), but we'll use the actual range
 */
async function getLast7DaysData(userId, country, region) {
    // Calculate last 7 days date range (8 days ago to yesterday, as per calendar component)
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); // Yesterday
    endDate.setHours(23, 59, 59, 999);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 8); // 8 days ago
    startDate.setHours(0, 0, 0, 0);

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    // Get the latest economics metrics document
    const latestMetrics = await EconomicsMetrics.findOne({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!latestMetrics) {
        logger.warn('No economics metrics found for last 7 days', { userId, country, region });
        return createEmptyResult();
    }

    // Get datewise data from the document
    const datewiseSales = latestMetrics.datewiseSales || [];
    const datewiseFeesAndRefunds = latestMetrics.datewiseFeesAndRefunds || [];

    // Filter and sum data for last 7 days
    const filteredSales = datewiseSales.filter(item => {
        const itemDate = new Date(item.date);
        return itemDate >= startDate && itemDate <= endDate;
    });

    const filteredFeesAndRefunds = datewiseFeesAndRefunds.filter(item => {
        const itemDate = new Date(item.date);
        return itemDate >= startDate && itemDate <= endDate;
    });

    // Sum up the values
    let totalSales = 0;
    let totalGrossProfit = 0;
    let totalFbaFees = 0;
    let totalStorageFees = 0;
    let totalRefunds = 0;
    let currencyCode = latestMetrics.totalSales?.currencyCode || 'USD';

    filteredSales.forEach(item => {
        totalSales += item.sales?.amount || 0;
        totalGrossProfit += item.grossProfit?.amount || 0;
    });

    filteredFeesAndRefunds.forEach(item => {
        totalFbaFees += item.fbaFulfillmentFee?.amount || 0;
        totalStorageFees += item.storageFee?.amount || 0;
        totalRefunds += item.refunds?.amount || 0;
    });

    // Get PPC spent from datewise data if available, otherwise use total
    // Note: PPC spent might not be in datewise data, so we'll need to calculate proportionally
    const totalPpcSpent = calculateProportionalPPC(
        latestMetrics.ppcSpent?.amount || 0,
        filteredSales.length,
        datewiseSales.length
    );

    // Prepare datewise data for chart
    // Use existing grossProfit from datewiseSales (already calculated as netSales - cogs)
    const datewiseChartData = filteredSales.map(item => {
        const itemDate = new Date(item.date);
        const dateKey = itemDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        return {
            date: dateKey,
            totalSales: item.sales?.amount || 0,
            grossProfit: item.grossProfit?.amount || 0, // Use existing grossProfit from database (netSales - cogs)
            originalDate: item.date
        };
    });

    return {
        totalSales: { amount: totalSales, currencyCode },
        grossProfit: { amount: totalGrossProfit, currencyCode },
        ppcSpent: { amount: totalPpcSpent, currencyCode },
        fbaFees: { amount: totalFbaFees, currencyCode },
        storageFees: { amount: totalStorageFees, currencyCode },
        refunds: { amount: totalRefunds, currencyCode },
        dateRange: {
            startDate: startDateStr,
            endDate: endDateStr
        },
        datewiseChartData: datewiseChartData,
        currencyCode
    };
}

/**
 * Get custom range data - check all documents, get datewise values for range, sum them
 */
async function getCustomRangeData(userId, country, region, startDateStr, endDateStr) {
    // Parse dates
    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    // Get all economics metrics documents for this user, country, and region
    const allMetrics = await EconomicsMetrics.find({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!allMetrics || allMetrics.length === 0) {
        logger.warn('No economics metrics found for custom range', { userId, country, region });
        return createEmptyResult();
    }

    // Aggregate data from all documents that overlap with the date range
    let totalSales = 0;
    let totalGrossProfit = 0;
    let totalFbaFees = 0;
    let totalStorageFees = 0;
    let totalRefunds = 0;
    let totalPpcSpent = 0;
    let currencyCode = 'USD';
    const processedDates = new Set(); // Track processed dates to avoid duplicates

    for (const metrics of allMetrics) {
        // Check if document's date range overlaps with requested range
        const docStartDate = new Date(metrics.dateRange?.startDate);
        const docEndDate = new Date(metrics.dateRange?.endDate);
        docStartDate.setHours(0, 0, 0, 0);
        docEndDate.setHours(23, 59, 59, 999);

        // Check for overlap
        if (startDate <= docEndDate && endDate >= docStartDate) {
            // Get currency code from first document
            if (!currencyCode && metrics.totalSales?.currencyCode) {
                currencyCode = metrics.totalSales.currencyCode;
            }

            // Process datewise sales
            const datewiseSales = metrics.datewiseSales || [];
            datewiseSales.forEach(item => {
                const itemDate = new Date(item.date);
                const dateKey = itemDate.toISOString().split('T')[0];

                // Only process if within range and not already processed
                if (itemDate >= startDate && itemDate <= endDate && !processedDates.has(dateKey)) {
                    totalSales += item.sales?.amount || 0;
                    totalGrossProfit += item.grossProfit?.amount || 0;
                    processedDates.add(dateKey);
                }
            });

            // Process datewise fees and refunds
            const datewiseFeesAndRefunds = metrics.datewiseFeesAndRefunds || [];
            datewiseFeesAndRefunds.forEach(item => {
                const itemDate = new Date(item.date);
                const dateKey = itemDate.toISOString().split('T')[0];

                // Only process if within range
                if (itemDate >= startDate && itemDate <= endDate) {
                    totalFbaFees += item.fbaFulfillmentFee?.amount || 0;
                    totalStorageFees += item.storageFee?.amount || 0;
                    totalRefunds += item.refunds?.amount || 0;
                }
            });

            // Calculate proportional PPC spent based on date range overlap
            const overlapDays = calculateOverlapDays(startDate, endDate, docStartDate, docEndDate);
            const docTotalDays = Math.ceil((docEndDate - docStartDate + 1) / (1000 * 60 * 60 * 24));
            if (docTotalDays > 0) {
                const proportion = overlapDays / docTotalDays;
                totalPpcSpent += (metrics.ppcSpent?.amount || 0) * proportion;
            }
        }
    }

    // Prepare datewise data for chart - aggregate by date across all documents
    const datewiseChartDataMap = new Map();
    const processedChartDates = new Set();
    
    for (const metrics of allMetrics) {
        const docStartDate = new Date(metrics.dateRange?.startDate);
        const docEndDate = new Date(metrics.dateRange?.endDate);
        docStartDate.setHours(0, 0, 0, 0);
        docEndDate.setHours(23, 59, 59, 999);

        // Check for overlap
        if (startDate <= docEndDate && endDate >= docStartDate) {
            const datewiseSales = metrics.datewiseSales || [];
            const datewiseFeesAndRefunds = metrics.datewiseFeesAndRefunds || [];
            
            // Process sales - use existing grossProfit from datewiseSales
            // The grossProfit in datewiseSales is already calculated correctly (netSales - cogs)
            datewiseSales.forEach(item => {
                const itemDate = new Date(item.date);
                const dateKey = itemDate.toISOString().split('T')[0];
                
                if (itemDate >= startDate && itemDate <= endDate && !processedChartDates.has(dateKey)) {
                    const displayDate = itemDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    datewiseChartDataMap.set(dateKey, {
                        date: displayDate,
                        totalSales: item.sales?.amount || 0,
                        grossProfit: item.grossProfit?.amount || 0, // Use existing grossProfit from database
                        originalDate: item.date
                    });
                    processedChartDates.add(dateKey);
                }
            });
        }
    }
    
    const datewiseChartData = Array.from(datewiseChartDataMap.values())
        .sort((a, b) => new Date(a.originalDate) - new Date(b.originalDate));

    return {
        totalSales: { amount: totalSales, currencyCode },
        grossProfit: { amount: totalGrossProfit, currencyCode },
        ppcSpent: { amount: totalPpcSpent, currencyCode },
        fbaFees: { amount: totalFbaFees, currencyCode },
        storageFees: { amount: totalStorageFees, currencyCode },
        refunds: { amount: totalRefunds, currencyCode },
        dateRange: {
            startDate: formatDate(startDate),
            endDate: formatDate(endDate)
        },
        datewiseChartData: datewiseChartData,
        currencyCode
    };
}

/**
 * Calculate proportional PPC spent for last 7 days
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
        storageFees: { amount: 0, currencyCode: 'USD' },
        refunds: { amount: 0, currencyCode: 'USD' },
        dateRange: { startDate: null, endDate: null },
        currencyCode: 'USD'
    };
}

module.exports = {
    filterTotalSales
};


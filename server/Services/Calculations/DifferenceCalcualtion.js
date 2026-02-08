const getv2SellerPerformanceReportModel = require('../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Calculate the percentage difference in ahrScore between last month and current month
 * OPTIMIZED: Uses only 2 aggregation queries instead of 8+ debug queries
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Difference calculation result
 */
const differenceCalculation = async (userId, country, region) => {
    const now = new Date();
    
    // Calculate the last full month date range
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    startOfLastMonth.setHours(0, 0, 0, 0);
    
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    endOfLastMonth.setHours(23, 59, 59, 999);

    // Calculate current month date range (from 1st till today)
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfCurrentMonth.setHours(0, 0, 0, 0);
    
    const endOfCurrentMonth = new Date(now);
    endOfCurrentMonth.setHours(23, 59, 59, 999);

    try {
        // OPTIMIZED: Use aggregation to get averages in a single query each
        // This replaces 8+ separate queries with just 2 efficient ones
        const [lastMonthResult, currentMonthResult] = await Promise.all([
            // Last month average
            getv2SellerPerformanceReportModel.aggregate([
                {
                    $match: {
                        User: typeof userId === 'string' ? require('mongoose').Types.ObjectId.createFromHexString(userId) : userId,
                        region,
                        country,
                        createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
                        ahrScore: { $ne: null, $exists: true }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgScore: { $avg: '$ahrScore' },
                        count: { $sum: 1 }
                    }
                }
            ]),
            // Current month average
            getv2SellerPerformanceReportModel.aggregate([
                {
                    $match: {
                        User: typeof userId === 'string' ? require('mongoose').Types.ObjectId.createFromHexString(userId) : userId,
                        region,
                        country,
                        createdAt: { $gte: startOfCurrentMonth, $lte: endOfCurrentMonth },
                        ahrScore: { $ne: null, $exists: true }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgScore: { $avg: '$ahrScore' },
                        count: { $sum: 1 }
                    }
                }
            ])
        ]);

        const lastMonthAverage = lastMonthResult[0]?.avgScore || 0;
        const lastMonthCount = lastMonthResult[0]?.count || 0;
        const currentMonthAverage = currentMonthResult[0]?.avgScore || 0;
        const currentMonthCount = currentMonthResult[0]?.count || 0;

        // Check if we have valid data for both months
        if (lastMonthCount === 0) {
            return {
                success: false,
                message: 'No valid ahrScore data found for the last full month',
                percentageDifference: 0,
                lastMonthAverage: 0,
                currentMonthAverage: Math.round(currentMonthAverage * 100) / 100,
                dateRanges: {
                    lastMonth: {
                        startDate: startOfLastMonth.toISOString().split('T')[0],
                        endDate: endOfLastMonth.toISOString().split('T')[0]
                    },
                    currentMonth: {
                        startDate: startOfCurrentMonth.toISOString().split('T')[0],
                        endDate: endOfCurrentMonth.toISOString().split('T')[0]
                    }
                }
            };
        }

        if (currentMonthCount === 0) {
            return {
                success: false,
                message: 'No valid ahrScore data found for the current month',
                percentageDifference: 0,
                lastMonthAverage: Math.round(lastMonthAverage * 100) / 100,
                currentMonthAverage: 0,
                dateRanges: {
                    lastMonth: {
                        startDate: startOfLastMonth.toISOString().split('T')[0],
                        endDate: endOfLastMonth.toISOString().split('T')[0]
                    },
                    currentMonth: {
                        startDate: startOfCurrentMonth.toISOString().split('T')[0],
                        endDate: endOfCurrentMonth.toISOString().split('T')[0]
                    }
                }
            };
        }

        // Calculate percentage difference: (currentMonthAvg - lastMonthAvg) / lastMonthAvg * 100
        const percentageDifference = ((currentMonthAverage - lastMonthAverage) / lastMonthAverage) * 100;

        return {
            success: true,
            message: 'Percentage difference calculated successfully',
            percentageDifference: Math.round(percentageDifference * 100) / 100,
            lastMonthAverage: Math.round(lastMonthAverage * 100) / 100,
            currentMonthAverage: Math.round(currentMonthAverage * 100) / 100,
            dateRanges: {
                lastMonth: {
                    startDate: startOfLastMonth.toISOString().split('T')[0],
                    endDate: endOfLastMonth.toISOString().split('T')[0]
                },
                currentMonth: {
                    startDate: startOfCurrentMonth.toISOString().split('T')[0],
                    endDate: endOfCurrentMonth.toISOString().split('T')[0]
                }
            },
            recordCounts: {
                lastMonth: { total: lastMonthCount, validScores: lastMonthCount },
                currentMonth: { total: currentMonthCount, validScores: currentMonthCount }
            }
        };
    } catch (error) {
        logger.error('Error in differenceCalculation:', { error: error.message, userId, country, region });
        // Return a safe default on error
        return {
            success: false,
            message: 'Error calculating difference',
            percentageDifference: 0,
            lastMonthAverage: 0,
            currentMonthAverage: 0
        };
    }
}

module.exports = differenceCalculation;

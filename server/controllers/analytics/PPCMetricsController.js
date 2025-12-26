/**
 * PPC Metrics Controller
 * 
 * Provides endpoints for fetching PPC metrics from the PPCMetrics model.
 * Supports date-wise filtering for dashboards and graphs.
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Get latest PPC metrics for a user
 * Used by: Main Dashboard (PPC spend, ACOS), PPC Dashboard
 */
const getLatestPPCMetrics = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;

    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'userId, country, and region are required')
        );
    }

    try {
        logger.info(`Fetching latest PPC metrics for user: ${userId}, country: ${country}, region: ${region}`);

        const metrics = await PPCMetrics.findLatestForUser(userId, country, region);

        if (!metrics) {
            logger.info(`No PPC metrics found for user: ${userId}`);
            return res.status(200).json(
                new ApiResponse(200, {
                    found: false,
                    data: null,
                    message: 'No PPC metrics data available. Data will be populated after your first PPC sync.'
                }, 'No PPC metrics found')
            );
        }

        logger.info(`Found PPC metrics for user: ${userId}, date range: ${metrics.dateRange?.startDate} to ${metrics.dateRange?.endDate}`);

        return res.status(200).json(
            new ApiResponse(200, {
                found: true,
                data: {
                    dateRange: metrics.dateRange,
                    summary: metrics.summary,
                    campaignTypeBreakdown: metrics.campaignTypeBreakdown,
                    dateWiseMetrics: metrics.dateWiseMetrics,
                    processedCampaignTypes: metrics.processedCampaignTypes,
                    lastUpdated: metrics.updatedAt
                }
            }, 'PPC metrics retrieved successfully')
        );

    } catch (error) {
        logger.error('Error fetching PPC metrics:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching PPC metrics: ${error.message}`)
        );
    }
});

/**
 * Get PPC metrics filtered by date range
 * Used by: Date-wise filtering on dashboards
 */
const getPPCMetricsByDateRange = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { startDate, endDate } = req.query;

    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'userId, country, and region are required')
        );
    }

    try {
        logger.info(`Fetching PPC metrics for user: ${userId}, date range: ${startDate || 'latest'} to ${endDate || 'latest'}`);

        let metrics;

        if (startDate && endDate) {
            // Try to find exact date range match first
            metrics = await PPCMetrics.findByDateRange(userId, country, region, startDate, endDate);
            
            // If no exact match, get latest and filter dateWiseMetrics
            if (!metrics) {
                metrics = await PPCMetrics.findLatestForUser(userId, country, region);
                
                if (metrics && metrics.dateWiseMetrics) {
                    // Filter dateWiseMetrics to the requested range
                    const filteredDateWise = metrics.dateWiseMetrics.filter(item => {
                        const itemDate = new Date(item.date);
                        const start = new Date(startDate);
                        const end = new Date(endDate);
                        return itemDate >= start && itemDate <= end;
                    });

                    // Recalculate summary for filtered data
                    const filteredSummary = calculateSummaryFromDateWise(filteredDateWise);

                    return res.status(200).json(
                        new ApiResponse(200, {
                            found: true,
                            isFiltered: true,
                            data: {
                                dateRange: { startDate, endDate },
                                summary: filteredSummary,
                                campaignTypeBreakdown: metrics.campaignTypeBreakdown,
                                dateWiseMetrics: filteredDateWise,
                                processedCampaignTypes: metrics.processedCampaignTypes,
                                lastUpdated: metrics.updatedAt,
                                originalDateRange: metrics.dateRange
                            }
                        }, 'PPC metrics filtered successfully')
                    );
                }
            }
        } else {
            // No date range specified, get latest
            metrics = await PPCMetrics.findLatestForUser(userId, country, region);
        }

        if (!metrics) {
            return res.status(200).json(
                new ApiResponse(200, {
                    found: false,
                    data: null,
                    message: 'No PPC metrics data available.'
                }, 'No PPC metrics found')
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                found: true,
                isFiltered: false,
                data: {
                    dateRange: metrics.dateRange,
                    summary: metrics.summary,
                    campaignTypeBreakdown: metrics.campaignTypeBreakdown,
                    dateWiseMetrics: metrics.dateWiseMetrics,
                    processedCampaignTypes: metrics.processedCampaignTypes,
                    lastUpdated: metrics.updatedAt
                }
            }, 'PPC metrics retrieved successfully')
        );

    } catch (error) {
        logger.error('Error fetching PPC metrics by date range:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching PPC metrics: ${error.message}`)
        );
    }
});

/**
 * Get PPC metrics for graph/chart display
 * Returns date-wise data formatted for charts
 */
const getPPCMetricsForGraph = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { startDate, endDate, metrics: requestedMetrics } = req.query;

    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'userId, country, and region are required')
        );
    }

    try {
        logger.info(`Fetching PPC graph data for user: ${userId}`);

        const ppcMetrics = await PPCMetrics.findLatestForUser(userId, country, region);

        if (!ppcMetrics || !ppcMetrics.dateWiseMetrics) {
            return res.status(200).json(
                new ApiResponse(200, {
                    found: false,
                    graphData: [],
                    message: 'No PPC metrics data available for graph.'
                }, 'No PPC graph data found')
            );
        }

        let dateWiseData = ppcMetrics.dateWiseMetrics;

        // Filter by date range if provided
        if (startDate && endDate) {
            dateWiseData = dateWiseData.filter(item => {
                const itemDate = new Date(item.date);
                const start = new Date(startDate);
                const end = new Date(endDate);
                return itemDate >= start && itemDate <= end;
            });
        }

        // Format data for charts
        const graphData = dateWiseData.map(item => ({
            date: formatDateForDisplay(item.date),
            rawDate: item.date,
            ppcSales: item.sales || 0,
            spend: item.spend || 0,
            acos: item.acos || 0,
            tacos: calculateTacos(item.spend, item.sales, ppcMetrics.summary?.totalSales),
            impressions: item.impressions || 0,
            clicks: item.clicks || 0,
            ctr: item.ctr || 0,
            cpc: item.cpc || 0,
            roas: item.roas || 0
        }));

        return res.status(200).json(
            new ApiResponse(200, {
                found: true,
                graphData: graphData,
                dateRange: {
                    startDate: dateWiseData[0]?.date || startDate,
                    endDate: dateWiseData[dateWiseData.length - 1]?.date || endDate
                },
                summary: ppcMetrics.summary
            }, 'PPC graph data retrieved successfully')
        );

    } catch (error) {
        logger.error('Error fetching PPC graph data:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching PPC graph data: ${error.message}`)
        );
    }
});

/**
 * Get all PPC metrics records for a user (for history/comparison)
 */
const getPPCMetricsHistory = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { limit = 10 } = req.query;

    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'userId, country, and region are required')
        );
    }

    try {
        const metricsHistory = await PPCMetrics.find({ userId, country, region })
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .select('dateRange summary createdAt updatedAt')
            .lean();

        return res.status(200).json(
            new ApiResponse(200, {
                count: metricsHistory.length,
                history: metricsHistory
            }, 'PPC metrics history retrieved successfully')
        );

    } catch (error) {
        logger.error('Error fetching PPC metrics history:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching PPC metrics history: ${error.message}`)
        );
    }
});

// Helper function to calculate summary from dateWise data
function calculateSummaryFromDateWise(dateWiseMetrics) {
    if (!dateWiseMetrics || dateWiseMetrics.length === 0) {
        return {
            totalSales: 0,
            totalSpend: 0,
            totalImpressions: 0,
            totalClicks: 0,
            overallAcos: 0,
            overallRoas: 0,
            ctr: 0,
            cpc: 0
        };
    }

    const totals = dateWiseMetrics.reduce((acc, day) => ({
        totalSales: acc.totalSales + (day.sales || 0),
        totalSpend: acc.totalSpend + (day.spend || 0),
        totalImpressions: acc.totalImpressions + (day.impressions || 0),
        totalClicks: acc.totalClicks + (day.clicks || 0)
    }), { totalSales: 0, totalSpend: 0, totalImpressions: 0, totalClicks: 0 });

    return {
        ...totals,
        overallAcos: totals.totalSales > 0 
            ? parseFloat(((totals.totalSpend / totals.totalSales) * 100).toFixed(2)) 
            : 0,
        overallRoas: totals.totalSpend > 0 
            ? parseFloat((totals.totalSales / totals.totalSpend).toFixed(2)) 
            : 0,
        ctr: totals.totalImpressions > 0 
            ? parseFloat(((totals.totalClicks / totals.totalImpressions) * 100).toFixed(2)) 
            : 0,
        cpc: totals.totalClicks > 0 
            ? parseFloat((totals.totalSpend / totals.totalClicks).toFixed(2)) 
            : 0
    };
}

// Helper function to format date for display
function formatDateForDisplay(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Helper function to calculate TACOS
function calculateTacos(spend, ppcSales, totalSales) {
    // TACOS = Ad Spend / Total Sales * 100
    // If we don't have total sales, use PPC sales as fallback
    const salesForTacos = totalSales || ppcSales || 0;
    if (salesForTacos === 0) return 0;
    return parseFloat(((spend / salesForTacos) * 100).toFixed(2));
}

module.exports = {
    getLatestPPCMetrics,
    getPPCMetricsByDateRange,
    getPPCMetricsForGraph,
    getPPCMetricsHistory
};


/**
 * PPC Units Sold Controller
 * 
 * Handles API requests for PPC units sold data with date filtering
 * Simplified to only use 1-day attribution (units sold within 1 day of click)
 */

const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const PPCUnitsSold = require('../../models/amazon-ads/PPCUnitsSoldModel.js');

/**
 * Get latest PPC units sold data
 * Returns total units sold (1-day attribution)
 */
const getLatestPPCUnitsSold = asyncHandler(async (req, res) => {
    const userId = req.userId?.toString() || req.userId;
    const country = req.country;
    const region = req.region;

    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, "User ID, country, and region are required")
        );
    }

    logger.info(`Fetching latest PPC units sold for user: ${userId}, country: ${country}, region: ${region}`);

    const unitsData = await PPCUnitsSold.findLatestForUser(userId, country, region);

    if (!unitsData) {
        logger.info(`No PPC units sold data found for user: ${userId}`);
        return res.status(200).json(
            new ApiResponse(200, {
                found: false,
                data: null,
                message: "No PPC units sold data available. Data will be populated after your first PPC sync."
            }, "No PPC units sold found")
        );
    }

    logger.info(`Found PPC units sold for user: ${userId}, total units: ${unitsData.totalUnits}`);

    return res.status(200).json(
        new ApiResponse(200, {
            found: true,
            data: {
                dateRange: unitsData.dateRange,
                totalUnits: unitsData.totalUnits,
                summary: unitsData.summary,
                dateWiseUnits: unitsData.dateWiseUnits
            }
        }, "PPC units sold retrieved successfully")
    );
});

/**
 * Get PPC units sold data filtered by date range
 * Simply sums up units for all days in the selected range
 */
const getPPCUnitsSoldByDateRange = asyncHandler(async (req, res) => {
    const userId = req.userId?.toString() || req.userId;
    const country = req.country;
    const region = req.region;
    const { startDate, endDate } = req.query;

    logger.info("=== getPPCUnitsSoldByDateRange called ===", {
        userId,
        country,
        region,
        startDate,
        endDate
    });

    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, "User ID, country, and region are required")
        );
    }

    if (!startDate || !endDate) {
        return res.status(400).json(
            new ApiError(400, "Start date and end date are required")
        );
    }

    // Use the model's static method to calculate units for the date range
    const result = await PPCUnitsSold.calculateUnitsForDateRange(
        userId, 
        country, 
        region, 
        startDate, 
        endDate
    );

    logger.info("calculateUnitsForDateRange result:", {
        hasResult: !!result,
        totalUnits: result?.totalUnits,
        dateWiseUnitsCount: result?.dateWiseUnits?.length || 0
    });

    if (!result) {
        logger.warn("No PPC units sold data found for date range");
        return res.status(200).json(
            new ApiResponse(200, {
                found: false,
                data: null,
                message: "No PPC units sold data available for the specified date range"
            })
        );
    }

    return res.status(200).json(
        new ApiResponse(200, {
            found: true,
            data: {
                dateRange: result.dateRange,
                totalUnits: result.totalUnits,
                summary: result.summary,
                dateWiseUnits: result.dateWiseUnits,
                numberOfDays: result.numberOfDays
            }
        }, "PPC units sold by date range retrieved successfully")
    );
});

/**
 * Get units sold summary for dashboard KPI display
 */
const getPPCUnitsSoldSummary = asyncHandler(async (req, res) => {
    const userId = req.userId?.toString() || req.userId;
    const country = req.country;
    const region = req.region;
    const { startDate, endDate } = req.query;

    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, "User ID, country, and region are required")
        );
    }

    let result;

    if (startDate && endDate) {
        result = await PPCUnitsSold.calculateUnitsForDateRange(
            userId, 
            country, 
            region, 
            startDate, 
            endDate
        );
    } else {
        result = await PPCUnitsSold.findLatestForUser(userId, country, region);
    }

    if (!result) {
        return res.status(200).json(
            new ApiResponse(200, {
                found: false,
                data: {
                    totalUnits: 0,
                    averageDailyUnits: 0
                }
            })
        );
    }

    return res.status(200).json(
        new ApiResponse(200, {
            found: true,
            data: {
                totalUnits: result.totalUnits || result.summary?.totalUnits || 0,
                averageDailyUnits: result.summary?.averageDailyUnits || 0,
                totalSales: result.summary?.totalSales || 0,
                totalSpend: result.summary?.totalSpend || 0,
                dateRange: result.dateRange
            }
        }, "PPC units sold summary retrieved successfully")
    );
});

module.exports = {
    getLatestPPCUnitsSold,
    getPPCUnitsSoldByDateRange,
    getPPCUnitsSoldSummary
};

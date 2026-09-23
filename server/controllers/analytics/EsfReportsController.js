/**
 * ESF Reports Controller
 *
 * Serves Estore Factory > Reports inside a client's account.
 * Access is gated by the esfClientOnly middleware on the route.
 */
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { getEsfReports } = require('../../Services/Calculations/EsfReportsService.js');

/**
 * GET /api/pagewise/esf/reports
 *
 * Returns every recurring report type with its latest edition computed live
 * from the collections that back it. Reports with no data behind them come
 * back with `available: false` rather than placeholder numbers.
 */
const getEsfReportsData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;

    if (!userId || !country || !region) {
        logger.error('[EsfReports] Missing required parameters', { userId, country, region });
        return res.status(400).json(new ApiError(400, 'User ID, Country, and Region are required'));
    }

    try {
        const data = await getEsfReports(userId, country, region);
        return res.status(200).json(new ApiResponse(200, data, 'Reports retrieved successfully'));
    } catch (error) {
        logger.error('[EsfReports] Error building reports:', error);
        return res.status(500).json(new ApiError(500, `Error fetching reports: ${error.message}`));
    }
});

module.exports = { getEsfReportsData };

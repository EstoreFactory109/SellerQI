/**
 * ESF Client Dashboard Controller
 *
 * Serves the ESF-only dashboard shown inside a client's account.
 * Access is gated by the esfClientOnly middleware on the route.
 */
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { getClientDashboard } = require('../../Services/Calculations/EsfClientDashboardService.js');

/**
 * GET /api/pagewise/esf/client-dashboard
 *
 * Query params (all optional, YYYY-MM-DD):
 *   - startDate / endDate               the selected window (default: last 30 days ending yesterday)
 *   - compareStartDate / compareEndDate the comparison window (default: the preceding equal-length period)
 */
const getEsfClientDashboard = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;

    if (!userId || !country || !region) {
        logger.error('[EsfClientDashboard] Missing required parameters', { userId, country, region });
        return res.status(400).json(new ApiError(400, 'User ID, Country, and Region are required'));
    }

    try {
        const data = await getClientDashboard(userId, country, region, {
            startDate: req.query.startDate || null,
            endDate: req.query.endDate || null,
            compareStartDate: req.query.compareStartDate || null,
            compareEndDate: req.query.compareEndDate || null,
        });

        return res.status(200).json(new ApiResponse(200, data, 'Client dashboard data retrieved successfully'));
    } catch (error) {
        logger.error('[EsfClientDashboard] Error building dashboard:', error);
        return res.status(500).json(new ApiError(500, `Error fetching client dashboard: ${error.message}`));
    }
});

module.exports = { getEsfClientDashboard };

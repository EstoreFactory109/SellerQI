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
const { getEsfReports, getEsfReportRows, getEsfReportHistory } = require('../../Services/Calculations/EsfReportsService.js');

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

/**
 * GET /api/pagewise/esf/reports/:reportKey/rows?page=1&limit=10
 *
 * One page of a single report's table. The card payload carries only the first
 * screenful, so this is what the preview panel walks through.
 */
const getEsfReportRowsData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;

    if (!userId || !country || !region) {
        logger.error('[EsfReports] Missing required parameters', { userId, country, region });
        return res.status(400).json(new ApiError(400, 'User ID, Country, and Region are required'));
    }

    try {
        const data = await getEsfReportRows(userId, country, region, req.params.reportKey, {
            page: req.query.page,
            limit: req.query.limit,
        });

        // null means the key is not one of ours — a 404 rather than an empty page,
        // so a typo in the URL is not mistaken for a report with no rows.
        if (!data) {
            return res.status(404).json(new ApiError(404, `Unknown report: ${req.params.reportKey}`));
        }

        return res.status(200).json(new ApiResponse(200, data, 'Report rows retrieved successfully'));
    } catch (error) {
        logger.error('[EsfReports] Error fetching report rows:', error);
        return res.status(500).json(new ApiError(500, `Error fetching report rows: ${error.message}`));
    }
});

/**
 * GET /api/pagewise/esf/reports/:reportKey/history
 *
 * Every captured edition of one report, newest first, for the Report History
 * page.
 */
const getEsfReportHistoryData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;

    if (!userId || !country || !region) {
        logger.error('[EsfReports] Missing required parameters', { userId, country, region });
        return res.status(400).json(new ApiError(400, 'User ID, Country, and Region are required'));
    }

    try {
        const data = await getEsfReportHistory(userId, country, region, req.params.reportKey);
        if (!data) {
            return res.status(404).json(new ApiError(404, `Unknown report: ${req.params.reportKey}`));
        }
        return res.status(200).json(new ApiResponse(200, data, 'Report history retrieved successfully'));
    } catch (error) {
        logger.error('[EsfReports] Error fetching report history:', error);
        return res.status(500).json(new ApiError(500, `Error fetching report history: ${error.message}`));
    }
});

module.exports = { getEsfReportsData, getEsfReportRowsData, getEsfReportHistoryData };

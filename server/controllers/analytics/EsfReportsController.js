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
const { getEsfReportRows, getEsfReportHistory } = require('../../Services/Calculations/EsfReportsService.js');
const { getEsfAccountReports, getEsfAccountReport, listMarketplaces, ownsMarketplace } = require('../../Services/Calculations/EsfAccountReportsService.js');
const { MAX_PDF_ROWS } = require('../../Services/Reports/reportPdf.js');

/**
 * The marketplace a per-marketplace request is about: the one named in the
 * query when it is the user's own, else the one selected in the app.
 *
 * The Reports page is account-wide, so its tables name their marketplace
 * explicitly. Anything else in ?country is ignored rather than trusted: this
 * must never become a way to read another seller's marketplace.
 */
const resolveMarketplace = async (req) => {
    const country = String(req.query.country || '').toUpperCase();
    const region = String(req.query.region || '').toUpperCase();
    if (country && region && await ownsMarketplace(req.userId, country, region)) return { country, region };
    return { country: req.country, region: req.region };
};

/**
 * GET /api/pagewise/esf/reports
 *
 * Every recurring report type for the WHOLE account: each report covers every
 * connected marketplace, whichever one is selected in the app. Reports with no
 * data behind them come back with `available: false` rather than placeholder
 * numbers.
 */
const getEsfReportsData = asyncHandler(async (req, res) => {
    const userId = req.userId;

    if (!userId) {
        logger.error('[EsfReports] Missing user');
        return res.status(400).json(new ApiError(400, 'User ID is required'));
    }

    try {
        const data = await getEsfAccountReports(userId);
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
    const { country, region } = await resolveMarketplace(req);

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
    const { country, region } = await resolveMarketplace(req);

    if (!userId || !country || !region) {
        logger.error('[EsfReports] Missing required parameters', { userId, country, region });
        return res.status(400).json(new ApiError(400, 'User ID, Country, and Region are required'));
    }

    try {
        const data = await getEsfReportHistory(userId, country, region, req.params.reportKey);
        if (!data) {
            return res.status(404).json(new ApiError(404, `Unknown report: ${req.params.reportKey}`));
        }
        // Every marketplace the account has, so the page can offer the others.
        const marketplaces = await listMarketplaces(userId);
        return res.status(200).json(new ApiResponse(200, { ...data, marketplaces }, 'Report history retrieved successfully'));
    } catch (error) {
        logger.error('[EsfReports] Error fetching report history:', error);
        return res.status(500).json(new ApiError(500, `Error fetching report history: ${error.message}`));
    }
});

/**
 * GET /api/pagewise/esf/reports/:reportKey/document
 *
 * One report for the whole account at the depth of the emailed PDF (40 rows
 * per table), for Download. The page payload carries a 10-row preview per
 * marketplace; printing that would save a quarter of what the email holds.
 */
const getEsfReportDocumentData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required'));
    }
    try {
        const data = await getEsfAccountReport(userId, req.params.reportKey, { rowLimit: MAX_PDF_ROWS });
        if (!data) {
            return res.status(404).json(new ApiError(404, `Unknown report: ${req.params.reportKey}`));
        }
        return res.status(200).json(new ApiResponse(200, data, 'Report document retrieved successfully'));
    } catch (error) {
        logger.error('[EsfReports] Error building report document:', error);
        return res.status(500).json(new ApiError(500, `Error building report document: ${error.message}`));
    }
});

module.exports = { getEsfReportsData, getEsfReportRowsData, getEsfReportHistoryData, getEsfReportDocumentData };

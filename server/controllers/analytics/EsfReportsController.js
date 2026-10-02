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
    if (req.country && req.region) return { country: req.country, region: req.region };

    /*
     * Last resort: the account's own primary marketplace.
     *
     * The cookie used to be the end of the line, and getLocation guaranteed it by answering
     * 401 when it was missing — which is how a client who had not connected Amazon yet got a
     * dead Reports page instead of an empty one. The route now admits them (see
     * getLocationOptional), so this has to resolve the marketplace itself.
     *
     * Reading it from the Seller record is also more correct than the cookie was: these
     * reports are account-wide, and the cookie only ever carried whichever marketplace the
     * app happened to have selected. A client with no marketplace at all gets {} here, and
     * the callers below answer with the same empty shape the rest of the page uses.
     */
    const [primary] = await listMarketplaces(req.userId);
    return primary ? { country: primary.country, region: primary.region } : {};
};

/** The payload a per-marketplace route returns when the account has no marketplace yet. */
const noMarketplace = (reportKey) => ({
    key: reportKey,
    available: false,
    reason: 'No marketplace is connected to this account yet.',
    rows: [],
    columns: [],
});

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

    if (!userId) {
        return res.status(400).json(new ApiResponse(400, '', 'User ID is required'));
    }
    /*
     * No marketplace is a legitimate state, not a bad request: a client who has not connected
     * Amazon yet has none. Answering 400 here is what made the Reports page fail outright on
     * day one, so this returns the same "nothing to show" shape every other ESF page uses.
     */
    if (!country || !region) {
        return res.status(200).json(new ApiResponse(200, noMarketplace(req.params.reportKey),
            'No marketplace is connected to this account yet'));
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

    if (!userId) {
        return res.status(400).json(new ApiResponse(400, '', 'User ID is required'));
    }
    /*
     * No marketplace is a legitimate state, not a bad request: a client who has not connected
     * Amazon yet has none. Answering 400 here is what made the Reports page fail outright on
     * day one, so this returns the same "nothing to show" shape every other ESF page uses.
     */
    if (!country || !region) {
        return res.status(200).json(new ApiResponse(200, noMarketplace(req.params.reportKey),
            'No marketplace is connected to this account yet'));
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

/**
 * GET /api/pagewise/esf/reports/next
 *
 * Just the "your next reports arrive on ..." block, for the Overview card.
 *
 * It is its own endpoint because Overview has no reports fetch of its own, and the
 * alternatives were both worse. Putting it on /esf/project-status would make a cheap route
 * fan out across eight collections for one stat card. Having Overview call /esf/reports would
 * do the same and throw the rest away. This returns the one object both surfaces render, and
 * the full Reports payload carries an identical copy, so the page and its summary cannot
 * disagree about what they say.
 */
const getEsfNextReport = asyncHandler(async (req, res) => {
    try {
        const { nextReport } = await getEsfAccountReports(req.userId);
        return res.status(200).json(new ApiResponse(200, nextReport, 'Next report fetched successfully'));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfReports] next report failed: ${error.message}`));
        /*
         * A card is not worth an error state. The client renders nothing for a null answer,
         * which is the same thing it does while the request is in flight.
         */
        return res.status(200).json(new ApiResponse(200, null, 'Next report is unavailable'));
    }
});

module.exports = {
    getEsfReportsData,
    getEsfReportRowsData,
    getEsfReportHistoryData,
    getEsfReportDocumentData,
    getEsfNextReport,
};

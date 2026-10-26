/**
 * GET /api/pagewise/dashboard-marketplaces — the Dashboard's "All marketplaces" view: every
 * connected marketplace side by side, each in its own currency. See
 * Services/Calculations/MarketplaceComparisonService.js.
 *
 * Query:
 *   hintCurrency  optional ISO code for the faint "≈" comparison hint (default USD; "none" turns it off)
 *   startDate/endDate  optional YYYY-MM-DD custom range applied to every marketplace
 *
 * Behind ALL_MARKETPLACES_DASHBOARD_ENABLED (default off → 404) so it can ship dark.
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const { SUPPORTED_CURRENCY_CODES } = require('../../utils/marketplaceCurrency.js');
const { getMarketplaceComparison } = require('../../Services/Calculations/MarketplaceComparisonService.js');

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const getMarketplaceComparisonData = asyncHandler(async (req, res) => {
    if (process.env.ALL_MARKETPLACES_DASHBOARD_ENABLED !== 'true') {
        return res.status(404).json(new ApiResponse(404, '', 'Not found'));
    }

    const rawHint = String(req.query.hintCurrency || 'USD').toUpperCase();
    let hintCurrency = null;
    if (rawHint !== 'NONE') {
        if (!SUPPORTED_CURRENCY_CODES.includes(rawHint)) {
            return res.status(400).json(new ApiResponse(400, '', `hintCurrency must be "none" or one of ${SUPPORTED_CURRENCY_CODES.join(', ')}`));
        }
        hintCurrency = rawHint;
    }

    const { startDate, endDate } = req.query;
    let range = null;
    if (startDate || endDate) {
        if (!YMD.test(String(startDate || '')) || !YMD.test(String(endDate || '')) || startDate > endDate) {
            return res.status(400).json(new ApiResponse(400, '', 'startDate and endDate must be YYYY-MM-DD with startDate <= endDate'));
        }
        range = { startDate, endDate };
    }

    try {
        const data = await getMarketplaceComparison(req.userId, { hintCurrency, range });
        return res.status(200).json(new ApiResponse(200, data, 'Marketplace comparison'));
    } catch (error) {
        logger.error('[MarketplaceComparison] request failed', { userId: req.userId, error: error.message, stack: error.stack });
        return res.status(500).json(new ApiResponse(500, '', 'Could not load your marketplaces'));
    }
});

module.exports = { getMarketplaceComparisonData };

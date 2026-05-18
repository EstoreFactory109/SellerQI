/**
 * Product-wise ASIN daily PPC aggregation (spend + sales by date).
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const ProductWiseAsinDailyService = require('../../Services/Calculations/ProductWiseAsinDailyService.js');

/**
 * GET /api/pagewise/ppc/asin-daily
 *
 * Query params:
 *   - startDate (optional, YYYY-MM-DD) — must be paired with endDate
 *   - endDate   (optional, YYYY-MM-DD)
 *
 * Returns one row per ASIN per date (SP + SD merged across campaigns).
 */
const getAsinDailyAggregation = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    if (!userId || !Country || !Region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, Country, and Region are required')
        );
    }

    try {
        logger.info(
            `[ProductWiseAsinDaily] user=${userId} country=${Country} region=${Region} start=${startDate || '(default)'} end=${endDate || '(default)'}`
        );

        const result = await ProductWiseAsinDailyService.getAsinDailyAggregation(
            userId,
            Country,
            Region,
            startDate,
            endDate
        );

        logger.info(
            `[ProductWiseAsinDaily] returned ${result.rowCount} rows in ${Date.now() - startTime}ms`
        );

        return res.status(200).json(
            new ApiResponse(200, result, 'ASIN daily PPC aggregation retrieved successfully')
        );
    } catch (error) {
        logger.error('[ProductWiseAsinDaily] Error:', error);
        const status = error.message?.includes('Invalid') || error.message?.includes('must be')
            ? 400
            : 500;
        return res.status(status).json(
            new ApiError(status, error.message || 'Error fetching ASIN daily aggregation')
        );
    }
});

module.exports = {
    getAsinDailyAggregation,
};

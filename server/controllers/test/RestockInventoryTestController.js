/**
 * Restock Inventory Recommendations Test Controller
 *
 * Test endpoint to manually trigger the SP-API GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT
 * 
 * Endpoint: POST /api/test/restock-inventory
 * Body: { userId, region, country }
 */

const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');

const { Integration } = require('../../Services/main/Integration.js');
const getRestockInventoryReport = require('../../Services/Sp_API/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT.js');

/**
 * Helper to fetch SP-API access token, marketplaceIds, baseURI for user/region/country
 */
const resolveSpApiContext = async (userId, region, country) => {
    // Validate inputs using Integration helper
    const validation = await Integration.validateInputs(userId, region, country);
    if (!validation.success) {
        throw new ApiError(validation.statusCode || 400, validation.error || 'Invalid inputs');
    }

    // Get region configuration (marketplace IDs, base URI)
    const regionConfigResult = Integration.getConfiguration(region, country);
    if (!regionConfigResult.success) {
        throw new ApiError(
            regionConfigResult.statusCode || 400,
            regionConfigResult.error || 'Failed to load region configuration'
        );
    }

    // Get seller account data and tokens
    const sellerConfig = await Integration.getSellerDataAndTokens(userId, region, country);
    if (!sellerConfig.success) {
        throw new ApiError(
            sellerConfig.statusCode || 400,
            sellerConfig.error || 'Failed to load seller account / tokens'
        );
    }

    // Generate SP-API access token
    const tokensResult = await Integration.generateTokens(
        userId,
        sellerConfig.RefreshToken,
        null,
        null
    );

    const AccessToken = tokensResult.AccessToken;

    if (!AccessToken) {
        throw new ApiError(400, tokensResult.error || 'Failed to generate SP-API access token');
    }

    return {
        accessToken: AccessToken,
        marketplaceIds: regionConfigResult.marketplaceIds,
        baseURI: regionConfigResult.Base_URI
    };
};

/**
 * Validate request body
 */
const validateBody = (req) => {
    const { userId, region, country } = req.body;

    if (!userId) {
        throw new ApiError(400, 'userId is required');
    }
    if (!region) {
        throw new ApiError(400, 'region is required (NA, EU, FE)');
    }
    if (!country) {
        throw new ApiError(400, 'country is required (e.g. US, CA, UK)');
    }

    return { userId, region, country };
};

/**
 * POST /api/test/restock-inventory
 * 
 * Test endpoint to fetch restock inventory recommendations report
 * 
 * Request Body:
 * {
 *   "userId": "user_id_here",
 *   "region": "NA",
 *   "country": "US"
 * }
 * 
 * Response:
 * - 200: Report executed successfully with products and recommended replenishment quantities
 * - 400: Validation error (missing userId, region, or country)
 * - 502: Report generation failed
 */
const testRestockInventoryReport = asyncHandler(async (req, res) => {
    const { userId, region, country } = validateBody(req);

    logger.info('Test GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT triggered', {
        userId,
        region,
        country
    });

    const startTime = Date.now();

    // Resolve SP-API context (access token, marketplace IDs, base URI)
    const { accessToken, marketplaceIds, baseURI } = await resolveSpApiContext(
        userId,
        region,
        country
    );

    logger.info('SP-API context resolved', {
        userId,
        marketplaceIds,
        baseURI,
        hasAccessToken: !!accessToken
    });

    // Execute the report
    const result = await getRestockInventoryReport(
        accessToken,
        marketplaceIds,
        userId,
        baseURI,
        country,
        region
    );

    const duration = Date.now() - startTime;

    // Handle error responses
    if (result && result.success === false) {
        logger.error('Restock Inventory report failed', {
            userId,
            region,
            country,
            message: result.message,
            durationMs: duration
        });

        return res.status(502).json(
            new ApiResponse(
                502,
                { ...result, durationMs: duration },
                `Restock Inventory Recommendations report failed: ${result.message || 'Unknown error'}`
            )
        );
    }

    if (!result) {
        logger.error('Restock Inventory report returned null/false', {
            userId,
            region,
            country,
            durationMs: duration
        });

        return res.status(502).json(
            new ApiResponse(
                502,
                { durationMs: duration },
                'Restock Inventory Recommendations report returned null/false'
            )
        );
    }

    // Success response
    const productCount = result.Products ? result.Products.length : 0;

    logger.info('Restock Inventory report executed successfully', {
        userId,
        region,
        country,
        productCount,
        durationMs: duration
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                productCount,
                durationMs: duration,
                data: result
            },
            'Restock Inventory Recommendations report executed successfully'
        )
    );
});

module.exports = {
    testRestockInventoryReport
};


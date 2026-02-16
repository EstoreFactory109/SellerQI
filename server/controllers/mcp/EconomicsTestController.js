/**
 * Economics Test Controller
 *
 * Simple test endpoint to fetch and store MCP economics data for a user.
 * Accepts userId, region, country, and optional refreshToken.
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const LoggingHelper = require('../../utils/LoggingHelper.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const {
    fetchAndStoreEconomicsData
} = require('../../Services/MCP/MCPEconomicsIntegration.js');
const {
    getLatestEconomicsMetrics
} = require('../../Services/MCP/EconomicsMetricsService.js');

/**
 * POST /api/test/mcp-economics/fetch
 * Body: { userId, region, country, refreshToken? }
 */
const testFetchEconomicsData = asyncHandler(async (req, res) => {
    const { userId, region, country, refreshToken } = req.body;

    if (!userId) {
        const error = new ApiError(400, 'userId is required');
        return res.status(400).json({
            statusCode: error.statusCode,
            message: error.message,
            errors: error.errors || []
        });
    }

    if (!region || !country) {
        const error = new ApiError(400, 'region and country are required');
        return res.status(400).json({
            statusCode: error.statusCode,
            message: error.message,
            errors: error.errors || []
        });
    }

    let finalRefreshToken = refreshToken;

    try {
        if (!finalRefreshToken) {
            logger.info('RefreshToken not provided; fetching from Seller model', {
                userId,
                region,
                country
            });

            // Load Seller document for this user
            const sellerDoc = await Seller.findOne({ User: userId }).lean();

            if (!sellerDoc) {
                const error = new ApiError(
                    404,
                    'No seller account found for this user in Seller model.'
                );
                return res.status(404).json({
                    statusCode: error.statusCode,
                    message: error.message,
                    errors: error.errors || []
                });
            }

            const accounts = Array.isArray(sellerDoc.sellerAccount)
                ? sellerDoc.sellerAccount
                : [];

            // Try to find matching region + country inside sellerAccount array
            let matchedAccount = accounts.find(
                (acc) => acc && acc.country === country && acc.region === region
            );

            // Track if we used fallback
            let usedFallback = false;

            // If not found, fall back to first available account for this user
            if (!matchedAccount && accounts.length > 0) {
                logger.warn(
                    'No sellerAccount entry found for exact region/country; falling back to first sellerAccount for user',
                    {
                        userId,
                        requestedRegion: region,
                        requestedCountry: country,
                        availableAccounts: accounts.map((a) => ({
                            country: a.country,
                            region: a.region,
                            hasSpApiToken: !!a.spiRefreshToken
                        }))
                    }
                );
                matchedAccount = accounts[0];
                usedFallback = true;
            }

            if (!matchedAccount || !matchedAccount.spiRefreshToken) {
                const error = new ApiError(
                    404,
                    'spiRefreshToken not found in Seller.sellerAccount for this user. Provide refreshToken in body or ensure seller account has spiRefreshToken.'
                );
                return res.status(404).json({
                    statusCode: error.statusCode,
                    message: error.message,
                    errors: error.errors || []
                });
            }

            finalRefreshToken = matchedAccount.spiRefreshToken;

            // IMPORTANT: If we used fallback, use the matched account's region/country
            // to avoid mismatch between refresh token and API endpoint
            if (usedFallback) {
                logger.warn(
                    'Using matched account region/country instead of requested values',
                    {
                        requestedRegion: region,
                        requestedCountry: country,
                        actualRegion: matchedAccount.region,
                        actualCountry: matchedAccount.country
                    }
                );
                // Override with matched account's values
                req.body.region = matchedAccount.region;
                req.body.country = matchedAccount.country;
            }
        }

        // Use the (potentially updated) region/country from req.body
        const effectiveRegion = req.body.region || region;
        const effectiveCountry = req.body.country || country;

        logger.info('Testing MCP economics fetch', { userId, region: effectiveRegion, country: effectiveCountry });

        const result = await fetchAndStoreEconomicsData(
            userId,
            finalRefreshToken,
            effectiveRegion,
            effectiveCountry
        );

        if (!result.success) {
            logger.error('MCP economics fetch failed', {
                userId,
                region: effectiveRegion,
                country: effectiveCountry,
                error: result.error
            });
            
            // Log error to MongoDB for tracking
            await LoggingHelper.logStandaloneError({
                userId,
                region: effectiveRegion,
                country: effectiveCountry,
                functionName: 'fetchAndStoreEconomicsData',
                error: result.error || 'Economics fetch failed',
                source: 'MCP_ECONOMICS',
                additionalData: {
                    endpoint: '/api/test/mcp-economics/fetch',
                    tokenRefreshNeeded: result.error?.includes('refresh_token') || result.error?.includes('invalid grant')
                }
            });
            
            const error = new ApiError(500, result.error || 'Economics fetch failed');
            return res.status(500).json({
                statusCode: error.statusCode,
                message: error.message,
                errors: error.errors || []
            });
        }

        // Verify data persisted
        const stored = await getLatestEconomicsMetrics(userId, effectiveRegion, effectiveCountry);

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    data: result.data,
                    storedInDatabase: !!stored,
                    databaseId: stored?._id || null
                },
                result.message || 'Economics data fetched and stored successfully',
                {
                    timestamp: new Date().toISOString(),
                    effectiveRegion,
                    effectiveCountry
                }
            )
        );
    } catch (error) {
        const effectiveRegion = req.body.region || region;
        const effectiveCountry = req.body.country || country;
        
        logger.error('Error in testFetchEconomicsData', {
            userId,
            region: effectiveRegion,
            country: effectiveCountry,
            error: error.message,
            stack: error.stack
        });
        
        // Log error to MongoDB for tracking
        await LoggingHelper.logStandaloneError({
            userId,
            region: effectiveRegion,
            country: effectiveCountry,
            functionName: 'testFetchEconomicsData',
            error,
            source: 'MCP_ECONOMICS',
            additionalData: {
                endpoint: '/api/test/mcp-economics/fetch',
                errorType: 'unexpected'
            }
        });

        const apiError = new ApiError(500, error.message || 'Unexpected error');
        return res.status(500).json({
            statusCode: apiError.statusCode,
            message: apiError.message,
            errors: apiError.errors || []
        });
    }
});

module.exports = {
    testFetchEconomicsData
};


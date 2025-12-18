/**
 * BuyBox Test Controller
 * 
 * Controller for testing BuyBox data fetching and retrieval
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { fetchAndStoreBuyBoxData, getBuyBoxData } = require('../../Services/MCP/MCPBuyBoxIntegration.js');
const { getBuyBoxDataByDateRange, getLatestBuyBoxData } = require('../../Services/MCP/BuyBoxService.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Test endpoint to fetch and store BuyBox data from MCP
 * POST /api/test/buybox/fetch
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc",
 *   "startDate": "YYYY-MM-DD" (optional, defaults to 30 days ago),
 *   "endDate": "YYYY-MM-DD" (optional, defaults to today)
 * }
 */
const testFetchBuyBoxData = asyncHandler(async (req, res) => {
    logger.info('BuyBox fetch endpoint called', { body: req.body });
    
    // Get all data from POST body
    const { userId, region, country, startDate, endDate, refreshToken } = req.body;

    // Validate required parameters
    if (!userId) {
        const error = new ApiError(400, 'User ID is required in request body');
        return res.status(400).json({
            statusCode: error.statusCode,
            message: error.message,
            errors: error.errors || []
        });
    }

    if (!country || !region) {
        const error = new ApiError(400, 'Country and region are required in request body');
        return res.status(400).json({
            statusCode: error.statusCode,
            message: error.message,
            errors: error.errors || []
        });
    }

    const Region = region;
    const Country = country;

    try {
        // Use refreshToken from request body, or fetch from seller account
        let finalRefreshToken = refreshToken;
        
        // Track effective region/country (may be updated if fallback is used)
        let effectiveRegion = Region;
        let effectiveCountry = Country;

        if (!finalRefreshToken) {
            logger.info('RefreshToken not provided in body, fetching from Seller account', {
                userId,
                region: Region,
                country: Country
            });
            
            // Get seller document for this user
            const sellerDoc = await Seller.findOne({ User: userId }).lean();

            if (!sellerDoc) {
                logger.error('Seller document not found', { userId });
                const error = new ApiError(404, 'No seller account found for this user.');
                return res.status(404).json({
                    statusCode: error.statusCode,
                    message: error.message,
                    errors: error.errors || []
                });
            }

            const accounts = Array.isArray(sellerDoc.sellerAccount) 
                ? sellerDoc.sellerAccount 
                : [];

            // Try to find matching region + country
            let matchedAccount = accounts.find(
                (acc) => acc && acc.country === Country && acc.region === Region
            );

            // Track if we used fallback
            let usedFallback = false;

            // If not found, fall back to first available account
            if (!matchedAccount && accounts.length > 0) {
                logger.warn(
                    'No sellerAccount entry found for exact region/country; falling back to first sellerAccount',
                    {
                        userId,
                        requestedRegion: Region,
                        requestedCountry: Country,
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
                logger.error('Seller account or refresh token not found', {
                    userId,
                    region: Region,
                    country: Country
                });
                const error = new ApiError(404, 'spiRefreshToken not found. Please provide refreshToken in request body or ensure seller account has spiRefreshToken.');
                return res.status(404).json({
                    statusCode: error.statusCode,
                    message: error.message,
                    errors: error.errors || []
                });
            }

            finalRefreshToken = matchedAccount.spiRefreshToken;

            // IMPORTANT: If we used fallback, use the matched account's region/country
            if (usedFallback) {
                logger.warn(
                    'Using matched account region/country instead of requested values',
                    {
                        requestedRegion: Region,
                        requestedCountry: Country,
                        actualRegion: matchedAccount.region,
                        actualCountry: matchedAccount.country
                    }
                );
                effectiveRegion = matchedAccount.region;
                effectiveCountry = matchedAccount.country;
            }
        }

        logger.info('Testing BuyBox data fetch', {
            userId,
            region: effectiveRegion,
            country: effectiveCountry,
            startDate,
            endDate
        });

        // Fetch and store BuyBox data
        const result = await fetchAndStoreBuyBoxData(
            userId,
            finalRefreshToken,
            effectiveRegion,
            effectiveCountry,
            startDate,
            endDate
        );

        if (!result.success) {
            logger.error('Failed to fetch and store BuyBox data', {
                userId,
                region: effectiveRegion,
                country: effectiveCountry,
                error: result.error,
                queryId: result.queryId,
                documentId: result.documentId
            });
            const error = new ApiError(500, result.error || 'Failed to fetch BuyBox data');
            return res.status(500).json({
                statusCode: error.statusCode,
                message: error.message,
                errors: error.errors || [],
                queryId: result.queryId,
                documentId: result.documentId
            });
        }

        // Verify data was stored in database
        const storedData = await getLatestBuyBoxData(userId, effectiveRegion, effectiveCountry);
        
        if (!storedData) {
            logger.warn('BuyBox data fetched but not found in database after storage', {
                userId,
                region: effectiveRegion,
                country: effectiveCountry,
                buyBoxDataId: result.data?.buyBoxDataId
            });
        } else {
            logger.info('BuyBox data verified in database', {
                userId,
                region: effectiveRegion,
                country: effectiveCountry,
                buyBoxDataId: storedData._id,
                productsWithoutBuyBox: storedData.productsWithoutBuyBox,
                totalProducts: storedData.totalProducts
            });
        }

        return res.status(200).json(
            new ApiResponse(200, {
                ...result.data,
                storedInDatabase: !!storedData,
                databaseId: storedData?._id || null,
                effectiveRegion,
                effectiveCountry
            }, 'BuyBox data fetched and stored successfully in database', {
                queryId: result.queryId,
                documentId: result.documentId,
                timestamp: new Date().toISOString()
            })
        );

    } catch (error) {
        logger.error('Error in testFetchBuyBoxData', {
            userId,
            region: effectiveRegion || Region,
            country: effectiveCountry || Country,
            error: error.message,
            stack: error.stack
        });

        const apiError = new ApiError(500, `Error fetching BuyBox data: ${error.message}`);
        return res.status(500).json({
            statusCode: apiError.statusCode,
            message: apiError.message,
            errors: apiError.errors || []
        });
    }
});

/**
 * Test endpoint to get BuyBox data from database
 * POST /api/test/buybox/get
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc",
 *   "startDate": "YYYY-MM-DD" (optional),
 *   "endDate": "YYYY-MM-DD" (optional)
 * }
 */
const testGetBuyBoxData = asyncHandler(async (req, res) => {
    // Get all data from POST body
    const { userId, region, country, startDate, endDate } = req.body;

    // Validate required parameters
    if (!userId) {
        const error = new ApiError(400, 'User ID is required in request body');
        return res.status(400).json({
            statusCode: error.statusCode,
            message: error.message,
            errors: error.errors || []
        });
    }

    if (!country || !region) {
        const error = new ApiError(400, 'Country and region are required in request body');
        return res.status(400).json({
            statusCode: error.statusCode,
            message: error.message,
            errors: error.errors || []
        });
    }

    const Region = region;
    const Country = country;

    try {

        logger.info('Testing BuyBox data retrieval', {
            userId,
            region: Region,
            country: Country,
            startDate,
            endDate
        });

        let buyBoxData;

        if (startDate && endDate) {
            // Get data by date range
            buyBoxData = await getBuyBoxDataByDateRange(userId, Region, startDate, endDate);
        } else {
            // Get latest data
            buyBoxData = await getLatestBuyBoxData(userId, Region, Country);
        }

        if (!buyBoxData) {
            const error = new ApiError(404, 'BuyBox data not found');
            return res.status(404).json({
                statusCode: error.statusCode,
                message: error.message,
                errors: error.errors || []
            });
        }

        // Convert to plain object if it's a Mongoose document
        const data = buyBoxData.toObject ? buyBoxData.toObject() : buyBoxData;

        return res.status(200).json(
            new ApiResponse(200, data, 'BuyBox data retrieved successfully')
        );

    } catch (error) {
        logger.error('Error in testGetBuyBoxData', {
            userId,
            region: Region,
            country: Country,
            error: error.message,
            stack: error.stack
        });

        const apiError = new ApiError(500, `Error retrieving BuyBox data: ${error.message}`);
        return res.status(500).json({
            statusCode: apiError.statusCode,
            message: apiError.message,
            errors: apiError.errors || []
        });
    }
});

/**
 * Test endpoint to get BuyBox summary (products without buybox count)
 * POST /api/test/buybox/summary
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc"
 * }
 */
const testGetBuyBoxSummary = asyncHandler(async (req, res) => {
    // Get all data from POST body
    const { userId, region, country } = req.body;

    // Validate required parameters
    if (!userId) {
        const error = new ApiError(400, 'User ID is required in request body');
        return res.status(400).json({
            statusCode: error.statusCode,
            message: error.message,
            errors: error.errors || []
        });
    }

    if (!country || !region) {
        const error = new ApiError(400, 'Country and region are required in request body');
        return res.status(400).json({
            statusCode: error.statusCode,
            message: error.message,
            errors: error.errors || []
        });
    }

    const Region = region;
    const Country = country;

    try {
        logger.info('Getting BuyBox summary', {
            userId,
            region: Region,
            country: Country
        });

        const buyBoxData = await getLatestBuyBoxData(userId, Region, Country);

        if (!buyBoxData) {
            return res.status(200).json(
                new ApiResponse(200, {
                    totalProducts: 0,
                    productsWithBuyBox: 0,
                    productsWithoutBuyBox: 0,
                    productsWithLowBuyBox: 0,
                    message: 'No BuyBox data available'
                }, 'BuyBox summary retrieved (no data available)')
            );
        }

        const summary = {
            totalProducts: buyBoxData.totalProducts || 0,
            productsWithBuyBox: buyBoxData.productsWithBuyBox || 0,
            productsWithoutBuyBox: buyBoxData.productsWithoutBuyBox || 0,
            productsWithLowBuyBox: buyBoxData.productsWithLowBuyBox || 0,
            dateRange: buyBoxData.dateRange || null,
            lastUpdated: buyBoxData.updatedAt || buyBoxData.createdAt,
            asinCount: buyBoxData.asinBuyBoxData?.length || 0
        };

        return res.status(200).json(
            new ApiResponse(200, summary, 'BuyBox summary retrieved successfully')
        );

    } catch (error) {
        logger.error('Error in testGetBuyBoxSummary', {
            userId,
            region: Region,
            country: Country,
            error: error.message,
            stack: error.stack
        });

        const apiError = new ApiError(500, `Error retrieving BuyBox summary: ${error.message}`);
        return res.status(500).json({
            statusCode: apiError.statusCode,
            message: apiError.message,
            errors: apiError.errors || []
        });
    }
});

module.exports = {
    testFetchBuyBoxData,
    testGetBuyBoxData,
    testGetBuyBoxSummary
};


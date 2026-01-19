/**
 * InactiveSKUIssuesTestController.js
 * 
 * Test controller for testing inactive SKU issues functionality
 * 
 * Endpoints:
 * - POST /api/test/inactive-sku-issues/test-single - Test fetching issues for a single SKU
 * - POST /api/test/inactive-sku-issues/process-all - Process all inactive SKUs for a user
 * - GET /api/test/inactive-sku-issues/view/:userId - View inactive products with issues
 * - POST /api/test/inactive-sku-issues/check - Check if issues are stored in database
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { GetListingItemIssuesForInactive } = require('../../Services/Sp_API/GetListingItemsIssues.js');
const { Integration } = require('../../Services/main/Integration.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAccessToken } = require('../../Services/Sp_API/GenerateTokens.js');
const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');
const { marketplaceConfig, spapiRegions } = require('../../controllers/config/config.js');

/**
 * Test fetching issues for a single inactive SKU
 * 
 * Request body:
 * {
 *   "userId": "user_id",
 *   "sku": "SKU_CODE",
 *   "asin": "ASIN_CODE",
 *   "country": "US",
 *   "region": "NA"
 * }
 */
const testSingleSKUIssues = asyncHandler(async (req, res) => {
    const { userId, sku, asin, country, region } = req.body;

    if (!userId || !sku || !asin || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'Missing required fields: userId, sku, asin, country, region')
        );
    }

    try {
        logger.info('[InactiveSKUIssuesTest] Testing single SKU issues fetch', {
            userId,
            sku,
            asin,
            country,
            region
        });

        // Get seller account to get credentials
        const seller = await Seller.findOne({ User: userId });
        if (!seller) {
            return res.status(404).json(
                new ApiError(404, 'Seller account not found')
            );
        }

        // Find the matching seller account
        const sellerAccount = seller.sellerAccount.find(
            acc => acc.country === country && acc.region === region
        );

        if (!sellerAccount) {
            return res.status(404).json(
                new ApiError(404, `Seller account not found for country ${country} and region ${region}`)
            );
        }

        if (!sellerAccount.spiRefreshToken) {
            return res.status(400).json(
                new ApiError(400, 'SP-API refresh token not found for this account')
            );
        }

        // Get access token - generateAccessToken requires userId and refreshToken
        const AccessToken = await generateAccessToken(userId, sellerAccount.spiRefreshToken);
        if (!AccessToken) {
            return res.status(401).json(
                new ApiError(401, 'Failed to generate access token. Check if refresh token is valid.')
            );
        }

        // Get configuration using the same method as Integration service
        const { URIs } = require('../../controllers/config/config.js');
        const Base_URI = URIs[region];
        const Marketplace_Id = marketplaceConfig[country];
        const awsRegion = spapiRegions[region];

        if (!Base_URI) {
            return res.status(400).json(
                new ApiError(400, `Unsupported region: ${region}`)
            );
        }

        if (!Marketplace_Id) {
            return res.status(400).json(
                new ApiError(400, `Unsupported country: ${country}`)
            );
        }

        if (!awsRegion) {
            return res.status(400).json(
                new ApiError(400, `No AWS region configuration for: ${region}`)
            );
        }

        const credentials = await getTemporaryCredentials(awsRegion);
        if (!credentials) {
            return res.status(500).json(
                new ApiError(500, 'Failed to get temporary credentials')
            );
        }

        // Prepare dataToSend
        const dataToSend = {
            marketplaceId: Marketplace_Id,
            AccessToken: AccessToken,
            AccessKey: credentials.AccessKey,
            SecretKey: credentials.SecretKey,
            SessionToken: credentials.SessionToken,
            issueLocale: `en_${country}`,
            SellerId: sellerAccount.selling_partner_id
        };

        // Call the API
        const result = await GetListingItemIssuesForInactive(
            dataToSend,
            sku,
            asin,
            userId,
            Base_URI,
            country,
            region
        );

        if (!result) {
            return res.status(500).json(
                new ApiError(500, 'Failed to fetch issues for SKU')
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                sku: result.sku,
                asin: result.asin,
                issues: result.issues,
                issuesCount: result.issues?.length || 0
            }, 'Successfully fetched issues for SKU')
        );

    } catch (error) {
        logger.error('[InactiveSKUIssuesTest] Error testing single SKU issues', {
            error: error.message,
            stack: error.stack,
            userId,
            sku
        });

        return res.status(500).json(
            new ApiError(500, `Error: ${error.message}`)
        );
    }
});

/**
 * Process all inactive SKUs for a user
 * 
 * Request body:
 * {
 *   "userId": "user_id",
 *   "country": "US",
 *   "region": "NA"
 * }
 */
const testProcessAllInactiveSKUs = asyncHandler(async (req, res) => {
    const { userId, country, region } = req.body;

    logger.info('[InactiveSKUIssuesTest] Request received', {
        body: req.body,
        userId: userId || 'MISSING',
        country: country || 'MISSING',
        region: region || 'MISSING'
    });

    if (!userId || !country || !region) {
        const missingFields = [];
        if (!userId) missingFields.push('userId');
        if (!country) missingFields.push('country');
        if (!region) missingFields.push('region');
        
        logger.error('[InactiveSKUIssuesTest] Missing required fields', {
            missingFields,
            received: { userId, country, region }
        });
        
        return res.status(400).json(
            new ApiError(400, `Missing required fields: ${missingFields.join(', ')}`)
        );
    }

    try {
        logger.info('[InactiveSKUIssuesTest] Processing all inactive SKUs', {
            userId,
            country,
            region
        });

        // Get seller account
        const seller = await Seller.findOne({ User: userId });
        if (!seller) {
            return res.status(404).json(
                new ApiError(404, 'Seller account not found')
            );
        }

        // Find the matching seller account
        const sellerAccount = seller.sellerAccount.find(
            acc => acc.country === country && acc.region === region
        );

        if (!sellerAccount) {
            return res.status(404).json(
                new ApiError(404, `Seller account not found for country ${country} and region ${region}`)
            );
        }

        // Extract inactive products
        const inactiveProductData = Integration.extractInactiveProductData(
            { sellerAccount: [sellerAccount] },
            country,
            region
        );

        if (inactiveProductData.inactiveSkuArray.length === 0) {
            return res.status(200).json(
                new ApiResponse(200, {
                    inactiveCount: 0,
                    message: 'No inactive SKUs found for this account'
                }, 'No inactive SKUs to process')
            );
        }

        // Get access token and credentials
        if (!sellerAccount.spiRefreshToken) {
            logger.error('[InactiveSKUIssuesTest] No refresh token found', {
                userId,
                country,
                region,
                sellerAccountKeys: Object.keys(sellerAccount || {})
            });
            const error = new ApiError(400, 'SP-API refresh token not found for this account');
            return res.status(400).json({
                statusCode: error.statusCode,
                message: error.message,
                errors: error.errors
            });
        }

        logger.info('[InactiveSKUIssuesTest] Generating access token', {
            userId,
            hasRefreshToken: !!sellerAccount.spiRefreshToken,
            refreshTokenLength: sellerAccount.spiRefreshToken?.length
        });

        let AccessToken;
        try {
            // generateAccessToken requires userId and refreshToken as parameters
            logger.info('[InactiveSKUIssuesTest] Calling generateAccessToken', {
                userId,
                hasRefreshToken: !!sellerAccount.spiRefreshToken,
                refreshTokenPrefix: sellerAccount.spiRefreshToken?.substring(0, 20) + '...',
                country,
                region
            });
            
            AccessToken = await generateAccessToken(userId, sellerAccount.spiRefreshToken);
            if (!AccessToken) {
                logger.error('[InactiveSKUIssuesTest] generateAccessToken returned null/undefined', {
                    userId,
                    country,
                    region,
                    hasRefreshToken: !!sellerAccount.spiRefreshToken,
                    refreshTokenLength: sellerAccount.spiRefreshToken?.length,
                    refreshTokenPrefix: sellerAccount.spiRefreshToken?.substring(0, 30) + '...'
                });
                
                // Return proper error format
                const error = new ApiError(401, 'Failed to generate access token. The refresh token may be invalid, expired, or not authorized for this region/country combination. Please reconnect your seller account.');
                return res.status(401).json({
                    statusCode: error.statusCode,
                    message: error.message,
                    errors: error.errors
                });
            }
            logger.info('[InactiveSKUIssuesTest] Access token generated successfully', {
                userId,
                tokenLength: AccessToken?.length
            });
        } catch (tokenError) {
            logger.error('[InactiveSKUIssuesTest] Error generating access token', {
                error: tokenError.message,
                stack: tokenError.stack,
                userId,
                errorName: tokenError.name
            });
            return res.status(401).json(
                new ApiError(401, `Failed to generate access token: ${tokenError.message}`)
            );
        }

        // Get configuration using the same method as Integration service
        const { URIs } = require('../../controllers/config/config.js');
        const Base_URI = URIs[region];
        const Marketplace_Id = marketplaceConfig[country];
        const awsRegion = spapiRegions[region];

        if (!Base_URI) {
            logger.error('[InactiveSKUIssuesTest] Invalid region', {
                region,
                availableRegions: Object.keys(URIs || {})
            });
            return res.status(400).json({
                statusCode: 400,
                message: `Unsupported region: ${region}. Available regions: ${Object.keys(URIs || {}).join(', ')}`,
                errors: []
            });
        }

        if (!Marketplace_Id) {
            logger.error('[InactiveSKUIssuesTest] Invalid country', {
                country,
                availableCountries: Object.keys(marketplaceConfig || {})
            });
            return res.status(400).json({
                statusCode: 400,
                message: `Unsupported country: ${country}. Available countries: ${Object.keys(marketplaceConfig || {}).join(', ')}`,
                errors: []
            });
        }

        if (!awsRegion) {
            logger.error('[InactiveSKUIssuesTest] Invalid region for AWS', {
                region,
                availableRegions: Object.keys(spapiRegions || {})
            });
            return res.status(400).json({
                statusCode: 400,
                message: `No AWS region configuration for: ${region}`,
                errors: []
            });
        }

        logger.info('[InactiveSKUIssuesTest] Configuration obtained', {
            country,
            region,
            marketplaceId: Marketplace_Id,
            baseUri: Base_URI,
            awsRegion
        });

        logger.info('[InactiveSKUIssuesTest] Getting temporary credentials', {
            awsRegion,
            region
        });

        let credentials;
        try {
            credentials = await getTemporaryCredentials(awsRegion);
            if (!credentials) {
                logger.error('[InactiveSKUIssuesTest] getTemporaryCredentials returned null');
                return res.status(500).json(
                    new ApiError(500, 'Failed to get temporary credentials')
                );
            }
            logger.info('[InactiveSKUIssuesTest] Temporary credentials obtained', {
                hasAccessKey: !!credentials.AccessKey,
                hasSecretKey: !!credentials.SecretKey,
                hasSessionToken: !!credentials.SessionToken
            });
        } catch (credError) {
            logger.error('[InactiveSKUIssuesTest] Error getting temporary credentials', {
                error: credError.message,
                stack: credError.stack
            });
            return res.status(500).json(
                new ApiError(500, `Failed to get temporary credentials: ${credError.message}`)
            );
        }

        // Prepare dataToSend
        const dataToSend = {
            marketplaceId: Marketplace_Id,
            AccessToken: AccessToken,
            AccessKey: credentials.AccessKey,
            SecretKey: credentials.SecretKey,
            SessionToken: credentials.SessionToken,
            issueLocale: `en_${country}`,
            SellerId: sellerAccount.selling_partner_id
        };

        logger.info('[InactiveSKUIssuesTest] Starting to process inactive SKUs', {
            inactiveCount: inactiveProductData.inactiveSkuArray.length,
            baseUri: Base_URI
        });

        // Process inactive SKUs
        const issuesDataArray = await Integration.processInactiveListingItems(
            AccessToken,
            inactiveProductData.inactiveSkuArray,
            inactiveProductData.inactiveAsinArray,
            dataToSend,
            userId,
            Base_URI,
            country,
            region,
            sellerAccount.spiRefreshToken,
            sellerAccount.adsRefreshToken || null,
            null // No logging helper for test
        );

        logger.info('[InactiveSKUIssuesTest] Completed processing inactive SKUs', {
            total: inactiveProductData.inactiveSkuArray.length,
            processed: issuesDataArray.length
        });

        return res.status(200).json(
            new ApiResponse(200, {
                totalInactiveSKUs: inactiveProductData.inactiveSkuArray.length,
                processedCount: issuesDataArray.length,
                issuesData: issuesDataArray,
                summary: {
                    total: inactiveProductData.inactiveSkuArray.length,
                    successful: issuesDataArray.length,
                    failed: inactiveProductData.inactiveSkuArray.length - issuesDataArray.length
                }
            }, 'Successfully processed inactive SKUs')
        );

    } catch (error) {
        logger.error('[InactiveSKUIssuesTest] Error processing all inactive SKUs', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region,
            errorName: error.name,
            errorCode: error.code
        });

        // Check if it's an authentication error
        if (error.message?.includes('401') || error.message?.includes('Unauthorized') || error.statusCode === 401) {
            return res.status(401).json(
                new ApiError(401, `Authentication error: ${error.message}`)
            );
        }

        return res.status(500).json(
            new ApiError(500, `Error: ${error.message}`)
        );
    }
});

/**
 * View inactive products with issues from database
 * 
 * GET /api/test/inactive-sku-issues/view/:userId?country=US&region=NA
 */
const viewInactiveProductsWithIssues = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { country, region } = req.query;

    if (!userId) {
        return res.status(400).json(
            new ApiError(400, 'userId is required')
        );
    }

    try {
        const seller = await Seller.findOne({ User: userId });
        if (!seller) {
            return res.status(404).json(
                new ApiError(404, 'Seller account not found')
            );
        }

        let sellerAccounts = seller.sellerAccount;
        
        // Filter by country/region if provided
        if (country && region) {
            sellerAccounts = sellerAccounts.filter(
                acc => acc.country === country && acc.region === region
            );
        }

        const result = sellerAccounts.map(account => {
            // Filter products with status "Inactive" or "Incomplete"
            const inactiveProducts = (account.products || []).filter(
                product => product.status === 'Inactive' || product.status === 'Incomplete'
            );

            return {
                country: account.country,
                region: account.region,
                totalProducts: account.products?.length || 0,
                inactiveProductsCount: inactiveProducts.length,
                inactiveProducts: inactiveProducts.map(product => ({
                    sku: product.sku,
                    asin: product.asin,
                    itemName: product.itemName,
                    price: product.price,
                    status: product.status,
                    issues: product.issues || [],
                    issuesCount: product.issues?.length || 0,
                    hasIssues: (product.issues?.length || 0) > 0
                }))
            };
        });

        return res.status(200).json(
            new ApiResponse(200, {
                userId,
                accounts: result,
                totalAccounts: result.length
            }, 'Inactive products retrieved successfully')
        );

    } catch (error) {
        logger.error('[InactiveSKUIssuesTest] Error viewing inactive products', {
            error: error.message,
            userId
        });

        return res.status(500).json(
            new ApiError(500, `Error: ${error.message}`)
        );
    }
});

/**
 * Check if issues are stored in database for inactive products
 * 
 * Request body:
 * {
 *   "userId": "user_id",
 *   "country": "US" (optional),
 *   "region": "NA" (optional)
 * }
 */
const checkIssuesInDatabase = asyncHandler(async (req, res) => {
    const { userId, country, region } = req.body;

    if (!userId) {
        return res.status(400).json(
            new ApiError(400, 'userId is required')
        );
    }

    try {
        const seller = await Seller.findOne({ User: userId });
        if (!seller) {
            return res.status(404).json(
                new ApiError(404, 'Seller account not found')
            );
        }

        let sellerAccounts = seller.sellerAccount;
        
        // Filter by country/region if provided
        if (country && region) {
            sellerAccounts = sellerAccounts.filter(
                acc => acc.country === country && acc.region === region
            );
        }

        const checkResults = sellerAccounts.map(account => {
            const allProducts = account.products || [];
            // Filter products with status "Inactive" or "Incomplete"
            const inactiveProducts = allProducts.filter(p => p.status === 'Inactive' || p.status === 'Incomplete');
            const inactiveWithIssues = inactiveProducts.filter(
                p => p.issues && Array.isArray(p.issues) && p.issues.length > 0
            );
            const inactiveWithoutIssues = inactiveProducts.filter(
                p => !p.issues || !Array.isArray(p.issues) || p.issues.length === 0
            );

            return {
                country: account.country,
                region: account.region,
                totalProducts: allProducts.length,
                inactiveProductsCount: inactiveProducts.length,
                inactiveWithIssuesCount: inactiveWithIssues.length,
                inactiveWithoutIssuesCount: inactiveWithoutIssues.length,
                coverage: inactiveProducts.length > 0 
                    ? Math.round((inactiveWithIssues.length / inactiveProducts.length) * 100)
                    : 0,
                productsWithIssues: inactiveWithIssues.map(p => ({
                    sku: p.sku,
                    asin: p.asin,
                    issuesCount: p.issues?.length || 0
                })),
                productsWithoutIssues: inactiveWithoutIssues.map(p => ({
                    sku: p.sku,
                    asin: p.asin
                }))
            };
        });

        return res.status(200).json(
            new ApiResponse(200, {
                userId,
                checkResults,
                summary: {
                    totalAccounts: checkResults.length,
                    totalInactiveProducts: checkResults.reduce((sum, r) => sum + r.inactiveProductsCount, 0),
                    totalWithIssues: checkResults.reduce((sum, r) => sum + r.inactiveWithIssuesCount, 0),
                    totalWithoutIssues: checkResults.reduce((sum, r) => sum + r.inactiveWithoutIssuesCount, 0)
                }
            }, 'Issues check completed')
        );

    } catch (error) {
        logger.error('[InactiveSKUIssuesTest] Error checking issues in database', {
            error: error.message,
            userId
        });

        return res.status(500).json(
            new ApiError(500, `Error: ${error.message}`)
        );
    }
});

module.exports = {
    testSingleSKUIssues,
    testProcessAllInactiveSKUs,
    viewInactiveProductsWithIssues,
    checkIssuesInDatabase
};

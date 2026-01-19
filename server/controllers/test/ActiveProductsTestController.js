/**
 * ActiveProductsTestController.js
 * 
 * Test controller for testing active products listing API functionality
 * 
 * Endpoints:
 * - POST /api/test/active-products/test-single - Test fetching listing data for a single active SKU
 * - POST /api/test/active-products/process-all - Process all active SKUs for a user
 * - GET /api/test/active-products/view/:userId - View active products with listing data
 * - POST /api/test/active-products/check - Check if B2B pricing is stored in database
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { GetListingItem } = require('../../Services/Sp_API/GetListingItemsIssues.js');
const { Integration } = require('../../Services/main/Integration.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAccessToken } = require('../../Services/Sp_API/GenerateTokens.js');
const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');
const { marketplaceConfig, spapiRegions, URIs } = require('../../controllers/config/config.js');

/**
 * Test fetching listing data for a single active SKU
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
const testSingleActiveProduct = asyncHandler(async (req, res) => {
    const { userId, sku, asin, country, region } = req.body;

    if (!userId || !sku || !asin || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'Missing required fields: userId, sku, asin, country, region')
        );
    }

    try {
        logger.info('[ActiveProductsTest] Testing single active product fetch', {
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

        // Get access token
        const AccessToken = await generateAccessToken(userId, sellerAccount.spiRefreshToken);
        if (!AccessToken) {
            return res.status(401).json(
                new ApiError(401, 'Failed to generate access token. Check if refresh token is valid.')
            );
        }

        // Get configuration
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
            includedData: "issues,attributes,summaries,offers,fulfillmentAvailability",
            SellerId: sellerAccount.selling_partner_id
        };

        // Call the API
        const result = await GetListingItem(
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
                new ApiError(500, 'Failed to fetch listing data for SKU')
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                sku: result.sku,
                asin: result.asin,
                genericKeyword: result.value,
                marketplaceId: result.marketplace_id,
                has_b2b_pricing: result.has_b2b_pricing
            }, 'Successfully fetched listing data for active product')
        );

    } catch (error) {
        logger.error('[ActiveProductsTest] Error testing single active product', {
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
 * Process all active SKUs for a user
 * 
 * Request body:
 * {
 *   "userId": "user_id",
 *   "country": "US",
 *   "region": "NA"
 * }
 */
const testProcessAllActiveProducts = asyncHandler(async (req, res) => {
    const { userId, country, region } = req.body;

    logger.info('[ActiveProductsTest] Request received', {
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
        
        logger.error('[ActiveProductsTest] Missing required fields', {
            missingFields,
            received: { userId, country, region }
        });
        
        return res.status(400).json(
            new ApiError(400, `Missing required fields: ${missingFields.join(', ')}`)
        );
    }

    try {
        logger.info('[ActiveProductsTest] Processing all active products', {
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

        // Extract active products
        const productData = Integration.extractProductData(
            { sellerAccount: [sellerAccount] },
            country,
            region
        );

        if (productData.skuArray.length === 0) {
            return res.status(200).json(
                new ApiResponse(200, {
                    activeCount: 0,
                    message: 'No active products found for this account'
                }, 'No active products to process')
            );
        }

        // Get access token and credentials
        if (!sellerAccount.spiRefreshToken) {
            logger.error('[ActiveProductsTest] No refresh token found', {
                userId,
                country,
                region
            });
            return res.status(400).json(
                new ApiError(400, 'SP-API refresh token not found for this account')
            );
        }

        logger.info('[ActiveProductsTest] Generating access token', {
            userId,
            hasRefreshToken: !!sellerAccount.spiRefreshToken
        });

        let AccessToken;
        try {
            AccessToken = await generateAccessToken(userId, sellerAccount.spiRefreshToken);
            if (!AccessToken) {
                logger.error('[ActiveProductsTest] generateAccessToken returned null/undefined', {
                    userId
                });
                return res.status(401).json(
                    new ApiError(401, 'Failed to generate access token - token generation returned null. Check if refresh token is valid.')
                );
            }
            logger.info('[ActiveProductsTest] Access token generated successfully', {
                userId,
                tokenLength: AccessToken?.length
            });
        } catch (tokenError) {
            logger.error('[ActiveProductsTest] Error generating access token', {
                error: tokenError.message,
                stack: tokenError.stack,
                userId
            });
            return res.status(401).json(
                new ApiError(401, `Failed to generate access token: ${tokenError.message}`)
            );
        }

        // Get configuration
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
            includedData: "issues,attributes,summaries,offers,fulfillmentAvailability",
            SellerId: sellerAccount.selling_partner_id
        };

        logger.info('[ActiveProductsTest] Starting to process active products', {
            activeCount: productData.skuArray.length,
            baseUri: Base_URI
        });

        // Process active products
        const listingDataArray = await Integration.processListingItems(
            AccessToken,
            productData.skuArray,
            productData.asinArray,
            dataToSend,
            userId,
            Base_URI,
            country,
            region,
            sellerAccount.spiRefreshToken,
            sellerAccount.adsRefreshToken || null,
            null // No logging helper for test
        );

        logger.info('[ActiveProductsTest] Completed processing active products', {
            total: productData.skuArray.length,
            processed: listingDataArray.length
        });

        // Get B2B pricing summary
        const b2bPricingCount = listingDataArray.filter(item => item?.has_b2b_pricing === true).length;

        return res.status(200).json(
            new ApiResponse(200, {
                totalActiveProducts: productData.skuArray.length,
                processedCount: listingDataArray.length,
                listingData: listingDataArray,
                b2bPricingSummary: {
                    totalWithB2B: b2bPricingCount,
                    totalWithoutB2B: listingDataArray.length - b2bPricingCount
                },
                summary: {
                    total: productData.skuArray.length,
                    successful: listingDataArray.length,
                    failed: productData.skuArray.length - listingDataArray.length
                }
            }, 'Successfully processed active products')
        );

    } catch (error) {
        logger.error('[ActiveProductsTest] Error processing all active products', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });

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
 * View active products with listing data
 * 
 * GET /api/test/active-products/view/:userId?country=US&region=NA
 */
const viewActiveProducts = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { country, region } = req.query;

    if (!userId) {
        return res.status(400).json(
            new ApiError(400, 'User ID is required')
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

        // Filter by country and region if provided
        if (country && region) {
            sellerAccounts = sellerAccounts.filter(
                acc => acc.country === country && acc.region === region
            );
        }

        const productsData = sellerAccounts.map(account => {
            const activeProducts = (account.products || []).filter(
                product => product.status === 'Active'
            );

            const productsWithB2B = activeProducts.filter(
                product => product.has_b2b_pricing === true
            );

            return {
                country: account.country,
                region: account.region,
                totalActiveProducts: activeProducts.length,
                productsWithB2B: productsWithB2B.length,
                productsWithoutB2B: activeProducts.length - productsWithB2B.length,
                products: activeProducts.map(p => ({
                    sku: p.sku,
                    asin: p.asin,
                    itemName: p.itemName,
                    price: p.price,
                    has_b2b_pricing: p.has_b2b_pricing || false
                }))
            };
        });

        return res.status(200).json(
            new ApiResponse(200, {
                userId,
                accounts: productsData,
                summary: {
                    totalAccounts: productsData.length,
                    totalActiveProducts: productsData.reduce((sum, acc) => sum + acc.totalActiveProducts, 0),
                    totalWithB2B: productsData.reduce((sum, acc) => sum + acc.productsWithB2B, 0)
                }
            }, 'Active products retrieved successfully')
        );

    } catch (error) {
        logger.error('[ActiveProductsTest] Error viewing active products', {
            error: error.message,
            userId
        });

        return res.status(500).json(
            new ApiError(500, `Error: ${error.message}`)
        );
    }
});

/**
 * Check if B2B pricing is stored in database
 * 
 * Request body:
 * {
 *   "userId": "user_id",
 *   "country": "US", (optional)
 *   "region": "NA" (optional)
 * }
 */
const checkB2BPricingInDatabase = asyncHandler(async (req, res) => {
    const { userId, country, region } = req.body;

    if (!userId) {
        return res.status(400).json(
            new ApiError(400, 'User ID is required')
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

        // Filter by country and region if provided
        if (country && region) {
            sellerAccounts = sellerAccounts.filter(
                acc => acc.country === country && acc.region === region
            );
        }

        const checkResults = sellerAccounts.map(account => {
            const allProducts = account.products || [];
            const activeProducts = allProducts.filter(
                product => product.status === 'Active'
            );
            const activeWithB2B = activeProducts.filter(
                product => product.has_b2b_pricing === true
            );
            const activeWithoutB2B = activeProducts.filter(
                product => product.has_b2b_pricing === false || product.has_b2b_pricing === undefined
            );

            return {
                country: account.country,
                region: account.region,
                totalActiveProducts: activeProducts.length,
                activeWithB2BCount: activeWithB2B.length,
                activeWithoutB2BCount: activeWithoutB2B.length,
                coverage: activeProducts.length > 0 
                    ? Math.round((activeWithB2B.length / activeProducts.length) * 100)
                    : 0,
                productsWithB2B: activeWithB2B.map(p => ({
                    sku: p.sku,
                    asin: p.asin,
                    has_b2b_pricing: p.has_b2b_pricing
                })),
                productsWithoutB2B: activeWithoutB2B.map(p => ({
                    sku: p.sku,
                    asin: p.asin,
                    has_b2b_pricing: p.has_b2b_pricing
                }))
            };
        });

        return res.status(200).json(
            new ApiResponse(200, {
                userId,
                checkResults,
                summary: {
                    totalAccounts: checkResults.length,
                    totalActiveProducts: checkResults.reduce((sum, r) => sum + r.totalActiveProducts, 0),
                    totalWithB2B: checkResults.reduce((sum, r) => sum + r.activeWithB2BCount, 0),
                    totalWithoutB2B: checkResults.reduce((sum, r) => sum + r.activeWithoutB2BCount, 0)
                }
            }, 'B2B pricing check completed')
        );

    } catch (error) {
        logger.error('[ActiveProductsTest] Error checking B2B pricing in database', {
            error: error.message,
            userId
        });

        return res.status(500).json(
            new ApiError(500, `Error: ${error.message}`)
        );
    }
});

module.exports = {
    testSingleActiveProduct,
    testProcessAllActiveProducts,
    viewActiveProducts,
    checkB2BPricingInDatabase
};

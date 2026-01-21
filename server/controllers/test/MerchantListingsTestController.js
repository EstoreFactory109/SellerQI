/**
 * MerchantListingsTestController.js
 * 
 * Test controller for testing GET_MERCHANT_LISTINGS_ALL_DATA API functionality
 * 
 * Endpoints:
 * - POST /api/test/merchant-listings/test - Test fetching merchant listings report
 * - GET /api/test/merchant-listings/view/:userId - View merchant listings data stored in database
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const getMerchantListingsReport = require('../../Services/Sp_API/GET_MERCHANT_LISTINGS_ALL_DATA.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAccessToken } = require('../../Services/Sp_API/GenerateTokens.js');
const { marketplaceConfig, URIs } = require('../../controllers/config/config.js');

/**
 * Test fetching merchant listings report
 * 
 * Request body:
 * {
 *   "userId": "user_id",
 *   "country": "US",
 *   "region": "NA",
 *   "accessToken": "token" (optional - will fetch from DB if not provided),
 *   "fetchTokenFromDB": true (optional - defaults to true)
 * }
 */
const testMerchantListings = asyncHandler(async (req, res) => {
    const { userId, country, region, accessToken, fetchTokenFromDB = true } = req.body;

    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'Missing required fields: userId, country, region')
        );
    }

    try {
        logger.info('[MerchantListingsTest] Testing merchant listings report', {
            userId,
            country,
            region,
            fetchTokenFromDB
        });

        // Get seller account
        const seller = await Seller.findOne({ User: userId });
        if (!seller) {
            return res.status(404).json({
                statusCode: 404,
                message: 'Seller account not found',
                errors: [],
                suggestion: 'Please ensure the userId is correct and the seller account exists in the database'
            });
        }

        // Find the matching seller account
        const sellerAccount = seller.sellerAccount.find(
            acc => acc.country === country && acc.region === region
        );

        if (!sellerAccount) {
            const availableAccounts = seller.sellerAccount?.map(acc => ({
                country: acc.country,
                region: acc.region
            })) || [];
            
            return res.status(404).json({
                statusCode: 404,
                message: `Seller account not found for country ${country} and region ${region}`,
                errors: [],
                availableAccounts: availableAccounts,
                suggestion: 'Please check the country and region values. Available accounts are listed above.'
            });
        }

        let spApiToken = accessToken;

        // Fetch token from DB if requested or if not provided
        if (fetchTokenFromDB || !spApiToken) {
            if (!sellerAccount.spiRefreshToken) {
                return res.status(400).json(
                    new ApiError(400, 'SP-API refresh token not found for this account')
                );
            }

            spApiToken = await generateAccessToken(userId, sellerAccount.spiRefreshToken);
            if (!spApiToken) {
                return res.status(401).json(
                    new ApiError(401, 'Failed to generate access token. Check if refresh token is valid.')
                );
            }
        }

        // Get configuration
        const Base_URI = URIs[region];
        const Marketplace_Ids = [marketplaceConfig[country]];

        if (!Base_URI) {
            return res.status(400).json(
                new ApiError(400, `Unsupported region: ${region}`)
            );
        }

        if (!Marketplace_Ids[0]) {
            return res.status(400).json(
                new ApiError(400, `Unsupported country: ${country}`)
            );
        }

        logger.info('[MerchantListingsTest] Calling GET_MERCHANT_LISTINGS_ALL_DATA', {
            userId,
            country,
            region,
            baseURI: Base_URI,
            marketplaceIds: Marketplace_Ids
        });

        // Call the service
        const result = await getMerchantListingsReport(
            spApiToken,
            Marketplace_Ids,
            userId,
            country,
            region,
            Base_URI
        );

        if (!result) {
            return res.status(500).json(
                new ApiError(500, 'Failed to fetch merchant listings report')
            );
        }

        // Extract summary information
        const sellerAccountData = result.sellerAccount?.find(
            acc => acc.country === country && acc.region === region
        );

        const products = sellerAccountData?.products || [];
        const summary = {
            totalProducts: products.length,
            activeProducts: products.filter(p => p.status === 'Active').length,
            inactiveProducts: products.filter(p => p.status === 'Inactive').length,
            incompleteProducts: products.filter(p => p.status === 'Incomplete').length,
            productsWithQuantity: products.filter(p => p.quantity !== undefined && p.quantity !== null).length,
            totalQuantity: products.reduce((sum, p) => sum + (parseInt(p.quantity) || 0), 0),
            sampleProducts: products.slice(0, 5).map(p => ({
                asin: p.asin,
                sku: p.sku,
                itemName: p.itemName,
                price: p.price,
                status: p.status,
                quantity: p.quantity
            }))
        };

        return res.status(200).json(
            new ApiResponse(200, {
                success: true,
                message: 'Merchant listings report fetched and saved successfully',
                summary: summary,
                totalProducts: products.length,
                metadata: {
                    userId,
                    country,
                    region,
                    baseURI: Base_URI,
                    marketplaceIds: Marketplace_Ids,
                    processedAt: new Date().toISOString()
                }
            }, 'Successfully fetched merchant listings report')
        );

    } catch (error) {
        logger.error('[MerchantListingsTest] Error testing merchant listings', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });

        if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
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
 * View merchant listings data stored in database
 * 
 * GET /api/test/merchant-listings/view/:userId?country=US&region=NA
 */
const viewMerchantListings = asyncHandler(async (req, res) => {
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

        const listingsData = sellerAccounts.map(account => {
            const products = account.products || [];
            
            return {
                country: account.country,
                region: account.region,
                totalProducts: products.length,
                activeProducts: products.filter(p => p.status === 'Active').length,
                inactiveProducts: products.filter(p => p.status === 'Inactive').length,
                incompleteProducts: products.filter(p => p.status === 'Incomplete').length,
                productsWithQuantity: products.filter(p => p.quantity !== undefined && p.quantity !== null).length,
                totalQuantity: products.reduce((sum, p) => sum + (parseInt(p.quantity) || 0), 0),
                lastUpdated: account.updatedAt,
                products: products.map(p => ({
                    asin: p.asin,
                    sku: p.sku,
                    itemName: p.itemName,
                    price: p.price,
                    status: p.status,
                    quantity: p.quantity || 0,
                    has_b2b_pricing: p.has_b2b_pricing || false
                }))
            };
        });

        return res.status(200).json(
            new ApiResponse(200, {
                userId,
                accounts: listingsData,
                summary: {
                    totalAccounts: listingsData.length,
                    totalProducts: listingsData.reduce((sum, acc) => sum + acc.totalProducts, 0),
                    totalActiveProducts: listingsData.reduce((sum, acc) => sum + acc.activeProducts, 0),
                    totalQuantity: listingsData.reduce((sum, acc) => sum + acc.totalQuantity, 0)
                }
            }, 'Merchant listings data retrieved successfully')
        );

    } catch (error) {
        logger.error('[MerchantListingsTest] Error viewing merchant listings', {
            error: error.message,
            userId
        });

        return res.status(500).json(
            new ApiError(500, `Error: ${error.message}`)
        );
    }
});

module.exports = {
    testMerchantListings,
    viewMerchantListings
};

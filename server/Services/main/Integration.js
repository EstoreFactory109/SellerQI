const limit = require('promise-limit')(3); // Limit to 3 concurrent promises
const { generateAccessToken } = require('../Sp_API/GenerateTokens.js');
const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');
const logger = require('../../utils/Logger.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { URIs, marketplaceConfig, spapiRegions } = require('../../controllers/config/config.js');
const tokenManager = require('../../utils/TokenManager.js');
const { sendAnalysisReadyEmail } = require('../Email/SendAnalysisReadyEmail.js');
const LoggingHelper = require('../../utils/LoggingHelper.js');
const axios = require('axios');
const userModel = require('../../models/user-auth/userModel.js');

// Helper function to add timeout to promises
const withTimeout = (promise, timeoutMs, operationName) => {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
};

// Models
const ListingItemsModel = require('../../models/products/GetListingItemsModel.js');
const CompetitivePricing = require('../../models/seller-performance/CompetitivePricingModel.js');
const ProductWiseSponsoredAdsData = require('../../models/amazon-ads/ProductWiseSponseredAdsModel.js');

// SP-API Services
const GET_MERCHANT_LISTINGS_ALL_DATA = require('../Sp_API/GET_MERCHANT_LISTINGS_ALL_DATA.js');
const GET_V2_SELLER_PERFORMANCE_REPORT = require('../Sp_API/V2_Seller_Performance_Report.js');
const GET_V1_SELLER_PERFORMANCE_REPORT = require('../Sp_API/GET_V1_SELLER_PERFORMANCE_REPORT.js');
const { listFinancialEventsMethod } = require('../Sp_API/Finance.js');
const { getCompetitivePricing } = require('../Sp_API/CompetitivePrices.js');
const GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT = require('../Sp_API/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT.js');
const { addReviewDataTODatabase } = require('../Sp_API/NumberOfProductReviews.js');
const { GetListingItem } = require('../Sp_API/GetListingItemsIssues.js');
const TotalSales = require('../Sp_API/WeeklySales.js');
const getshipment = require('../Sp_API/shipment.js');

// Amazon Ads Services
const { generateAdsAccessToken } = require('../AmazonAds/GenerateToken.js');
const { getPPCSpendsBySKU } = require('../AmazonAds/GetPPCProductWise.js');
const { getKeywords } = require('../AmazonAds/Keywords.js');
const { getNegativeKeywords } = require('../AmazonAds/NegetiveKeywords.js');
const { getSearchKeywords } = require('../AmazonAds/GetSearchKeywords.js');
const { getCampaign } = require('../AmazonAds/GetCampaigns.js');
const { getKeywordPerformanceReport } = require('../AmazonAds/GetWastedSpendKeywords.js');
const { getPPCSpendsDateWise } = require('../AmazonAds/GetDateWiseSpendKeywords.js');
const { getAdGroups } = require('../AmazonAds/AdGroups.js');
const { getKeywordRecommendations } = require('../AmazonAds/KeyWordsRecommendations.js');

// Other Services
const { getBrand } = require('../Sp_API/GetBrand.js');
const GET_FBA_INVENTORY_PLANNING_DATA = require('../Sp_API/GET_FBA_INVENTORY_PLANNING_DATA.js');
const GET_STRANDED_INVENTORY_UI_DATA = require('../Sp_API/GET_STRANDED_INVENTORY_UI_DATA.js');
const GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA = require('../Sp_API/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA.js');
const getAmazonFees = require('../Finance/AmazonFees.js');
const { addAccountHistory } = require('../History/addAccountHistory.js');
const { AnalyseService } = require('./Analyse.js');

const GetProductWiseFBAData = require('../Sp_API/GetProductWiseFBAData.js');
const GET_LEDGER_SUMMARY_VIEW_DATA = require('../Sp_API/GET_LEDGER_SUMMARY_VIEW_DATA.js');

class Integration {
    /**
     * Main integration function to fetch all SP-API and Amazon Ads data
     * @param {string} userId - User ID
     * @param {string} Region - Region (NA, EU, FE)
     * @param {string} Country - Country code
     * @returns {Object} Result object with data and status
     */
    static async getSpApiData(userId, Region, Country) {
        // Initialize logging session
        let loggingHelper = null;
        try {
            loggingHelper = new LoggingHelper(userId, Region, Country);
            await loggingHelper.initSession();
            loggingHelper.logFunctionStart('Integration.getSpApiData', {
                userId,
                region: Region,
                country: Country,
                requestOrigin: 'integration_service'
            });
        } catch (loggingError) {
            logger.warn('Failed to initialize logging session', { error: loggingError.message, userId });
        }

        try {
            // Validate inputs
            const validationResult = await this.validateInputs(userId, Region, Country);
            if (!validationResult.success) {
                if (loggingHelper) {
                    loggingHelper.logFunctionError('validation', new Error(validationResult.error));
                }
                return {
                    success: false,
                    statusCode: validationResult.statusCode,
                    error: validationResult.error
                };
            }

            // Get configuration
            const config = this.getConfiguration(Region, Country);
            if (!config.success) {
                if (loggingHelper) {
                    loggingHelper.logFunctionError('configuration', new Error(config.error));
                }
                return {
                    success: false,
                    statusCode: config.statusCode,
                    error: config.error
                };
            }

            const { Base_URI, Marketplace_Id, regionConfig, marketplaceIds } = config;

            // Get seller data and tokens
            const sellerDataResult = await this.getSellerDataAndTokens(userId, Region, Country);
            if (!sellerDataResult.success) {
                if (loggingHelper) {
                    loggingHelper.logFunctionError('getSellerData', new Error(sellerDataResult.error));
                }
                return {
                    success: false,
                    statusCode: sellerDataResult.statusCode,
                    error: sellerDataResult.error
                };
            }

            const { RefreshToken, AdsRefreshToken, ProfileId, sellerId } = sellerDataResult;

            // Generate AWS credentials
            const credentialsResult = await this.generateCredentials(regionConfig, loggingHelper);
            if (!credentialsResult.success) {
                return {
                    success: false,
                    statusCode: credentialsResult.statusCode,
                    error: credentialsResult.error
                };
            }

            const credentials = credentialsResult.credentials;

            // Generate access tokens
            const tokenResult = await this.generateTokens(userId, RefreshToken, AdsRefreshToken, loggingHelper);
            if (!tokenResult.success) {
                return {
                    success: false,
                    statusCode: tokenResult.statusCode,
                    error: tokenResult.error
                };
            }

            const { AccessToken, AdsAccessToken } = tokenResult;

            // Initialize TokenManager
            tokenManager.setTokens(userId, AccessToken, AdsAccessToken, RefreshToken, AdsRefreshToken);

            // Fetch merchant listings data
            const merchantListingsData = await this.fetchMerchantListings(
                AccessToken, marketplaceIds, userId, Country, Region, Base_URI,
                RefreshToken, AdsRefreshToken, loggingHelper
            );

            // Extract product data
            const productData = this.extractProductData(merchantListingsData, Country, Region);

            // Prepare dataToSend object
            const dataToSend = this.prepareDataToSend(
                Marketplace_Id, AccessToken, credentials, productData.asinArray,
                Country, sellerId
            );

            // Fetch all API data in parallel batches
            const apiData = await this.fetchAllApiData({
                AccessToken,
                AdsAccessToken,
                marketplaceIds,
                userId,
                Base_URI,
                Country,
                Region,
                ProfileId,
                RefreshToken,
                AdsRefreshToken,
                productData,
                dataToSend,
                loggingHelper
            });

            // Process and save data
            await this.processAndSaveData({
                userId,
                Region,
                Country,
                apiData,
                productData,
                merchantListingsData,
                loggingHelper
            });

            // Create final result
            const result = this.createFinalResult(apiData, merchantListingsData, productData);

            // Generate service summary
            const serviceSummary = this.generateServiceSummary(apiData);

            // Send notifications and update history if successful
            if (serviceSummary.overallSuccess) {
                await this.handleSuccess(userId, Country, Region);
                if (loggingHelper) {
                    loggingHelper.logFunctionSuccess('Integration.getSpApiData', result, {
                        recordsProcessed: serviceSummary.successful.length + serviceSummary.failed.length,
                        recordsSuccessful: serviceSummary.successful.length,
                        recordsFailed: serviceSummary.failed.length
                    });
                    await loggingHelper.endSession('completed');
                }
            } else {
                if (loggingHelper) {
                    loggingHelper.logFunctionWarning('Integration.getSpApiData', 'Critical services failed', {
                        criticalFailures: serviceSummary.criticalFailures,
                        successRate: serviceSummary.successPercentage
                    });
                    await loggingHelper.endSession('partial');
                }
            }

            // Always add account history regardless of success
            await this.addNewAccountHistory(userId, Country, Region);

            return {
                success: serviceSummary.overallSuccess,
                statusCode: serviceSummary.overallSuccess ? 200 : 207,
                data: result,
                summary: {
                    success: serviceSummary.overallSuccess,
                    successRate: `${serviceSummary.successPercentage}%`,
                    totalServices: serviceSummary.totalServices,
                    successfulServices: serviceSummary.successful.length,
                    failedServices: serviceSummary.failed.length,
                    warnings: serviceSummary.warnings,
                    criticalFailures: serviceSummary.criticalFailures
                }
            };

        } catch (unexpectedError) {
            logger.error("Unexpected error in Integration.getSpApiData", {
                error: unexpectedError.message,
                stack: unexpectedError.stack,
                userId
            });

            if (loggingHelper) {
                loggingHelper.logFunctionError('Integration.getSpApiData', unexpectedError);
                await loggingHelper.endSession('failed');
            }

            return {
                success: false,
                statusCode: 500,
                error: `Unexpected error: ${unexpectedError.message}`
            };
        }
    }

    /**
     * Validate input parameters
     */
    static async validateInputs(userId, Region, Country) {
        if (!userId) {
            return { success: false, statusCode: 400, error: "User id is missing" };
        }

        if (!Region || !Country) {
            return { success: false, statusCode: 400, error: "Region and country are required" };
        }

        const validRegions = ["NA", "EU", "FE"];
        if (!validRegions.includes(Region)) {
            return { success: false, statusCode: 400, error: `Invalid region. Must be one of: ${validRegions.join(', ')}` };
        }

        // Check database connection
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState !== 1) {
            return { success: false, statusCode: 500, error: "Database connection unavailable" };
        }

        return { success: true };
    }

    /**
     * Get configuration for region and country
     */
    static getConfiguration(Region, Country) {
        // Validate configuration objects
        if (!URIs || typeof URIs !== 'object') {
            return { success: false, statusCode: 500, error: "Server configuration error - URIs not available" };
        }

        if (!marketplaceConfig || typeof marketplaceConfig !== 'object') {
            return { success: false, statusCode: 500, error: "Server configuration error - marketplace config not available" };
        }

        if (!spapiRegions || typeof spapiRegions !== 'object') {
            return { success: false, statusCode: 500, error: "Server configuration error - SP-API regions not available" };
        }

        const Base_URI = URIs[Region];
        let Marketplace_Id = marketplaceConfig[Country];

        // Try case-insensitive match if direct match fails
        if (!Marketplace_Id && Country) {
            const upperCountry = Country.toUpperCase();
            Marketplace_Id = marketplaceConfig[upperCountry];
            if (!Marketplace_Id) {
                const foundKey = Object.keys(marketplaceConfig).find(key =>
                    key.toLowerCase() === Country.toLowerCase()
                );
                if (foundKey) {
                    Marketplace_Id = marketplaceConfig[foundKey];
                }
            }
        }

        const regionConfig = spapiRegions[Region];

        if (!Base_URI) {
            return { success: false, statusCode: 400, error: `Unsupported region: ${Region}` };
        }

        if (!Marketplace_Id) {
            return { success: false, statusCode: 400, error: `Unsupported country: ${Country}` };
        }

        if (!regionConfig) {
            return { success: false, statusCode: 400, error: `No credential configuration for region: ${Region}` };
        }

        // Validate marketplace ID format
        if (typeof Marketplace_Id !== 'string' || Marketplace_Id.length < 10) {
            return { success: false, statusCode: 500, error: "Invalid marketplace ID configuration" };
        }

        const marketplaceIds = [Marketplace_Id];

        return {
            success: true,
            Base_URI,
            Marketplace_Id,
            regionConfig,
            marketplaceIds
        };
    }

    /**
     * Get seller data and tokens
     */
    static async getSellerDataAndTokens(userId, Region, Country) {
        try {
            const getSellerData = await Seller.findOne({ User: userId });

            if (!getSellerData) {
                return { success: false, statusCode: 404, error: "No seller account found for this user" };
            }

            const sellerAccounts = Array.isArray(getSellerData.sellerAccount) ? getSellerData.sellerAccount : [];
            const getSellerAccount = sellerAccounts.find(item => item && item.country === Country && item.region === Region);

            if (!getSellerAccount) {
                return { success: false, statusCode: 400, error: `No seller account found for region ${Region} and country ${Country}` };
            }

            const RefreshToken = getSellerAccount.spiRefreshToken;
            const AdsRefreshToken = getSellerAccount.adsRefreshToken;

            // Check if at least one refresh token is available
            if (!RefreshToken && !AdsRefreshToken) {
                return { success: false, statusCode: 400, error: "Both SP-API and Amazon Ads refresh tokens are missing" };
            }

            if (!RefreshToken) {
                logger.warn("SP-API refresh token is missing - SP-API functions will be skipped", { userId, Region, Country });
            }

            if (!AdsRefreshToken) {
                logger.warn("Amazon Ads refresh token is missing - Ads functions will be skipped", { userId, Region, Country });
            }

            const ProfileId = getSellerAccount.ProfileId;
            const sellerId = getSellerAccount.selling_partner_id;

            if (!sellerId) {
                return { success: false, statusCode: 400, error: "Seller ID not found" };
            }

            return {
                success: true,
                RefreshToken,
                AdsRefreshToken,
                ProfileId,
                sellerId
            };

        } catch (dbError) {
            logger.error("Database error while fetching seller data", { error: dbError.message, userId });
            return { success: false, statusCode: 500, error: "Database error while fetching seller data" };
        }
    }

    /**
     * Generate AWS credentials
     */
    static async generateCredentials(regionConfig, loggingHelper) {
        if (loggingHelper) {
            loggingHelper.logFunctionStart('generateTemporaryCredentials', { region: regionConfig });
        }

        try {
            const credentials = await getTemporaryCredentials(regionConfig);

            if (!credentials || typeof credentials !== 'object') {
                throw new Error("Invalid credentials object returned");
            }

            const requiredFields = ['AccessKey', 'SecretKey', 'SessionToken'];
            const missingFields = requiredFields.filter(field => !credentials[field]);

            if (missingFields.length > 0) {
                throw new Error(`Missing required credential fields: ${missingFields.join(', ')}`);
            }

            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('generateTemporaryCredentials', null, {
                    recordsProcessed: 1,
                    recordsSuccessful: 1
                });
            }

            return { success: true, credentials };

        } catch (credError) {
            logger.error("Failed to generate AWS temporary credentials", {
                error: credError.message
            });
            if (loggingHelper) {
                loggingHelper.logFunctionError('generateTemporaryCredentials', credError);
            }
            return { success: false, statusCode: 500, error: "Failed to generate AWS credentials" };
        }
    }

    /**
     * Generate access tokens
     */
    static async generateTokens(userId, RefreshToken, AdsRefreshToken, loggingHelper) {
        if (loggingHelper) {
            loggingHelper.logFunctionStart('generateAccessTokens', {
                hasRefreshToken: !!RefreshToken,
                hasAdsRefreshToken: !!AdsRefreshToken
            });
        }

        try {
            const tokenPromises = [];
            const tokenTypes = [];

            if (RefreshToken) {
                tokenPromises.push(generateAccessToken(userId, RefreshToken));
                tokenTypes.push('SP-API');
            }

            if (AdsRefreshToken) {
                tokenPromises.push(generateAdsAccessToken(AdsRefreshToken));
                tokenTypes.push('Ads');
            }

            const tokenResults = await Promise.allSettled(tokenPromises);

            let tokenIndex = 0;
            let AccessToken = null;
            let AdsAccessToken = null;

            if (RefreshToken) {
                if (tokenResults[tokenIndex].status === 'rejected') {
                    logger.warn(`SP-API token generation failed: ${tokenResults[tokenIndex].reason}`);
                } else {
                    AccessToken = tokenResults[tokenIndex].value;
                    if (!AccessToken) {
                        logger.warn("SP-API token generation returned false/null");
                        AccessToken = null;
                    }
                }
                tokenIndex++;
            }

            if (AdsRefreshToken) {
                if (tokenResults[tokenIndex].status === 'rejected') {
                    logger.warn(`Amazon Ads token generation failed: ${tokenResults[tokenIndex].reason}`);
                } else {
                    AdsAccessToken = tokenResults[tokenIndex].value;
                    if (!AdsAccessToken) {
                        logger.warn("Amazon Ads token generation returned false/null");
                        AdsAccessToken = null;
                    }
                }
            }

            if (!AccessToken && !AdsAccessToken) {
                throw new Error("Failed to generate both SP-API and Amazon Ads access tokens");
            }

            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('generateAccessTokens', null, {
                    recordsProcessed: tokenPromises.length,
                    recordsSuccessful: (AccessToken ? 1 : 0) + (AdsAccessToken ? 1 : 0),
                    recordsFailed: tokenPromises.length - ((AccessToken ? 1 : 0) + (AdsAccessToken ? 1 : 0))
                });
            }

            return { success: true, AccessToken, AdsAccessToken };

        } catch (tokenError) {
            logger.error("Failed to generate any access tokens", {
                error: tokenError.message,
                userId
            });
            if (loggingHelper) {
                loggingHelper.logFunctionError('generateAccessTokens', tokenError);
            }
            return { success: false, statusCode: 500, error: `Token generation failed: ${tokenError.message}` };
        }
    }

    /**
     * Fetch merchant listings data
     */
    static async fetchMerchantListings(AccessToken, marketplaceIds, userId, Country, Region, Base_URI, RefreshToken, AdsRefreshToken, loggingHelper) {
        logger.info("fetchMerchantListings starting");
        
        if (!AccessToken) {
            if (loggingHelper) {
                loggingHelper.logFunctionSkipped('GET_MERCHANT_LISTINGS_ALL_DATA', 'AccessToken not available');
            }
            return null;
        }

        if (loggingHelper) {
            loggingHelper.logFunctionStart('GET_MERCHANT_LISTINGS_ALL_DATA', {
                hasAccessToken: true,
                marketplaceIds
            });
        }

        try {
            const merchantListingsData = await withTimeout(
                tokenManager.wrapSpApiFunction(
                    GET_MERCHANT_LISTINGS_ALL_DATA, userId, RefreshToken, AdsRefreshToken
                )(AccessToken, marketplaceIds, userId, Country, Region, Base_URI),
                300000, // 5 minutes
                'GET_MERCHANT_LISTINGS_ALL_DATA'
            );

            if (!merchantListingsData) {
                throw new Error("Merchant listings API returned null/false");
            }

            if (loggingHelper) {
                const recordCount = merchantListingsData?.sellerAccount?.length || 0;
                loggingHelper.logFunctionSuccess('GET_MERCHANT_LISTINGS_ALL_DATA', merchantListingsData, {
                    recordsProcessed: recordCount,
                    recordsSuccessful: recordCount
                });
            }

            logger.info("fetchMerchantListings ended");
            return merchantListingsData;

        } catch (merchantError) {
            logger.error("Failed to fetch merchant listings data", {
                error: merchantError.message,
                userId,
                marketplaceIds
            });
            if (loggingHelper) {
                loggingHelper.logFunctionError('GET_MERCHANT_LISTINGS_ALL_DATA', merchantError);
            }
            return null;
        }
    }

    /**
     * Extract product data from merchant listings
     */
    static extractProductData(merchantListingsData, Country, Region) {
        logger.info("extractProductData starting");
        
        const asinArray = [];
        const skuArray = [];
        const ProductDetails = [];

        if (!merchantListingsData || !Array.isArray(merchantListingsData.sellerAccount)) {
            logger.info("extractProductData ended");
            return { asinArray, skuArray, ProductDetails };
        }

        const merchantSellerAccounts = merchantListingsData.sellerAccount;
        const SellerAccount = merchantSellerAccounts.find(item => item && item.country === Country && item.region === Region);

        if (!SellerAccount || !Array.isArray(SellerAccount.products)) {
            logger.info("extractProductData ended");
            return { asinArray, skuArray, ProductDetails };
        }

        const activeProducts = SellerAccount.products.filter(product => {
            if (!product || typeof product !== 'object') return false;
            if (product.status !== "Active") return false;
            if (!product.asin || typeof product.asin !== 'string' || product.asin.trim() === '') return false;
            if (!product.sku || typeof product.sku !== 'string' || product.sku.trim() === '') return false;
            return true;
        });

        activeProducts.forEach(product => {
            asinArray.push(product.asin.trim());
            skuArray.push(product.sku.trim());

            let price = product.price;
            if (typeof price === 'string') {
                price = parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
            } else if (typeof price !== 'number' || isNaN(price)) {
                price = 0;
            }

            ProductDetails.push({
                asin: product.asin.trim(),
                price: price
            });
        });

        logger.info("extractProductData ended");
        return { asinArray, skuArray, ProductDetails };
    }

    /**
     * Prepare dataToSend object
     */
    static prepareDataToSend(Marketplace_Id, AccessToken, credentials, asinArray, Country, sellerId) {
        const now = new Date();
        const before = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const after = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);

        return {
            before: before.toISOString(),
            after: after.toISOString(),
            marketplaceId: Marketplace_Id,
            AccessToken: AccessToken,
            AccessKey: credentials.AccessKey,
            SecretKey: credentials.SecretKey,
            SessionToken: credentials.SessionToken,
            ASIN: asinArray,
            issueLocale: `en_${Country}`,
            includedData: "issues,attributes,summaries,offers,fulfillmentAvailability",
            SellerId: sellerId
        };
    }

    /**
     * Fetch all API data in parallel batches
     */
    static async fetchAllApiData(params) {
        const {
            AccessToken, AdsAccessToken, marketplaceIds, userId, Base_URI,
            Country, Region, ProfileId, RefreshToken, AdsRefreshToken,
            productData, dataToSend, loggingHelper
        } = params;

        const apiData = {};

        // Process API result helper
        const processApiResult = (result, serviceName) => {
            if (result.status === 'fulfilled') {
                if (loggingHelper) {
                    const recordCount = Array.isArray(result.value) ? result.value.length : (result.value ? 1 : 0);
                    loggingHelper.logFunctionSuccess(serviceName, result.value, {
                        recordsProcessed: recordCount,
                        recordsSuccessful: recordCount
                    });
                }
                return { success: true, data: result.value, error: null };
            } else {
                const errorMsg = result.reason?.message || 'Unknown error';
                logger.error(`${serviceName} failed`, { error: errorMsg, userId });
                if (loggingHelper) {
                    loggingHelper.logFunctionError(serviceName, result.reason);
                }
                return { success: false, data: null, error: errorMsg };
            }
        };

        // First batch
        logger.info("First Batch Starts");
        const firstBatchPromises = [];
        const firstBatchServiceNames = [];

        if (AccessToken) {
            firstBatchPromises.push(
                tokenManager.wrapSpApiFunction(GET_V2_SELLER_PERFORMANCE_REPORT, userId, RefreshToken, AdsRefreshToken)
                    (AccessToken, marketplaceIds, userId, Base_URI, Country, Region),
                tokenManager.wrapSpApiFunction(GET_V1_SELLER_PERFORMANCE_REPORT, userId, RefreshToken, AdsRefreshToken)
                    (AccessToken, marketplaceIds, userId, Base_URI, Country, Region)
            );
            firstBatchServiceNames.push("V2 Seller Performance Report", "V1 Seller Performance Report");
        }

        if (AdsAccessToken) {
            firstBatchPromises.push(
                tokenManager.wrapAdsFunction(getPPCSpendsBySKU, userId, RefreshToken, AdsRefreshToken)
                    (AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken),
                tokenManager.wrapAdsFunction(getKeywordPerformanceReport, userId, RefreshToken, AdsRefreshToken)
                    (AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken),
                tokenManager.wrapAdsFunction(getPPCSpendsDateWise, userId, RefreshToken, AdsRefreshToken)
                    (AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken)
            );
            firstBatchServiceNames.push("PPC Spends by SKU", "Ads Keywords Performance", "PPC Spends Date Wise");
        }

        const firstBatchResults = await Promise.allSettled(firstBatchPromises);
        let resultIndex = 0;

        if (AccessToken) {
            apiData.v2data = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1]);
            apiData.v1data = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1]);
        } else {
            apiData.v2data = { success: false, data: null, error: "SP-API token not available" };
            apiData.v1data = { success: false, data: null, error: "SP-API token not available" };
        }

        if (AdsAccessToken) {
            apiData.ppcSpendsBySKU = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1]);
            apiData.adsKeywordsPerformanceData = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1]);
            apiData.ppcSpendsDateWise = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1]);
        } else {
            apiData.ppcSpendsBySKU = { success: false, data: null, error: "Ads token not available" };
            apiData.adsKeywordsPerformanceData = { success: false, data: null, error: "Ads token not available" };
            apiData.ppcSpendsDateWise = { success: false, data: null, error: "Ads token not available" };
        }
        logger.info("First Batch Ends");

        // Second batch
        logger.info("Second Batch Starts");
        const secondBatchPromises = [];
        const secondBatchServiceNames = [];

        if (AccessToken) {
            secondBatchPromises.push(
                tokenManager.wrapSpApiFunction(GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT, userId, RefreshToken, AdsRefreshToken)
                    (AccessToken, marketplaceIds, userId, Base_URI, Country, Region),
                tokenManager.wrapSpApiFunction(GET_FBA_INVENTORY_PLANNING_DATA, userId, RefreshToken, AdsRefreshToken)
                    (AccessToken, marketplaceIds, userId, Base_URI, Country, Region),
                tokenManager.wrapSpApiFunction(GET_STRANDED_INVENTORY_UI_DATA, userId, RefreshToken, AdsRefreshToken)
                    (AccessToken, marketplaceIds, userId, Base_URI, Country, Region),
                tokenManager.wrapSpApiFunction(GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA, userId, RefreshToken, AdsRefreshToken)
                    (AccessToken, marketplaceIds, userId, Base_URI, Country, Region)
            );
            secondBatchServiceNames.push(
                "Restock Inventory Recommendations",
                "FBA Inventory Planning",
                "Stranded Inventory",
                "Inbound Non-Compliance"
            );
        }

        secondBatchPromises.push(
            addReviewDataTODatabase(Array.isArray(productData.asinArray) ? productData.asinArray : [], Country, userId, Region)
        );
        secondBatchServiceNames.push("Product Reviews");

        if (AdsAccessToken) {
            secondBatchPromises.push(
                tokenManager.wrapAdsFunction(getKeywords, userId, RefreshToken, AdsRefreshToken)
                    (AdsAccessToken, ProfileId, userId, Country, Region),
                tokenManager.wrapAdsFunction(getCampaign, userId, RefreshToken, AdsRefreshToken)
                    (AdsAccessToken, ProfileId, Region, userId, Country)
            );
            secondBatchServiceNames.push("Ads Keywords", "Campaign Data");
        }

        const secondBatchResults = await Promise.allSettled(secondBatchPromises);
        let secondResultIndex = 0;

        if (AccessToken) {
            apiData.RestockinventoryData = processApiResult(secondBatchResults[secondResultIndex++], secondBatchServiceNames[secondResultIndex - 1]);
            apiData.fbaInventoryPlanningData = processApiResult(secondBatchResults[secondResultIndex++], secondBatchServiceNames[secondResultIndex - 1]);
            apiData.strandedInventoryData = processApiResult(secondBatchResults[secondResultIndex++], secondBatchServiceNames[secondResultIndex - 1]);
            apiData.inboundNonComplianceData = processApiResult(secondBatchResults[secondResultIndex++], secondBatchServiceNames[secondResultIndex - 1]);
        } else {
            apiData.RestockinventoryData = { success: false, data: null, error: "SP-API token not available" };
            apiData.fbaInventoryPlanningData = { success: false, data: null, error: "SP-API token not available" };
            apiData.strandedInventoryData = { success: false, data: null, error: "SP-API token not available" };
            apiData.inboundNonComplianceData = { success: false, data: null, error: "SP-API token not available" };
        }

        apiData.productReview = processApiResult(secondBatchResults[secondResultIndex++], secondBatchServiceNames[secondResultIndex - 1]);

        if (AdsAccessToken) {
            apiData.adsKeywords = processApiResult(secondBatchResults[secondResultIndex++], secondBatchServiceNames[secondResultIndex - 1]);
            apiData.campaignData = processApiResult(secondBatchResults[secondResultIndex++], secondBatchServiceNames[secondResultIndex - 1]);
        } else {
            apiData.adsKeywords = { success: false, data: null, error: "Ads token not available" };
            apiData.campaignData = { success: false, data: null, error: "Ads token not available" };
        }
        logger.info("Second Batch Ends");

        // Get campaign and ad group IDs
        const { campaignIdArray, adGroupIdArray } = await this.getCampaignAndAdGroupIds(
            apiData.ppcSpendsBySKU, userId, Region, Country
        );

        // Process competitive pricing
        apiData.competitivePriceData = await this.processCompetitivePricing(
            AccessToken, productData.asinArray, dataToSend, userId, Base_URI,
            Country, Region, RefreshToken, AdsRefreshToken, loggingHelper
        );

        // Third batch
        logger.info("Third Batch Starts");
        const thirdBatchPromises = [];
        const thirdBatchServiceNames = [];

        if (AccessToken) {
            thirdBatchPromises.push(
                tokenManager.wrapDataToSendFunction(TotalSales, userId, RefreshToken, AdsRefreshToken)
                    (dataToSend, userId, Base_URI, Country, Region),
                tokenManager.wrapDataToSendFunction(getshipment, userId, RefreshToken, AdsRefreshToken)
                    (dataToSend, userId, Base_URI, Country, Region),
                tokenManager.wrapDataToSendFunction(getBrand, userId, RefreshToken, AdsRefreshToken)
                    (dataToSend, userId, Base_URI),
                tokenManager.wrapDataToSendFunction(getAmazonFees, userId, RefreshToken, AdsRefreshToken)
                    (dataToSend, userId, Base_URI, Country, Region, productData.ProductDetails),
                tokenManager.wrapDataToSendFunction(listFinancialEventsMethod, userId, RefreshToken, AdsRefreshToken)
                    (dataToSend, userId, Base_URI, Country, Region),
                tokenManager.wrapSpApiFunction(GetProductWiseFBAData, userId, RefreshToken, AdsRefreshToken)
                    (AccessToken, marketplaceIds, userId, Base_URI, Country, Region),
                tokenManager.wrapSpApiFunction(GET_LEDGER_SUMMARY_VIEW_DATA, userId, RefreshToken, AdsRefreshToken)
                    (AccessToken, marketplaceIds, Base_URI, userId, Country, Region)
            );
            thirdBatchServiceNames.push(
                "Weekly Sales", "Shipment Data", "Brand Data", "Amazon Fees",
                "Financial Events", "Fee Protector Data", "Ledger Summary View Data"
            );
        }

        if (AdsAccessToken) {
            let campaignids = [];
            if (apiData.campaignData.success && apiData.campaignData.data?.campaignData) {
                if (Array.isArray(apiData.campaignData.data.campaignData)) {
                    campaignids = apiData.campaignData.data.campaignData
                        .filter(item => item && item.campaignId)
                        .map(item => item.campaignId);
                }
            }

            thirdBatchPromises.push(
                tokenManager.wrapAdsFunction(getAdGroups, userId, RefreshToken, AdsRefreshToken)
                    (AdsAccessToken, ProfileId, Region, userId, Country, campaignids)
            );
            thirdBatchServiceNames.push("Ad Groups Data");
        }

        const thirdBatchResults = await Promise.allSettled(thirdBatchPromises);
        let thirdResultIndex = 0;

        if (AccessToken) {
            apiData.WeeklySales = processApiResult(thirdBatchResults[thirdResultIndex++], thirdBatchServiceNames[thirdResultIndex - 1]);
            apiData.shipment = processApiResult(thirdBatchResults[thirdResultIndex++], thirdBatchServiceNames[thirdResultIndex - 1]);
            apiData.brandData = processApiResult(thirdBatchResults[thirdResultIndex++], thirdBatchServiceNames[thirdResultIndex - 1]);
            apiData.feesResult = processApiResult(thirdBatchResults[thirdResultIndex++], thirdBatchServiceNames[thirdResultIndex - 1]);
            apiData.financeDataFromAPI = processApiResult(thirdBatchResults[thirdResultIndex++], thirdBatchServiceNames[thirdResultIndex - 1]);
            apiData.feeProtectorData = processApiResult(thirdBatchResults[thirdResultIndex++], thirdBatchServiceNames[thirdResultIndex - 1]);
            apiData.ledgerSummaryData = processApiResult(thirdBatchResults[thirdResultIndex++], thirdBatchServiceNames[thirdResultIndex - 1]);
        } else {
            apiData.WeeklySales = { success: false, data: null, error: "SP-API token not available" };
            apiData.shipment = { success: false, data: null, error: "SP-API token not available" };
            apiData.brandData = { success: false, data: null, error: "SP-API token not available" };
            apiData.feesResult = { success: false, data: null, error: "SP-API token not available" };
            apiData.financeDataFromAPI = { success: false, data: null, error: "SP-API token not available" };
            apiData.feeProtectorData = { success: false, data: null, error: "SP-API token not available" };
            apiData.ledgerSummaryData = { success: false, data: null, error: "SP-API token not available" };
        }

        if (AdsAccessToken) {
            apiData.adGroupsData = processApiResult(thirdBatchResults[thirdResultIndex++], thirdBatchServiceNames[thirdResultIndex - 1]);
        } else {
            apiData.adGroupsData = { success: false, data: null, error: "Ads token not available" };
        }
        logger.info("Third Batch Ends");

        // Fourth batch - Keywords
        logger.info("Fourth Batch Starts");
        if (AdsAccessToken) {
            const fourthBatchPromises = [
                tokenManager.wrapAdsFunction(getNegativeKeywords, userId, RefreshToken, AdsRefreshToken)
                    (AdsAccessToken, ProfileId, userId, Country, Region,
                        Array.isArray(campaignIdArray) ? campaignIdArray : [],
                        Array.isArray(adGroupIdArray) ? adGroupIdArray : []
                    ),
                tokenManager.wrapAdsFunction(getSearchKeywords, userId, RefreshToken, AdsRefreshToken)
                    (AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken)
            ];

            // Add keyword recommendations if we have ASINs
            const asinArray = Array.isArray(productData?.asinArray) ? productData.asinArray : [];
            if (asinArray.length > 0) {
                fourthBatchPromises.push(
                    tokenManager.wrapAdsFunction(getKeywordRecommendations, userId, RefreshToken, AdsRefreshToken)
                        (AdsAccessToken, ProfileId, userId, Country, Region, asinArray)
                );
            }

            const fourthBatchResults = await Promise.allSettled(fourthBatchPromises);

            apiData.negativeKeywords = processApiResult(fourthBatchResults[0], "Negative Keywords");
            apiData.searchKeywords = processApiResult(fourthBatchResults[1], "Search Keywords");
            
            // Process keyword recommendations result if it was included
            if (asinArray.length > 0) {
                apiData.keywordRecommendations = processApiResult(fourthBatchResults[2], "Keyword Recommendations");
            } else {
                apiData.keywordRecommendations = { success: false, data: null, error: "No ASINs available" };
            }
        } else {
            apiData.negativeKeywords = { success: false, data: null, error: "Ads token not available" };
            apiData.searchKeywords = { success: false, data: null, error: "Ads token not available" };
            apiData.keywordRecommendations = { success: false, data: null, error: "Ads token not available" };
        }
        logger.info("Fourth Batch Ends");

        // Process listing items
        apiData.genericKeyWordArray = await this.processListingItems(
            AccessToken, productData.skuArray, productData.asinArray, dataToSend,
            userId, Base_URI, Country, Region, RefreshToken, AdsRefreshToken, loggingHelper
        );

        return apiData;
    }

    /**
     * Get campaign and ad group IDs
     */
    static async getCampaignAndAdGroupIds(ppcSpendsBySKU, userId, Region, Country) {
        let campaignIdArray = [];
        let adGroupIdArray = [];

        try {
            const storedSponsoredAdsData = await ProductWiseSponsoredAdsData.findOne({
                userId: userId,
                region: Region,
                country: Country
            });

            if (storedSponsoredAdsData && Array.isArray(storedSponsoredAdsData.sponsoredAds)) {
                const campaignIds = new Set();
                const adGroupIds = new Set();

                storedSponsoredAdsData.sponsoredAds.forEach(ad => {
                    if (ad && ad.campaignId) campaignIds.add(ad.campaignId);
                    if (ad && ad.adGroupId) adGroupIds.add(ad.adGroupId);
                });

                campaignIdArray = Array.from(campaignIds);
                adGroupIdArray = Array.from(adGroupIds);
            } else if (ppcSpendsBySKU.success && ppcSpendsBySKU.data?.sponsoredAds) {
                const campaignIds = new Set();
                const adGroupIds = new Set();

                ppcSpendsBySKU.data.sponsoredAds.forEach(item => {
                    if (item && item.campaignId) campaignIds.add(item.campaignId);
                    if (item && item.adGroupId) adGroupIds.add(item.adGroupId);
                });

                campaignIdArray = Array.from(campaignIds);
                adGroupIdArray = Array.from(adGroupIds);
            }
        } catch (dbError) {
            logger.error("Database error while fetching sponsored ads data", {
                error: dbError.message,
                userId
            });
        }

        return { campaignIdArray, adGroupIdArray };
    }

    /**
     * Process competitive pricing
     */
    static async processCompetitivePricing(AccessToken, asinArray, dataToSend, userId, Base_URI, Country, Region, RefreshToken, AdsRefreshToken, loggingHelper) {
        logger.info("processCompetitivePricing starting");
        
        const competitivePriceData = [];

        if (!AccessToken || !Array.isArray(asinArray) || asinArray.length === 0) {
            logger.info("processCompetitivePricing ended");
            return competitivePriceData;
        }

        if (loggingHelper) {
            loggingHelper.logFunctionStart('getCompetitivePricing_chunked', {
                totalAsins: asinArray.length,
                chunkSize: 20
            });
        }

        try {
            const CHUNK_SIZE = 20;
            let start = 0;

            while (start < asinArray.length) {
                const end = Math.min(start + CHUNK_SIZE, asinArray.length);
                const asinArrayChunk = asinArray.slice(start, end);

                try {
                    const competitiveResponseData = await tokenManager.wrapDataToSendFunction(
                        getCompetitivePricing, userId, RefreshToken, AdsRefreshToken
                    )(asinArrayChunk, dataToSend, userId, Base_URI, Country, Region);

                    if (competitiveResponseData && Array.isArray(competitiveResponseData)) {
                        competitivePriceData.push(...competitiveResponseData);
                    }
                } catch (chunkError) {
                    logger.error(`Competitive pricing error for chunk ${start}-${end}`, {
                        error: chunkError.message
                    });
                }

                start = end;
                if (start < asinArray.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('getCompetitivePricing_chunked', competitivePriceData, {
                    recordsProcessed: asinArray.length,
                    recordsSuccessful: competitivePriceData.length
                });
            }
            
            logger.info("processCompetitivePricing ended");
        } catch (overallError) {
            logger.error("Overall competitive pricing processing failed", {
                error: overallError.message
            });
            if (loggingHelper) {
                loggingHelper.logFunctionError('getCompetitivePricing_chunked', overallError);
            }
        }

        return competitivePriceData;
    }

    /**
     * Process listing items
     */
    static async processListingItems(AccessToken, skuArray, asinArray, dataToSend, userId, Base_URI, Country, Region, RefreshToken, AdsRefreshToken, loggingHelper) {
        logger.info("processListingItems starting");
        
        const genericKeyWordArray = [];

        if (!AccessToken || !Array.isArray(skuArray) || !Array.isArray(asinArray) || skuArray.length === 0) {
            logger.info("processListingItems ended");
            return genericKeyWordArray;
        }

        if (loggingHelper) {
            loggingHelper.logFunctionStart('listingItems_processing', {
                totalSkus: skuArray.length
            });
        }

        try {
            const MAX_CONCURRENT_ITEMS = 50;
            const BATCH_SIZE = Math.min(MAX_CONCURRENT_ITEMS, skuArray.length);

            for (let batchStart = 0; batchStart < skuArray.length; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, skuArray.length);
                const batchSKUs = skuArray.slice(batchStart, batchEnd);
                const batchASINs = asinArray.slice(batchStart, batchEnd);

                const batchTasks = batchSKUs.map((sku, index) => {
                    return limit(async () => {
                        const delay = (index % 5) * 1000;
                        await new Promise(resolve => setTimeout(resolve, delay));

                        const asin = batchASINs[index];
                        if (!asin) return null;

                        try {
                            const ListingItem = await tokenManager.wrapDataToSendFunction(
                                GetListingItem, userId, RefreshToken, AdsRefreshToken
                            )(dataToSend, sku, asin, userId, Base_URI, Country, Region);

                            return ListingItem || null;
                        } catch (listingError) {
                            logger.error("Error processing listing item", {
                                error: listingError.message,
                                sku,
                                asin
                            });
                            return null;
                        }
                    });
                });

                const batchResults = await Promise.all(batchTasks);
                const validResults = batchResults.filter(result => result !== null);
                if (validResults.length > 0) {
                    genericKeyWordArray.push(...validResults);
                }

                if (batchEnd < skuArray.length) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('listingItems_processing', genericKeyWordArray, {
                    recordsProcessed: skuArray.length,
                    recordsSuccessful: genericKeyWordArray.length
                });
            }
            
            logger.info("processListingItems ended");
        } catch (listingError) {
            logger.error("Error during listing items processing", {
                error: listingError.message
            });
            if (loggingHelper) {
                loggingHelper.logFunctionError('listingItems_processing', listingError);
            }
        }

        return genericKeyWordArray;
    }

    /**
     * Process and save data
     */
    static async processAndSaveData(params) {
        logger.info("processAndSaveData starting");
        
        const { userId, Region, Country, apiData, productData, merchantListingsData, loggingHelper } = params;

        // Save competitive pricing
        if (apiData.competitivePriceData.length > 0 || productData.asinArray.length === 0) {
            try {
                await CompetitivePricing.create({
                    User: userId,
                    region: Region,
                    country: Country,
                    Products: apiData.competitivePriceData
                });
            } catch (dbError) {
                logger.error("Failed to save competitive pricing to database", {
                    error: dbError.message
                });
            }
        }


        // Save generic keywords
        if (Array.isArray(apiData.genericKeyWordArray) && apiData.genericKeyWordArray.length > 0) {
            try {
                await ListingItemsModel.create({
                    User: userId,
                    region: Region,
                    country: Country,
                    GenericKeyword: apiData.genericKeyWordArray
                });
            } catch (dbError) {
                logger.error("Failed to save generic keywords to database", {
                    error: dbError.message
                });
            }
        }
        
        logger.info("processAndSaveData ended");
    }

    /**
     * Create final result object
     */
    static createFinalResult(apiData, merchantListingsData, productData) {
        // Process finance data
        let financeData = [];
        if (apiData.financeDataFromAPI.success && apiData.financeDataFromAPI.data) {
            if (Array.isArray(apiData.financeDataFromAPI.data)) {
                financeData = apiData.financeDataFromAPI.data;
            } else if (typeof apiData.financeDataFromAPI.data === 'object') {
                const possibleArrays = ['financialEvents', 'events', 'data', 'items'];
                for (const prop of possibleArrays) {
                    if (Array.isArray(apiData.financeDataFromAPI.data[prop])) {
                        financeData = apiData.financeDataFromAPI.data[prop];
                        break;
                    }
                }
            }
        }

        return {
            MerchantlistingData: merchantListingsData || null,
            financeData: financeData,
            feesData: apiData.feesResult.success ? apiData.feesResult.data : null,
            v2data: apiData.v2data.success ? apiData.v2data.data : null,
            v1data: apiData.v1data.success ? apiData.v1data.data : null,
            competitivePriceData: Array.isArray(apiData.competitivePriceData) ? apiData.competitivePriceData : [],
            RestockinventoryData: apiData.RestockinventoryData.success ? apiData.RestockinventoryData.data : null,
            productReview: apiData.productReview.success ? apiData.productReview.data : null,
            WeeklySales: apiData.WeeklySales.success ? apiData.WeeklySales.data : null,
            shipment: apiData.shipment.success ? apiData.shipment.data : null,
            brandData: apiData.brandData.success ? apiData.brandData.data : null,
            adsKeywords: apiData.adsKeywords.success ? apiData.adsKeywords.data : null,
            adsKeywordsPerformanceData: apiData.adsKeywordsPerformanceData.success ? apiData.adsKeywordsPerformanceData.data : null,
            negativeKeywords: apiData.negativeKeywords.success ? apiData.negativeKeywords.data : null,
            searchKeywords: apiData.searchKeywords.success ? apiData.searchKeywords.data : null,
            ppcSpendsDateWise: apiData.ppcSpendsDateWise.success ? apiData.ppcSpendsDateWise.data : null,
            ppcSpendsBySKU: apiData.ppcSpendsBySKU.success ? apiData.ppcSpendsBySKU.data : null,
            campaignData: apiData.campaignData.success ? apiData.campaignData.data : null,
            adGroupsData: apiData.adGroupsData.success ? apiData.adGroupsData.data : null,
            fbaInventoryPlanningData: apiData.fbaInventoryPlanningData.success ? apiData.fbaInventoryPlanningData.data : null,
            strandedInventoryData: apiData.strandedInventoryData.success ? apiData.strandedInventoryData.data : null,
            inboundNonComplianceData: apiData.inboundNonComplianceData.success ? apiData.inboundNonComplianceData.data : null
        };
    }

    /**
     * Generate service summary
     */
    static generateServiceSummary(apiData) {
        const services = [
            { name: "V2 Seller Performance", result: apiData.v2data },
            { name: "V1 Seller Performance", result: apiData.v1data },
            { name: "PPC Spends by SKU", result: apiData.ppcSpendsBySKU },
            { name: "Ads Keywords Performance", result: apiData.adsKeywordsPerformanceData },
            { name: "PPC Spends Date Wise", result: apiData.ppcSpendsDateWise },
            { name: "Restock Inventory Recommendations", result: apiData.RestockinventoryData },
            { name: "Product Reviews", result: apiData.productReview },
            { name: "Ads Keywords", result: apiData.adsKeywords },
            { name: "Campaign Data", result: apiData.campaignData },
            { name: "FBA Inventory Planning", result: apiData.fbaInventoryPlanningData },
            { name: "Stranded Inventory", result: apiData.strandedInventoryData },
            { name: "Inbound Non-Compliance", result: apiData.inboundNonComplianceData },
            { name: "Weekly Sales", result: apiData.WeeklySales },
            { name: "Shipment Data", result: apiData.shipment },
            { name: "Brand Data", result: apiData.brandData },
            { name: "Amazon Fees", result: apiData.feesResult },
            { name: "Financial Events", result: apiData.financeDataFromAPI },
            { name: "Ad Groups Data", result: apiData.adGroupsData },
            { name: "Negative Keywords", result: apiData.negativeKeywords },
            { name: "Search Keywords", result: apiData.searchKeywords }
        ];

        const successful = [];
        const failed = [];
        const warnings = [];

        services.forEach(service => {
            if (service.result.success) {
                successful.push(service.name);
            } else {
                failed.push({
                    service: service.name,
                    error: service.result.error || "Unknown error"
                });
            }
        });

        const criticalServices = ["Financial Events", "Amazon Fees", "V2 Seller Performance", "Campaign Data"];
        const criticalFailures = failed.filter(f => criticalServices.includes(f.service));

        const overallSuccess = criticalFailures.length === 0;
        const successPercentage = Math.round((successful.length / services.length) * 100);

        return {
            successful,
            failed,
            warnings,
            criticalFailures,
            overallSuccess,
            successPercentage,
            totalServices: services.length
        };
    }

    /**
     * Handle success - send email and update history
     */
    static async handleSuccess(userId, Country, Region) {
        logger.info("handleSuccess starting");
        
        try {
            const userInfo = await userModel.findById(userId).select("analyseAccountSuccess email firstName");

            if (userInfo && userInfo.analyseAccountSuccess === 1) {
                if (userInfo.email && userInfo.firstName) {
                    const dashboardUrl = process.env.DASHBOARD_URL || `${process.env.CLIENT_BASE_URL}/dashboard`;
                    const emailSent = await sendAnalysisReadyEmail(
                        userInfo.email,
                        userInfo.firstName,
                        dashboardUrl
                    );

                    if (emailSent) {
                        userInfo.analyseAccountSuccess = 0;
                        await userInfo.save();
                    }
                }
            }
            
            logger.info("handleSuccess ended");
        } catch (emailError) {
            logger.error("Error sending analysis ready email", {
                error: emailError.message,
                userId
            });
        }
    }

    /**
     * Add new account history
     */
    static async addNewAccountHistory(userId, country, region) {
        logger.info("addNewAccountHistory starting");

        try {
            const getAnalyseData = await AnalyseService.Analyse(userId, country, region);

            if (getAnalyseData.status !== 200) {
                throw new Error('Failed to get analyse data');
            }

            const getCalculationData = await axios.post(
                `https://compute.sellerqi.com/calculation-api/calculate`,
                getAnalyseData.message
            );

            if (!getCalculationData?.data?.data?.dashboardData) {
                throw new Error('Failed to get calculation data');
            }

            const dashboardData = getCalculationData.data.data.dashboardData;
            const rankingErrors = dashboardData.TotalRankingerrors || 0;
            const conversionErrors = dashboardData.totalErrorInConversion || 0;
            const accountErrors = dashboardData.totalErrorInAccount || 0;
            const profitabilityErrors = dashboardData.totalProfitabilityErrors || 0;
            const sponsoredAdsErrors = dashboardData.totalSponsoredAdsErrors || 0;
            const inventoryErrors = dashboardData.totalInventoryErrors || 0;

            const totalIssues = rankingErrors + conversionErrors + accountErrors + profitabilityErrors + sponsoredAdsErrors + inventoryErrors;
            const healthScore = getAnalyseData.message.AccountData?.getAccountHealthPercentge?.Percentage || 0;
            const numberOfProductsWithIssues = dashboardData.productWiseError.length;

            const addAccountHistoryData = await addAccountHistory(
                userId,
                country,
                region,
                healthScore,
                "69",
                numberOfProductsWithIssues.toString(),
                totalIssues.toString()
            );

            if (!addAccountHistoryData) {
                throw new Error('Failed to add account history');
            }

            logger.info("addNewAccountHistory ended");
            return addAccountHistoryData;

        } catch (error) {
            logger.error("Error adding account history", {
                error: error.message,
                userId
            });
            return null;
        }
    }
}

module.exports = { Integration };

/**
 * ScheduledIntegration.js
 * 
 * Scheduled version of Integration service that only calls functions
 * based on the day of the week schedule.
 * 
 * This service is used by workers for automatic daily updates.
 * For new user registration, use Integration.js instead.
 */

const { generateAccessToken } = require('../Sp_API/GenerateTokens.js');
const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');
const logger = require('../../utils/Logger.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { URIs, marketplaceConfig, spapiRegions } = require('../../controllers/config/config.js');
const tokenManager = require('../../utils/TokenManager.js');
const LoggingHelper = require('../../utils/LoggingHelper.js');
const { getFunctionsForDay } = require('./ScheduleConfig.js');
const ListingItemsModel = require('../../models/products/GetListingItemsModel.js');
const ProductWiseSponsoredAdsData = require('../../models/amazon-ads/ProductWiseSponseredAdsModel.js');

class ScheduledIntegration {
    /**
     * Get scheduled API data based on day of week
     * @param {string} userId - User ID
     * @param {string} Region - Region (NA, EU, FE)
     * @param {string} Country - Country code
     * @param {number} [overrideDayOfWeek] - Optional: Override day of week for testing (0=Sunday, 6=Saturday)
     * @returns {Object} Result object with data and status
     */
    static async getScheduledApiData(userId, Region, Country, overrideDayOfWeek = undefined) {
        // Initialize logging session
        let loggingHelper = null;
        try {
            loggingHelper = new LoggingHelper(userId, Region, Country);
            await loggingHelper.initSession();
            loggingHelper.logFunctionStart('ScheduledIntegration.getScheduledApiData', {
                userId,
                region: Region,
                country: Country,
                requestOrigin: 'scheduled_worker'
            });
        } catch (loggingError) {
            logger.warn('Failed to initialize logging session', { error: loggingError.message, userId });
        }

        try {
            // Get current day of week (0 = Sunday, 6 = Saturday)
            // Allow override for testing purposes
            const dayOfWeek = overrideDayOfWeek !== undefined ? overrideDayOfWeek : new Date().getDay();
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayName = dayNames[dayOfWeek];
            if (overrideDayOfWeek !== undefined) {
                logger.info(`ScheduledIntegration: Testing for ${dayName} (day ${dayOfWeek}) - SIMULATED`, { userId, Region, Country });
            } else {
                logger.info(`ScheduledIntegration: Processing for ${dayName} (day ${dayOfWeek})`, { userId, Region, Country });
            }

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

            // Fetch merchant listings data (needed for product data)
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

            // Fetch scheduled API data based on day of week
            // dayOfWeek is already set above (either from params or current day)
            const apiData = await this.fetchScheduledApiData({
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
                loggingHelper,
                dayOfWeek: dayOfWeek // Pass the dayOfWeek to fetchScheduledApiData
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
                    loggingHelper.logFunctionSuccess('ScheduledIntegration.getScheduledApiData', result, {
                        recordsProcessed: serviceSummary.successful.length + serviceSummary.failed.length,
                        recordsSuccessful: serviceSummary.successful.length,
                        recordsFailed: serviceSummary.failed.length
                    });
                    await loggingHelper.endSession('completed');
                }
            } else {
                if (loggingHelper) {
                    loggingHelper.logFunctionWarning('ScheduledIntegration.getScheduledApiData', 'Some services failed', {
                        criticalFailures: serviceSummary.criticalFailures,
                        successRate: serviceSummary.successPercentage
                    });
                    await loggingHelper.endSession('partial');
                }
            }

            // Always add account history regardless of success (same as Integration.js)
            try {
                await this.addNewAccountHistory(userId, Country, Region);
            } catch (historyError) {
                logger.error("Error adding account history in ScheduledIntegration", {
                    error: historyError.message,
                    userId,
                    country: Country,
                    region: Region
                });
                // Don't fail the entire process if history fails
            }

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
            logger.error("Unexpected error in ScheduledIntegration.getScheduledApiData", {
                error: unexpectedError.message,
                stack: unexpectedError.stack,
                userId
            });

            if (loggingHelper) {
                loggingHelper.logFunctionError('ScheduledIntegration.getScheduledApiData', unexpectedError);
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
     * Validate input parameters (same as Integration)
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

        const mongoose = require('mongoose');
        if (mongoose.connection.readyState !== 1) {
            return { success: false, statusCode: 500, error: "Database connection unavailable" };
        }

        return { success: true };
    }

    /**
     * Get configuration for region and country (same as Integration)
     */
    static getConfiguration(Region, Country) {
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
     * Get seller data and tokens (same as Integration)
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

            // Validate ProfileId if AdsRefreshToken exists (Ads functions require ProfileId)
            if (AdsRefreshToken && !ProfileId) {
                logger.warn("Amazon Ads ProfileId is missing - Ads functions will be skipped", { userId, Region, Country });
                return {
                    success: false,
                    statusCode: 400,
                    error: "Amazon Ads ProfileId is missing. Please set up your Amazon Ads profile for this region and country."
                };
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
     * Generate AWS credentials (same as Integration)
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
     * Generate access tokens (same as Integration)
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
                const { generateAdsAccessToken } = require('../AmazonAds/GenerateToken.js');
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
     * Fetch merchant listings data (same as Integration)
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
            const GET_MERCHANT_LISTINGS_ALL_DATA = require('../Sp_API/GET_MERCHANT_LISTINGS_ALL_DATA.js');
            
            const merchantListingsData = await tokenManager.wrapSpApiFunction(
                GET_MERCHANT_LISTINGS_ALL_DATA, userId, RefreshToken, AdsRefreshToken
            )(AccessToken, marketplaceIds, userId, Country, Region, Base_URI);

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
     * Extract product data from merchant listings (same as Integration)
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
     * Prepare dataToSend object (same as Integration)
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
     * Fetch scheduled API data based on day of week
     * This is the main difference from Integration - only calls scheduled functions
     */
    static async fetchScheduledApiData(params) {
        const {
            AccessToken, AdsAccessToken, marketplaceIds, userId, Base_URI,
            Country, Region, ProfileId, RefreshToken, AdsRefreshToken,
            productData, dataToSend, loggingHelper, dayOfWeek
        } = params;

        const apiData = {};
        
        // Get functions scheduled for today
        const scheduledFunctions = getFunctionsForDay(dayOfWeek);
        logger.info(`ScheduledIntegration: Found ${Object.keys(scheduledFunctions).length} functions scheduled for day ${dayOfWeek}`);

        // Process API result helper (same as Integration)
        const processApiResult = (result, serviceName) => {
            if (result.status === 'fulfilled') {
                const value = result.value;
                
                const isFailure = value === false || 
                                 (value && typeof value === 'object' && value.success === false);
                
                if (isFailure) {
                    const errorMsg = value?.message || value?.error || 'Function returned failure indicator';
                    logger.error(`${serviceName} failed`, { error: errorMsg, userId });
                    if (loggingHelper) {
                        const errorObj = value instanceof Error ? value : new Error(errorMsg);
                        loggingHelper.logFunctionError(serviceName, errorObj);
                    }
                    return { success: false, data: null, error: errorMsg };
                }
                
                if (loggingHelper) {
                    const recordCount = Array.isArray(value) ? value.length : (value ? 1 : 0);
                    loggingHelper.logFunctionSuccess(serviceName, value, {
                        recordsProcessed: recordCount,
                        recordsSuccessful: recordCount
                    });
                }
                return { success: true, data: value, error: null };
            } else {
                const errorMsg = result.reason?.message || 'Unknown error';
                logger.error(`${serviceName} failed`, { error: errorMsg, userId });
                if (loggingHelper) {
                    loggingHelper.logFunctionError(serviceName, result.reason);
                }
                return { success: false, data: null, error: errorMsg };
            }
        };

        // Process scheduled functions in batches (same structure as Integration.js)
        // First batch: V2/V1 Seller Performance, PPC Spends by SKU, Ads Keywords Performance, PPC Spends Date Wise
        logger.info("First Batch Starts");
        const firstBatchPromises = [];
        const firstBatchServiceNames = [];

        // Second batch: Restock Inventory, FBA Inventory Planning, Stranded Inventory, Inbound Non-Compliance, Product Reviews, Ads Keywords, Campaign Data
        logger.info("Second Batch Starts");
        const secondBatchPromises = [];
        const secondBatchServiceNames = [];

        // Third batch: Shipment Data, Brand Data, Ad Groups Data, MCP Economics, MCP BuyBox
        logger.info("Third Batch Starts");
        const thirdBatchPromises = [];
        const thirdBatchServiceNames = [];

        // Fourth batch: Negative Keywords, Search Keywords, Keyword Recommendations
        logger.info("Fourth Batch Starts");
        const fourthBatchPromises = [];
        const fourthBatchServiceNames = [];

        // Helper function to add function to appropriate batch
        const addToBatch = (functionKey, functionConfig, promise, batchNumber) => {
            const { description } = functionConfig;
            switch(batchNumber) {
                case 1:
                    firstBatchPromises.push(promise);
                    firstBatchServiceNames.push(description);
                    break;
                case 2:
                    secondBatchPromises.push(promise);
                    secondBatchServiceNames.push(description);
                    break;
                case 3:
                    thirdBatchPromises.push(promise);
                    thirdBatchServiceNames.push(description);
                    break;
                case 4:
                    fourthBatchPromises.push(promise);
                    fourthBatchServiceNames.push(description);
                    break;
            }
        };

        // Process each scheduled function and assign to appropriate batch
        for (const [functionKey, functionConfig] of Object.entries(scheduledFunctions)) {
            const { service, functionName, description, requiresAccessToken, requiresAdsToken, requiresRefreshToken, apiDataKey } = functionConfig;
            
            // Use apiDataKey if provided, otherwise use functionKey
            const dataKey = apiDataKey || functionKey;

            // Check token requirements
            if (requiresAccessToken && !AccessToken) {
                logger.info(`Skipping ${description} - AccessToken not available`);
                apiData[dataKey] = { success: false, data: null, error: "SP-API token not available" };
                continue;
            }

            if (requiresAdsToken && !AdsAccessToken) {
                logger.info(`Skipping ${description} - AdsAccessToken not available`);
                apiData[dataKey] = { success: false, data: null, error: "Ads token not available" };
                continue;
            }

            if (requiresRefreshToken && !RefreshToken) {
                logger.info(`Skipping ${description} - RefreshToken not available`);
                apiData[dataKey] = { success: false, data: null, error: "Refresh token not available" };
                continue;
            }

            // Get the function from the service
            // Handle default exports (when functionName is null, service is the function itself)
            let serviceFunction;
            if (functionConfig.isDefaultExport || functionName === null) {
                // Service is the function itself (default export)
                serviceFunction = service;
            } else {
                // Service is an object, get the function by name
                serviceFunction = service[functionName];
            }
            
            if (!serviceFunction || typeof serviceFunction !== 'function') {
                logger.error(`Function not found or invalid for ${functionKey}. functionName: ${functionName}, isDefaultExport: ${functionConfig.isDefaultExport}`);
                apiData[dataKey] = { success: false, data: null, error: `Function not found for ${functionKey}` };
                continue;
            }

            // Prepare function arguments based on function type
            try {
                let promise;

                // Special handling for different function types
                if (functionKey === 'productReview') {
                    promise = serviceFunction(
                        Array.isArray(productData.asinArray) ? productData.asinArray : [],
                        Country,
                        userId,
                        Region
                    );
                } else if (functionKey === 'keywordRecommendations') {
                    const asinArray = Array.isArray(productData?.asinArray) ? productData.asinArray : [];
                    if (asinArray.length === 0) {
                        logger.info(`Skipping ${description} - No ASINs available`);
                        apiData[dataKey] = { success: false, data: null, error: "No ASINs available" };
                        continue;
                    }
                    promise = tokenManager.wrapAdsFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                        AdsAccessToken, ProfileId, userId, Country, Region, asinArray
                    );
                } else if (functionKey === 'adGroupsData') {
                    // Need campaign IDs first - will be available after batch 1
                    // Create a promise that resolves campaign IDs when needed
                    promise = Promise.resolve().then(async () => {
                        const { campaignIdArray } = await this.getCampaignAndAdGroupIds(
                            apiData.ppcSpendsBySKU || { success: false }, userId, Region, Country
                        );
                        return tokenManager.wrapAdsFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                            AdsAccessToken, ProfileId, Region, userId, Country, campaignIdArray || []
                        );
                    });
                } else if (functionKey === 'negativeKeywords') {
                    // Need campaign and ad group IDs - will be available after batch 1
                    promise = Promise.resolve().then(async () => {
                        const { campaignIdArray, adGroupIdArray } = await this.getCampaignAndAdGroupIds(
                            apiData.ppcSpendsBySKU || { success: false }, userId, Region, Country
                        );
                        return tokenManager.wrapAdsFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                            AdsAccessToken, ProfileId, userId, Country, Region,
                            campaignIdArray || [],
                            adGroupIdArray || []
                        );
                    });
                } else if (functionKey === 'mcpEconomicsData') {
                    // MCP Economics returns { success, data, error } structure
                    promise = serviceFunction(userId, RefreshToken, Region, Country).then(result => {
                        // Convert to standard format
                        if (result && result.success) {
                            return result.data || result;
                        } else {
                            throw new Error(result?.error || 'MCP Economics fetch failed');
                        }
                    });
                } else if (functionKey === 'mcpBuyBoxData') {
                    // MCP BuyBox returns { success, data, error } structure
                    promise = serviceFunction(userId, RefreshToken, Region, Country).then(result => {
                        // Convert to standard format
                        if (result && result.success) {
                            return result.data || result;
                        } else {
                            throw new Error(result?.error || 'MCP BuyBox fetch failed');
                        }
                    });
                } else if (requiresAdsToken) {
                    // Standard Ads function
                    if (functionKey === 'campaignData') {
                        promise = tokenManager.wrapAdsFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                            AdsAccessToken, ProfileId, Region, userId, Country
                        );
                    } else if (functionKey === 'searchKeywords') {
                        promise = tokenManager.wrapAdsFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                            AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken
                        );
                    } else {
                        promise = tokenManager.wrapAdsFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                            AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken
                        );
                    }
                } else if (requiresAccessToken) {
                    // Standard SP-API function
                    if (functionKey === 'shipment' || functionKey === 'brandData') {
                        promise = tokenManager.wrapDataToSendFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                            dataToSend, userId, Base_URI, Country, Region
                        );
                    } else {
                        promise = tokenManager.wrapSpApiFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                            AccessToken, marketplaceIds, userId, Base_URI, Country, Region
                        );
                    }
                } else {
                    // Reimbursement functions (calculation only, no API call)
                    promise = serviceFunction(userId, Country, Region);
                }

                // Assign to appropriate batch based on function key
                const batchNum = getBatchNumber(functionKey);
                addToBatch(functionKey, functionConfig, promise, batchNum);

            } catch (setupError) {
                logger.error(`Error setting up ${description}`, { error: setupError.message, userId });
                apiData[dataKey] = { success: false, data: null, error: setupError.message };
            }
        }

        // Execute batches sequentially (same as Integration.js)
        
        // First Batch
        if (firstBatchPromises.length > 0) {
            const firstBatchResults = await Promise.allSettled(firstBatchPromises);
            let resultIndex = 0;
            
            // Process V2/V1 data
            if (scheduledFunctions['v2data'] && AccessToken) {
                apiData.v2data = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1] || 'V2 Seller Performance Report');
            } else if (scheduledFunctions['v2data']) {
                apiData.v2data = { success: false, data: null, error: "SP-API token not available" };
            }
            
            if (scheduledFunctions['v1data'] && AccessToken) {
                apiData.v1data = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1] || 'V1 Seller Performance Report');
            } else if (scheduledFunctions['v1data']) {
                apiData.v1data = { success: false, data: null, error: "SP-API token not available" };
            }
            
            // Process Ads data
            if (scheduledFunctions['ppcSpendsBySKU'] && AdsAccessToken) {
                apiData.ppcSpendsBySKU = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1] || 'PPC Spends by SKU');
            } else if (scheduledFunctions['ppcSpendsBySKU']) {
                apiData.ppcSpendsBySKU = { success: false, data: null, error: "Ads token not available" };
            }
            
            if (scheduledFunctions['adsKeywordsPerformanceData'] && AdsAccessToken) {
                apiData.adsKeywordsPerformanceData = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1] || 'Ads Keywords Performance');
            } else if (scheduledFunctions['adsKeywordsPerformanceData']) {
                apiData.adsKeywordsPerformanceData = { success: false, data: null, error: "Ads token not available" };
            }
            
            if (scheduledFunctions['ppcSpendsDateWise'] && AdsAccessToken) {
                apiData.ppcSpendsDateWise = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1] || 'PPC Spends Date Wise');
            } else if (scheduledFunctions['ppcSpendsDateWise']) {
                apiData.ppcSpendsDateWise = { success: false, data: null, error: "Ads token not available" };
            }
        }
        logger.info("First Batch Ends");

        // Get campaign and ad group IDs (needed for batch 3 and 4)
        const { campaignIdArray, adGroupIdArray } = await this.getCampaignAndAdGroupIds(
            apiData.ppcSpendsBySKU || { success: false }, userId, Region, Country
        );

        // Second Batch
        if (secondBatchPromises.length > 0) {
            logger.info("Second Batch Starts");
            const secondBatchResults = await Promise.allSettled(secondBatchPromises);
            let resultIndex = 0;
            
            // Process results in order
            for (const serviceName of secondBatchServiceNames) {
                // Find the corresponding function key
                const functionKey = Object.keys(scheduledFunctions).find(key => 
                    scheduledFunctions[key].description === serviceName
                );
                if (functionKey && resultIndex < secondBatchResults.length) {
                    const dataKey = scheduledFunctions[functionKey].apiDataKey || functionKey;
                    if (!apiData[dataKey]) { // Not already set (skipped)
                        apiData[dataKey] = processApiResult(secondBatchResults[resultIndex], serviceName);
                    }
                    resultIndex++;
                }
            }
        }
        logger.info("Second Batch Ends");

        // Third Batch
        if (thirdBatchPromises.length > 0) {
            logger.info("Third Batch Starts");
            const thirdBatchResults = await Promise.allSettled(thirdBatchPromises);
            let resultIndex = 0;
            
            // Process results in order
            for (const serviceName of thirdBatchServiceNames) {
                const functionKey = Object.keys(scheduledFunctions).find(key => 
                    scheduledFunctions[key].description === serviceName
                );
                if (functionKey && resultIndex < thirdBatchResults.length) {
                    const dataKey = scheduledFunctions[functionKey].apiDataKey || functionKey;
                    if (!apiData[dataKey]) {
                        // Special handling for MCP functions
                        if (functionKey === 'mcpEconomicsData' || functionKey === 'mcpBuyBoxData') {
                            const result = thirdBatchResults[resultIndex];
                            if (result.status === 'fulfilled' && result.value?.success) {
                                apiData[dataKey] = { success: true, data: result.value.data, error: null };
                            } else {
                                const errorMsg = result.status === 'rejected' 
                                    ? (result.reason?.message || 'Promise rejected')
                                    : (result.value?.error || 'Unknown error');
                                apiData[dataKey] = { success: false, data: null, error: errorMsg };
                            }
                        } else {
                            apiData[dataKey] = processApiResult(thirdBatchResults[resultIndex], serviceName);
                        }
                    }
                    resultIndex++;
                }
            }
        }
        logger.info("Third Batch Ends");

        // Fourth Batch
        if (fourthBatchPromises.length > 0) {
            logger.info("Fourth Batch Starts");
            const fourthBatchResults = await Promise.allSettled(fourthBatchPromises);
            let resultIndex = 0;
            
            // Process results in order
            for (const serviceName of fourthBatchServiceNames) {
                const functionKey = Object.keys(scheduledFunctions).find(key => 
                    scheduledFunctions[key].description === serviceName
                );
                if (functionKey && resultIndex < fourthBatchResults.length) {
                    const dataKey = scheduledFunctions[functionKey].apiDataKey || functionKey;
                    if (!apiData[dataKey]) {
                        apiData[dataKey] = processApiResult(fourthBatchResults[resultIndex], serviceName);
                    }
                    resultIndex++;
                }
            }
        }
        logger.info("Fourth Batch Ends");

        // Process listing items if scheduled (simplified version)
        if (scheduledFunctions['GetListingItem'] && AccessToken) {
            logger.info("Processing Listing Items (simplified)");
            // For scheduled runs, we'll skip the complex batch processing
            // This can be enhanced later if needed
            apiData.genericKeyWordArray = [];
        } else {
            apiData.genericKeyWordArray = [];
        }

        return apiData;
    }

    /**
     * Get campaign and ad group IDs (same as Integration)
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
     * Process and save data (same as Integration)
     */
    static async processAndSaveData(params) {
        logger.info("processAndSaveData starting");
        
        const { userId, Region, Country, apiData, productData, merchantListingsData, loggingHelper } = params;

        // Save generic keywords if available
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
     * Create final result object (same as Integration)
     */
    static createFinalResult(apiData, merchantListingsData, productData) {
        return {
            MerchantlistingData: merchantListingsData || null,
            v2data: apiData.v2data?.success ? apiData.v2data.data : null,
            v1data: apiData.v1data?.success ? apiData.v1data.data : null,
            RestockinventoryData: apiData.RestockinventoryData?.success ? apiData.RestockinventoryData.data : null,
            productReview: apiData.productReview?.success ? apiData.productReview.data : null,
            shipment: apiData.shipment?.success ? apiData.shipment.data : null,
            brandData: apiData.brandData?.success ? apiData.brandData.data : null,
            adsKeywords: apiData.adsKeywords?.success ? apiData.adsKeywords.data : null,
            adsKeywordsPerformanceData: apiData.adsKeywordsPerformanceData?.success ? apiData.adsKeywordsPerformanceData.data : null,
            negativeKeywords: apiData.negativeKeywords?.success ? apiData.negativeKeywords.data : null,
            searchKeywords: apiData.searchKeywords?.success ? apiData.searchKeywords.data : null,
            ppcSpendsDateWise: apiData.ppcSpendsDateWise?.success ? apiData.ppcSpendsDateWise.data : null,
            ppcSpendsBySKU: apiData.ppcSpendsBySKU?.success ? apiData.ppcSpendsBySKU.data : null,
            campaignData: apiData.campaignData?.success ? apiData.campaignData.data : null,
            adGroupsData: apiData.adGroupsData?.success ? apiData.adGroupsData.data : null,
            fbaInventoryPlanningData: apiData.fbaInventoryPlanningData?.success ? apiData.fbaInventoryPlanningData.data : null,
            strandedInventoryData: apiData.strandedInventoryData?.success ? apiData.strandedInventoryData.data : null,
            inboundNonComplianceData: apiData.inboundNonComplianceData?.success ? apiData.inboundNonComplianceData.data : null,
            mcpEconomicsData: apiData.mcpEconomicsData?.success ? apiData.mcpEconomicsData.data : null,
            mcpBuyBoxData: apiData.mcpBuyBoxData?.success ? apiData.mcpBuyBoxData.data : null,
            keywordRecommendations: apiData.keywordRecommendations?.success ? apiData.keywordRecommendations.data : null
        };
    }

    /**
     * Generate service summary (same as Integration)
     */
    static generateServiceSummary(apiData) {
        const services = [];
        
        // Add all services that were attempted
        for (const [key, value] of Object.entries(apiData)) {
            if (value && typeof value === 'object' && 'success' in value) {
                services.push({
                    name: key,
                    result: value
                });
            }
        }

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

        const criticalServices = ["mcpEconomicsData", "v2data", "campaignData"];
        const criticalFailures = failed.filter(f => criticalServices.includes(f.service));

        const overallSuccess = criticalFailures.length === 0;
        const successPercentage = services.length > 0 ? Math.round((successful.length / services.length) * 100) : 0;

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
     * Handle success (same as Integration)
     */
    static async handleSuccess(userId, Country, Region) {
        logger.info("handleSuccess starting");
        
        try {
            const userModel = require('../../models/user-auth/userModel.js');
            const { sendAnalysisReadyEmail } = require('../Email/SendAnalysisReadyEmail.js');
            
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
     * Same implementation as Integration.js
     * Uses local calculation service instead of external calculation server
     */
    static async addNewAccountHistory(userId, country, region) {
        logger.info("addNewAccountHistory starting");

        try {
            const { AnalyseService } = require('../main/Analyse.js');
            const { addAccountHistory } = require('../History/addAccountHistory.js');
            
            const getAnalyseData = await AnalyseService.Analyse(userId, country, region);

            if (getAnalyseData.status !== 200) {
                throw new Error('Failed to get analyse data');
            }

            // Use local calculation service instead of external server
            const { analyseData } = require('../Calculations/DashboardCalculation.js');
            const calculationResult = await analyseData(getAnalyseData.message, userId);

            if (!calculationResult?.dashboardData) {
                throw new Error('Failed to calculate dashboard data');
            }

            const dashboardData = calculationResult.dashboardData;
            const rankingErrors = dashboardData.TotalRankingerrors || 0;
            const conversionErrors = dashboardData.totalErrorInConversion || 0;
            const accountErrors = dashboardData.totalErrorInAccount || 0;
            const profitabilityErrors = dashboardData.totalProfitabilityErrors || 0;
            const sponsoredAdsErrors = dashboardData.totalSponsoredAdsErrors || 0;
            const inventoryErrors = dashboardData.totalInventoryErrors || 0;

            const totalIssues = rankingErrors + conversionErrors + accountErrors + profitabilityErrors + sponsoredAdsErrors + inventoryErrors;
            const healthScore = getAnalyseData.message.AccountData?.getAccountHealthPercentge?.Percentage || 0;
            const numberOfProductsWithIssues = dashboardData.productWiseError?.length || 0;
            const totalProducts = dashboardData.TotalProduct?.length || 0;

            // Log the values being saved for debugging
            logger.info("Saving account history", {
                userId,
                country,
                region,
                healthScore,
                totalProducts,
                numberOfProductsWithIssues,
                totalIssues,
                healthScoreSource: getAnalyseData.message.AccountData?.getAccountHealthPercentge,
                hasV2Data: !!getAnalyseData.message.AccountData?.getAccountHealthPercentge,
                rankingErrors,
                conversionErrors,
                accountErrors,
                profitabilityErrors,
                sponsoredAdsErrors,
                inventoryErrors
            });

            const addAccountHistoryData = await addAccountHistory(
                userId,
                country,
                region,
                healthScore,
                totalProducts.toString(),
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

module.exports = { ScheduledIntegration };


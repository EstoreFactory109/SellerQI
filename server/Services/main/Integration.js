/**
 * Integration Service
 * 
 * Main service for fetching all SP-API and Amazon Ads data.
 * Handles parallel batch processing of multiple API calls.
 */

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
const { markFirstAnalysisDone } = require('../User/userServices.js');
const { yieldToEventLoop } = require('../../utils/asyncCsvParser.js');

// Helper function to add timeout to promises
const withTimeout = (promise, timeoutMs, operationName) => {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
};

// Models - use service layers for models that can hit 16MB limit
// ListingItems service handles 16MB limit with separate collection
const { saveListingItemsData } = require('../products/ListingItemsService.js');
// ProductWiseSponsoredAds service handles 16MB limit with separate collection
const { getProductWiseSponsoredAdsData } = require('../amazon-ads/ProductWiseSponsoredAdsService.js');

// SP-API Services
const GET_MERCHANT_LISTINGS_ALL_DATA = require('../Sp_API/GET_MERCHANT_LISTINGS_ALL_DATA.js');
const GET_V2_SELLER_PERFORMANCE_REPORT = require('../Sp_API/V2_Seller_Performance_Report.js');
const GET_V1_SELLER_PERFORMANCE_REPORT = require('../Sp_API/GET_V1_SELLER_PERFORMANCE_REPORT.js');
const GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT = require('../Sp_API/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT.js');
const { addReviewDataTODatabase } = require('../Sp_API/NumberOfProductReviews.js');
const { GetListingItem, GetListingItemIssuesForInactive } = require('../Sp_API/GetListingItemsIssues.js');
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
const { getPPCMetrics } = require('../AmazonAds/GetPPCMetrics.js');
const { getPPCUnitsSold } = require('../AmazonAds/GetPPCUnitsSold.js');

// Other Services
const { getBrand } = require('../Sp_API/GetBrand.js');
const GET_FBA_INVENTORY_PLANNING_DATA = require('../Sp_API/GET_FBA_INVENTORY_PLANNING_DATA.js');
const GET_STRANDED_INVENTORY_UI_DATA = require('../Sp_API/GET_STRANDED_INVENTORY_UI_DATA.js');
const GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA = require('../Sp_API/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA.js');
const { addAccountHistory } = require('../History/addAccountHistory.js');
const { AnalyseService } = require('./Analyse.js');

const GET_LEDGER_SUMMARY_VIEW_DATA = require('../Sp_API/GET_LEDGER_SUMMARY_VIEW_DATA.js');
const GET_LEDGER_DETAIL_VIEW_DATA = require('../Sp_API/GET_LEDGER_DETAIL_VIEW_DATA.js');
const GET_FBA_REIMBURSEMENTS_DATA = require('../Sp_API/GET_FBA_REIMBURSEMENTS_DATA.js');

// MCP Services for Economics data
const { fetchAndStoreEconomicsData } = require('../MCP/MCPEconomicsIntegration.js');

// MCP Services for BuyBox data
const { fetchAndStoreBuyBoxData } = require('../MCP/MCPBuyBoxIntegration.js');

// Data Fetch Tracking for calendar-affecting services
const DataFetchTrackingService = require('../system/DataFetchTrackingService.js');

// Redis cache clearing
const { clearAnalyseCache } = require('../../middlewares/redisCache.js');

// Issue Summary Service for precomputed dashboard issue counts
const { storeIssueSummaryFromDashboardData } = require('../Calculations/IssueSummaryService.js');

// Issues Data Service for precomputed detailed issues data (used by Issues pages)
const { storeIssuesDataFromDashboard } = require('../Calculations/IssuesDataService.js');

// Product Issues Service for per-product issue counts
const { storeProductIssuesFromDashboardData } = require('../Calculations/ProductIssuesService.js');

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

        // Track data fetch for calendar-affecting services (defined outside try for catch access)
        let trackingEntry = null;

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

            // Start tracking for calendar-affecting services (first-time user fetch)
            // For new users, ALL calendar-affecting services run regardless of day
            // Calculate the data date range (30 days ending yesterday)
            const trackingEndDate = new Date();
            trackingEndDate.setDate(trackingEndDate.getDate() - 1); // Yesterday
            const trackingStartDate = new Date(trackingEndDate);
            trackingStartDate.setDate(trackingStartDate.getDate() - 30); // 30 days before yesterday
            
            const formatTrackingDate = (date) => {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };
            
            try {
                trackingEntry = await DataFetchTrackingService.startTracking(
                    userId,
                    Country,
                    Region,
                    { startDate: formatTrackingDate(trackingStartDate), endDate: formatTrackingDate(trackingEndDate) },
                    loggingHelper?.sessionId || null
                );
                logger.info('[Integration] Data fetch tracking started (first-time user)', {
                    trackingId: trackingEntry._id,
                    dayName: trackingEntry.dayName,
                    dateString: trackingEntry.dateString,
                    dataRange: { startDate: formatTrackingDate(trackingStartDate), endDate: formatTrackingDate(trackingEndDate) }
                });
            } catch (trackingError) {
                logger.warn('[Integration] Failed to start tracking (non-critical)', {
                    error: trackingError.message,
                    userId,
                    Country,
                    Region
                });
            }

            // Fetch merchant listings data
            const merchantListingsData = await this.fetchMerchantListings(
                AccessToken, marketplaceIds, userId, Country, Region, Base_URI,
                RefreshToken, AdsRefreshToken, loggingHelper
            );

            // Yield to event loop to allow lock renewal
            await new Promise(resolve => setImmediate(resolve));

            // Extract product data (active products)
            const productData = await this.extractProductData(merchantListingsData, Country, Region);

            // Extract inactive product data for issues fetching
            const inactiveProductData = await this.extractInactiveProductData(merchantListingsData, Country, Region);

            // Prepare dataToSend object
            const dataToSend = this.prepareDataToSend(
                Marketplace_Id, AccessToken, credentials, productData.asinArray,
                Country, sellerId
            );

            // Yield to event loop to allow lock renewal
            await new Promise(resolve => setImmediate(resolve));

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

            // Yield to event loop to allow lock renewal
            await new Promise(resolve => setImmediate(resolve));

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

            // Yield to event loop to allow lock renewal
            await new Promise(resolve => setImmediate(resolve));

            // Process inactive SKUs to fetch and store their issues
            if (inactiveProductData.inactiveSkuArray.length > 0) {
                logger.info("Processing inactive SKUs for issues", { 
                    inactiveCount: inactiveProductData.inactiveSkuArray.length 
                });
                await this.processInactiveListingItems(
                    AccessToken,
                    inactiveProductData.inactiveSkuArray,
                    inactiveProductData.inactiveAsinArray,
                    dataToSend,
                    userId,
                    Base_URI,
                    Country,
                    Region,
                    RefreshToken,
                    AdsRefreshToken,
                    loggingHelper
                );
            }

            // Yield to event loop to allow lock renewal
            await new Promise(resolve => setImmediate(resolve));

            // Clear the Redis cache after new data is saved
            // This ensures the next dashboard request gets fresh calculated data
            try {
                await clearAnalyseCache(userId, Country, Region, null);
                logger.info('Redis cache cleared after successful data fetch', { userId, Country, Region });
            } catch (cacheError) {
                logger.warn('Failed to clear Redis cache', { error: cacheError.message, userId, Country, Region });
                // Don't fail the request if cache clearing fails
            }

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
                    loggingHelper.logFunctionWarning('Integration.getSpApiData', 'All services failed', {
                        failedServices: serviceSummary.failed,
                        successRate: serviceSummary.successPercentage
                    });
                    await loggingHelper.endSession('failed');
                }
            }

            // Always add account history regardless of success
            try {
                await this.addNewAccountHistory(userId, Country, Region);
            } catch (historyError) {
                logger.error("Error adding account history in Integration.getSpApiData", {
                    error: historyError.message,
                    stack: historyError.stack,
                    userId,
                    country: Country,
                    region: Region
                });
                // Don't fail the entire process if history fails
            }

            // Complete tracking for calendar-affecting services
            if (trackingEntry) {
                try {
                    if (serviceSummary.overallSuccess) {
                        await DataFetchTrackingService.completeTracking(trackingEntry._id);
                        logger.info('[Integration] Data fetch tracking completed successfully', {
                            trackingId: trackingEntry._id
                        });
                    } else if (serviceSummary.failed.length > 0 && serviceSummary.successful.length > 0) {
                        // Partial success - some services succeeded, some failed
                        trackingEntry.status = 'partial';
                        await trackingEntry.save();
                        logger.info('[Integration] Data fetch tracking completed with partial success', {
                            trackingId: trackingEntry._id,
                            successfulCount: serviceSummary.successful.length,
                            failedCount: serviceSummary.failed.length
                        });
                    } else {
                        // All services failed
                        await DataFetchTrackingService.failTracking(trackingEntry._id, 'All services failed');
                        logger.info('[Integration] Data fetch tracking marked as failed', {
                            trackingId: trackingEntry._id,
                            failedCount: serviceSummary.failed.length
                        });
                    }
                } catch (trackingError) {
                    logger.warn('[Integration] Failed to complete tracking (non-critical)', {
                        error: trackingError.message,
                        trackingId: trackingEntry._id
                    });
                }
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
                    failures: serviceSummary.failed
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

            // Mark tracking as failed if it was started
            if (trackingEntry) {
                try {
                    await DataFetchTrackingService.failTracking(trackingEntry._id, unexpectedError.message);
                    logger.info('[Integration] Data fetch tracking marked as failed due to unexpected error', {
                        trackingId: trackingEntry._id
                    });
                } catch (trackingError) {
                    logger.warn('[Integration] Failed to mark tracking as failed', {
                        error: trackingError.message
                    });
                }
            }

            // Still try to add account history even if there was an error
            // This ensures history is recorded even on failed fetches
            try {
                await this.addNewAccountHistory(userId, Country, Region);
                logger.info("Account history added after unexpected error", { userId, country: Country, region: Region });
            } catch (historyError) {
                logger.error("Error adding account history after unexpected error", {
                    error: historyError.message,
                    stack: historyError.stack,
                    userId,
                    country: Country,
                    region: Region
                });
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
     * Uses chunked processing with yields to prevent blocking the event loop
     */
    static async extractProductData(merchantListingsData, Country, Region) {
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

        // Process in chunks to yield to the event loop and allow lock renewal
        const CHUNK_SIZE = 500;
        for (let i = 0; i < activeProducts.length; i += CHUNK_SIZE) {
            const chunk = activeProducts.slice(i, i + CHUNK_SIZE);
            
            for (const product of chunk) {
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
            }
            
            // Yield to event loop after each chunk to allow lock renewal
            if (i + CHUNK_SIZE < activeProducts.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        logger.info("extractProductData ended");
        return { asinArray, skuArray, ProductDetails };
    }

    /**
     * Extract inactive product data from merchant listings
     * Returns arrays of ASINs and SKUs for inactive products only
     * Uses chunked processing with yields to prevent blocking the event loop
     */
    static async extractInactiveProductData(merchantListingsData, Country, Region) {
        logger.info("extractInactiveProductData starting");
        
        const inactiveAsinArray = [];
        const inactiveSkuArray = [];

        if (!merchantListingsData || !Array.isArray(merchantListingsData.sellerAccount)) {
            logger.info("extractInactiveProductData ended - no merchant data");
            return { inactiveAsinArray, inactiveSkuArray };
        }

        const merchantSellerAccounts = merchantListingsData.sellerAccount;
        const SellerAccount = merchantSellerAccounts.find(item => item && item.country === Country && item.region === Region);

        if (!SellerAccount || !Array.isArray(SellerAccount.products)) {
            logger.info("extractInactiveProductData ended - no seller account");
            return { inactiveAsinArray, inactiveSkuArray };
        }

        // Filter products with status "Inactive" or "Incomplete"
        const inactiveProducts = SellerAccount.products.filter(product => {
            if (!product || typeof product !== 'object') return false;
            if (product.status !== "Inactive" && product.status !== "Incomplete") return false;
            if (!product.asin || typeof product.asin !== 'string' || product.asin.trim() === '') return false;
            if (!product.sku || typeof product.sku !== 'string' || product.sku.trim() === '') return false;
            return true;
        });

        // Process in chunks to yield to the event loop and allow lock renewal
        const CHUNK_SIZE = 500;
        for (let i = 0; i < inactiveProducts.length; i += CHUNK_SIZE) {
            const chunk = inactiveProducts.slice(i, i + CHUNK_SIZE);
            
            for (const product of chunk) {
                inactiveAsinArray.push(product.asin.trim());
                inactiveSkuArray.push(product.sku.trim());
            }
            
            // Yield to event loop after each chunk to allow lock renewal
            if (i + CHUNK_SIZE < inactiveProducts.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        logger.info("extractInactiveProductData ended", { 
            inactiveCount: inactiveAsinArray.length 
        });
        return { inactiveAsinArray, inactiveSkuArray };
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
                const value = result.value;
                
                // Check if the returned value indicates failure
                // Some functions return false or { success: false, message: "..." } on failure
                const isFailure = value === false || 
                                 (value && typeof value === 'object' && value.success === false);
                
                if (isFailure) {
                    const errorMsg = value?.message || value?.error || 'Function returned failure indicator';
                    logger.error(`${serviceName} failed`, { error: errorMsg, userId });
                    if (loggingHelper) {
                        // Create an error-like object for logging
                        const errorObj = value instanceof Error ? value : new Error(errorMsg);
                        loggingHelper.logFunctionError(serviceName, errorObj);
                    }
                    return { success: false, data: null, error: errorMsg };
                }
                
                // Success case
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
                    (AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken),
                // PPC Metrics - aggregated campaign data from SP, SB, SD
                getPPCMetrics(AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken, null, null, true),
                // PPC Units Sold - date-wise units sold data
                getPPCUnitsSold(AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken, null, null, true)
            );
            firstBatchServiceNames.push("PPC Spends by SKU", "Ads Keywords Performance", "PPC Spends Date Wise", "PPC Metrics (Aggregated)", "PPC Units Sold");
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
            apiData.ppcMetricsAggregated = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1]);
            apiData.ppcUnitsSold = processApiResult(firstBatchResults[resultIndex++], firstBatchServiceNames[resultIndex - 1]);
        } else {
            apiData.ppcSpendsBySKU = { success: false, data: null, error: "Ads token not available" };
            apiData.adsKeywordsPerformanceData = { success: false, data: null, error: "Ads token not available" };
            apiData.ppcSpendsDateWise = { success: false, data: null, error: "Ads token not available" };
            apiData.ppcMetricsAggregated = { success: false, data: null, error: "Ads token not available" };
            apiData.ppcUnitsSold = { success: false, data: null, error: "Ads token not available" };
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
                    (AccessToken, marketplaceIds, userId, Base_URI, Country, Region),
                // Reimbursement data fetching (for complete reimbursement calculations on first sign-in)
                tokenManager.wrapSpApiFunction(GET_LEDGER_SUMMARY_VIEW_DATA, userId, RefreshToken, AdsRefreshToken)
                    (AccessToken, marketplaceIds, userId, Base_URI, Country, Region),
                tokenManager.wrapSpApiFunction(GET_LEDGER_DETAIL_VIEW_DATA, userId, RefreshToken, AdsRefreshToken)
                    (AccessToken, marketplaceIds, userId, Base_URI, Country, Region),
                tokenManager.wrapSpApiFunction(GET_FBA_REIMBURSEMENTS_DATA, userId, RefreshToken, AdsRefreshToken)
                    (AccessToken, marketplaceIds, userId, Base_URI, Country, Region)
            );
            secondBatchServiceNames.push(
                "Restock Inventory Recommendations",
                "FBA Inventory Planning",
                "Stranded Inventory",
                "Inbound Non-Compliance",
                "Ledger Summary View Data",
                "Ledger Detail View Data",
                "FBA Reimbursements Data"
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
            // Reimbursement data results
            apiData.ledgerSummaryData = processApiResult(secondBatchResults[secondResultIndex++], secondBatchServiceNames[secondResultIndex - 1]);
            apiData.ledgerDetailViewData = processApiResult(secondBatchResults[secondResultIndex++], secondBatchServiceNames[secondResultIndex - 1]);
            apiData.fbaReimbursementsData = processApiResult(secondBatchResults[secondResultIndex++], secondBatchServiceNames[secondResultIndex - 1]);
        } else {
            apiData.RestockinventoryData = { success: false, data: null, error: "SP-API token not available" };
            apiData.fbaInventoryPlanningData = { success: false, data: null, error: "SP-API token not available" };
            apiData.strandedInventoryData = { success: false, data: null, error: "SP-API token not available" };
            apiData.inboundNonComplianceData = { success: false, data: null, error: "SP-API token not available" };
            // Reimbursement data fallbacks
            apiData.ledgerSummaryData = { success: false, data: null, error: "SP-API token not available" };
            apiData.ledgerDetailViewData = { success: false, data: null, error: "SP-API token not available" };
            apiData.fbaReimbursementsData = { success: false, data: null, error: "SP-API token not available" };
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

        // Third batch
        logger.info("Third Batch Starts");
        const thirdBatchPromises = [];
        const thirdBatchServiceNames = [];

        if (AccessToken) {
            thirdBatchPromises.push(
                tokenManager.wrapDataToSendFunction(getshipment, userId, RefreshToken, AdsRefreshToken)
                    (dataToSend, userId, Base_URI, Country, Region),
                tokenManager.wrapDataToSendFunction(getBrand, userId, RefreshToken, AdsRefreshToken)
                    (dataToSend, userId, Base_URI)
            );
            thirdBatchServiceNames.push("Shipment Data", "Brand Data");
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

        // Add MCP Economics fetch to third batch (runs in parallel)
        if (RefreshToken) {
            thirdBatchPromises.push(
                fetchAndStoreEconomicsData(userId, RefreshToken, Region, Country)
            );
            thirdBatchServiceNames.push("MCP Economics Data");
        }

        const thirdBatchResults = await Promise.allSettled(thirdBatchPromises);
        let thirdResultIndex = 0;

        if (AccessToken) {
            apiData.shipment = processApiResult(thirdBatchResults[thirdResultIndex++], thirdBatchServiceNames[thirdResultIndex - 1]);
            apiData.brandData = processApiResult(thirdBatchResults[thirdResultIndex++], thirdBatchServiceNames[thirdResultIndex - 1]);
        } else {
            apiData.shipment = { success: false, data: null, error: "SP-API token not available" };
            apiData.brandData = { success: false, data: null, error: "SP-API token not available" };
        }

        if (AdsAccessToken) {
            apiData.adGroupsData = processApiResult(thirdBatchResults[thirdResultIndex++], thirdBatchServiceNames[thirdResultIndex - 1]);
        } else {
            apiData.adGroupsData = { success: false, data: null, error: "Ads token not available" };
        }

        // Process MCP Economics and BuyBox results
        if (RefreshToken) {
            try {
                const mcpEconomicsResult = thirdBatchResults[thirdResultIndex++];
                if (mcpEconomicsResult.status === 'fulfilled' && mcpEconomicsResult.value?.success) {
                    apiData.mcpEconomicsData = { 
                        success: true, 
                        data: mcpEconomicsResult.value.data, 
                        error: null 
                    };
                    logger.info("MCP Economics data fetched successfully", {
                        userId,
                        region: Region,
                        country: Country
                    });
                } else {
                    const errorMsg = mcpEconomicsResult.status === 'rejected' 
                        ? (mcpEconomicsResult.reason?.message || mcpEconomicsResult.reason?.toString() || 'Promise rejected')
                        : (mcpEconomicsResult.value?.error || 'Unknown error');
                    apiData.mcpEconomicsData = { 
                        success: false, 
                        data: null, 
                        error: errorMsg 
                    };
                    logger.warn("MCP Economics data fetch failed", { 
                        error: errorMsg,
                        userId,
                        region: Region,
                        country: Country,
                        resultStatus: mcpEconomicsResult.status,
                        hasValue: !!mcpEconomicsResult.value
                    });
                }
            } catch (mcpError) {
                logger.error("Error processing MCP Economics result", {
                    error: mcpError.message,
                    stack: mcpError.stack,
                    userId,
                    region: Region,
                    country: Country
                });
                apiData.mcpEconomicsData = { 
                    success: false, 
                    data: null, 
                    error: `Error processing MCP Economics: ${mcpError.message}` 
                };
            }
        } else {
            apiData.mcpEconomicsData = { success: false, data: null, error: "Refresh token not available" };
            logger.info("MCP Economics skipped - no refresh token", { userId, region: Region, country: Country });
        }

        // Fetch BuyBox data (runs after Economics)
        if (RefreshToken) {
            try {
                logger.info("Fetching MCP BuyBox data", { userId, region: Region, country: Country });
                const buyBoxResult = await fetchAndStoreBuyBoxData(userId, RefreshToken, Region, Country);
                if (buyBoxResult.success) {
                    apiData.mcpBuyBoxData = { 
                        success: true, 
                        data: buyBoxResult.data, 
                        error: null 
                    };
                    logger.info("MCP BuyBox data fetched successfully", {
                        userId,
                        region: Region,
                        country: Country,
                        productsWithoutBuyBox: buyBoxResult.data?.productsWithoutBuyBox
                    });
                } else {
                    apiData.mcpBuyBoxData = { 
                        success: false, 
                        data: null, 
                        error: buyBoxResult.error || 'Unknown error' 
                    };
                    logger.warn("MCP BuyBox data fetch failed", { 
                        error: buyBoxResult.error,
                        userId,
                        region: Region,
                        country: Country
                    });
                }
            } catch (buyBoxError) {
                logger.error("Error fetching MCP BuyBox data", {
                    error: buyBoxError.message,
                    stack: buyBoxError.stack,
                    userId,
                    region: Region,
                    country: Country
                });
                apiData.mcpBuyBoxData = { 
                    success: false, 
                    data: null, 
                    error: `Error fetching BuyBox data: ${buyBoxError.message}` 
                };
            }
        } else {
            apiData.mcpBuyBoxData = { success: false, data: null, error: "Refresh token not available" };
            logger.info("MCP BuyBox skipped - no refresh token", { userId, region: Region, country: Country });
        }
        
        // Set legacy fields to indicate they're no longer used (for backward compatibility)
        apiData.WeeklySales = { success: false, data: null, error: "Deprecated - Use MCP Economics data" };
        apiData.feesResult = { success: false, data: null, error: "Deprecated - Use MCP Economics data" };
        apiData.financeDataFromAPI = { success: false, data: null, error: "Deprecated - Use MCP Economics data" };
        apiData.feeProtectorData = { success: false, data: null, error: "Deprecated - Use MCP Economics data" };
        // Note: ledgerSummaryData is now fetched in Second Batch for reimbursement calculations
        
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
        logger.info("Processing Listing Items");
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
            // Use service layer that handles both old (embedded array) and new (separate collection) formats
            const storedSponsoredAdsData = await getProductWiseSponsoredAdsData(userId, Country, Region);

            if (storedSponsoredAdsData && Array.isArray(storedSponsoredAdsData.sponsoredAds)) {
                const campaignIds = new Set();
                const adGroupIds = new Set();
                const SET_BUILD_CHUNK_SIZE = 500;

                // Chunked iteration for large arrays to prevent event loop blocking
                const sponsoredAds = storedSponsoredAdsData.sponsoredAds;
                for (let i = 0; i < sponsoredAds.length; i++) {
                    const ad = sponsoredAds[i];
                    if (ad && ad.campaignId) campaignIds.add(ad.campaignId);
                    if (ad && ad.adGroupId) adGroupIds.add(ad.adGroupId);
                    if ((i + 1) % SET_BUILD_CHUNK_SIZE === 0) {
                        await yieldToEventLoop();
                    }
                }

                campaignIdArray = Array.from(campaignIds);
                adGroupIdArray = Array.from(adGroupIds);
            } else if (ppcSpendsBySKU.success && ppcSpendsBySKU.data?.sponsoredAds) {
                const campaignIds = new Set();
                const adGroupIds = new Set();
                const SET_BUILD_CHUNK_SIZE = 500;

                // Chunked iteration for large arrays to prevent event loop blocking
                const sponsoredAds = ppcSpendsBySKU.data.sponsoredAds;
                for (let i = 0; i < sponsoredAds.length; i++) {
                    const item = sponsoredAds[i];
                    if (item && item.campaignId) campaignIds.add(item.campaignId);
                    if (item && item.adGroupId) adGroupIds.add(item.adGroupId);
                    if ((i + 1) % SET_BUILD_CHUNK_SIZE === 0) {
                        await yieldToEventLoop();
                    }
                }

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
            
            // Update B2B pricing for active products
            const b2bPricingData = genericKeyWordArray
                .filter(item => item && item.has_b2b_pricing !== undefined)
                .map(item => ({
                    sku: item.sku,
                    asin: item.asin,
                    has_b2b_pricing: item.has_b2b_pricing
                }));
            
            if (b2bPricingData.length > 0) {
                await this.updateSellerProductB2BPricing(userId, Country, Region, b2bPricingData);
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
     * Process inactive listing items and fetch their issues from Amazon SP-API
     * Updates the Seller model with issues for each inactive SKU
     * 
     * MEMORY OPTIMIZATION: Instead of accumulating all results and updating at the end,
     * we now update the Seller model per batch. This prevents holding all inactive
     * item results in memory at once, which could cause OOM for large catalogs.
     */
    static async processInactiveListingItems(AccessToken, inactiveSkuArray, inactiveAsinArray, dataToSend, userId, Base_URI, Country, Region, RefreshToken, AdsRefreshToken, loggingHelper) {
        logger.info("processInactiveListingItems starting", { 
            inactiveSkuCount: inactiveSkuArray?.length || 0 
        });
        
        // Track total processed count for logging (don't accumulate full results)
        let totalProcessedCount = 0;

        if (!AccessToken || !Array.isArray(inactiveSkuArray) || !Array.isArray(inactiveAsinArray) || inactiveSkuArray.length === 0) {
            logger.info("processInactiveListingItems ended - no inactive SKUs to process");
            return [];
        }

        if (loggingHelper) {
            loggingHelper.logFunctionStart('inactiveListingItems_processing', {
                totalInactiveSkus: inactiveSkuArray.length
            });
        }

        try {
            const MAX_CONCURRENT_ITEMS = 50;
            const BATCH_SIZE = Math.min(MAX_CONCURRENT_ITEMS, inactiveSkuArray.length);
            const totalBatches = Math.ceil(inactiveSkuArray.length / BATCH_SIZE);

            logger.info("processInactiveListingItems batch processing", {
                totalSKUs: inactiveSkuArray.length,
                batchSize: BATCH_SIZE,
                totalBatches
            });

            for (let batchStart = 0; batchStart < inactiveSkuArray.length; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, inactiveSkuArray.length);
                const batchSKUs = inactiveSkuArray.slice(batchStart, batchEnd);
                const batchASINs = inactiveAsinArray.slice(batchStart, batchEnd);
                const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;

                logger.info("processInactiveListingItems processing batch", {
                    batchNumber,
                    batchStart: batchStart + 1,
                    batchEnd,
                    batchSize: batchSKUs.length,
                    totalSKUs: inactiveSkuArray.length
                });

                const batchTasks = batchSKUs.map((sku, index) => {
                    return limit(async () => {
                        const delay = (index % 5) * 1000;
                        await new Promise(resolve => setTimeout(resolve, delay));

                        const asin = batchASINs[index];
                        if (!asin) return null;

                        try {
                            const issuesResult = await tokenManager.wrapDataToSendFunction(
                                GetListingItemIssuesForInactive, userId, RefreshToken, AdsRefreshToken
                            )(dataToSend, sku, asin, userId, Base_URI, Country, Region);

                            return issuesResult || null;
                        } catch (listingError) {
                            logger.error("Error processing inactive listing item issues", {
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
                totalProcessedCount += validResults.length;

                // MEMORY OPTIMIZATION: Update Seller model immediately after each batch
                // instead of accumulating all results until the end
                if (validResults.length > 0) {
                    // Update issues for this batch
                    await this.updateSellerProductIssues(userId, Country, Region, validResults);
                    
                    // Update B2B pricing for this batch
                    const b2bPricingData = validResults
                        .filter(item => item && item.has_b2b_pricing !== undefined)
                        .map(item => ({
                            sku: item.sku,
                            asin: item.asin,
                            has_b2b_pricing: item.has_b2b_pricing
                        }));
                    
                    if (b2bPricingData.length > 0) {
                        await this.updateSellerProductB2BPricing(userId, Country, Region, b2bPricingData);
                    }
                }

                logger.info("processInactiveListingItems batch completed", {
                    batchNumber,
                    batchProcessed: validResults.length,
                    batchTotal: batchSKUs.length,
                    totalProcessed: totalProcessedCount,
                    totalRemaining: inactiveSkuArray.length - batchEnd
                });

                if (batchEnd < inactiveSkuArray.length) {
                    logger.info("processInactiveListingItems waiting before next batch", {
                        waitTime: "2000ms"
                    });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('inactiveListingItems_processing', { count: totalProcessedCount }, {
                    recordsProcessed: inactiveSkuArray.length,
                    recordsSuccessful: totalProcessedCount
                });
            }
            
            logger.info("processInactiveListingItems ended", {
                processedCount: totalProcessedCount
            });
        } catch (listingError) {
            logger.error("Error during inactive listing items processing", {
                error: listingError.message
            });
            if (loggingHelper) {
                loggingHelper.logFunctionError('inactiveListingItems_processing', listingError);
            }
        }

        // Return empty array - data is already saved to DB per batch
        // This prevents holding all results in memory
        return [];
    }

    /**
     * Update Seller model with B2B pricing for products
     */
    static async updateSellerProductB2BPricing(userId, Country, Region, b2bPricingDataArray) {
        logger.info("updateSellerProductB2BPricing starting", {
            b2bPricingCount: b2bPricingDataArray.length
        });

        try {
            const sellerDetails = await Seller.findOne({ User: userId });
            
            if (!sellerDetails) {
                logger.error("Seller not found for updating B2B pricing", { userId });
                return false;
            }

            // Find the matching seller account
            const accountIndex = sellerDetails.sellerAccount.findIndex(
                account => account.country === Country && account.region === Region
            );

            if (accountIndex === -1) {
                logger.error("Seller account not found for country/region", { userId, Country, Region });
                return false;
            }

            // Create a map of SKU to B2B pricing for quick lookup (chunked for large datasets)
            const b2bPricingMap = new Map();
            const MAP_BUILD_CHUNK_SIZE = 500;
            for (let i = 0; i < b2bPricingDataArray.length; i++) {
                const item = b2bPricingDataArray[i];
                if (item && item.sku && item.has_b2b_pricing !== undefined) {
                    b2bPricingMap.set(item.sku, item.has_b2b_pricing);
                }
                // Yield periodically for large arrays
                if ((i + 1) % MAP_BUILD_CHUNK_SIZE === 0) {
                    await yieldToEventLoop();
                }
            }

            // Update the products array with B2B pricing (chunked to yield to event loop)
            const products = sellerDetails.sellerAccount[accountIndex].products;
            let updatedCount = 0;
            const CHUNK_SIZE = 200;

            for (let i = 0; i < products.length; i += CHUNK_SIZE) {
                const chunk = products.slice(i, Math.min(i + CHUNK_SIZE, products.length));
                for (const product of chunk) {
                    if (b2bPricingMap.has(product.sku)) {
                        product.has_b2b_pricing = b2bPricingMap.get(product.sku);
                        updatedCount++;
                    }
                }
                // Yield to event loop to allow lock extension
                await yieldToEventLoop();
            }

            await sellerDetails.save();

            logger.info("updateSellerProductB2BPricing ended", {
                updatedCount,
                totalProducts: products.length
            });

            return true;
        } catch (error) {
            logger.error("Error updating seller product B2B pricing", {
                error: error.message,
                userId
            });
            return false;
        }
    }

    /**
     * Update Seller model with issues for inactive products
     */
    static async updateSellerProductIssues(userId, Country, Region, issuesDataArray) {
        logger.info("updateSellerProductIssues starting", {
            issuesCount: issuesDataArray.length
        });

        try {
            const sellerDetails = await Seller.findOne({ User: userId });
            
            if (!sellerDetails) {
                logger.error("Seller not found for updating product issues", { userId });
                return false;
            }

            // Find the matching seller account
            const accountIndex = sellerDetails.sellerAccount.findIndex(
                account => account.country === Country && account.region === Region
            );

            if (accountIndex === -1) {
                logger.error("Seller account not found for country/region", { userId, Country, Region });
                return false;
            }

            // Create a map of SKU to issues for quick lookup (chunked for large datasets)
            const issuesMap = new Map();
            const MAP_BUILD_CHUNK_SIZE = 500;
            for (let i = 0; i < issuesDataArray.length; i++) {
                const item = issuesDataArray[i];
                if (item && item.sku && Array.isArray(item.issues)) {
                    issuesMap.set(item.sku, item.issues);
                }
                // Yield periodically for large arrays
                if ((i + 1) % MAP_BUILD_CHUNK_SIZE === 0) {
                    await yieldToEventLoop();
                }
            }

            // Update the products array with issues (chunked to yield to event loop)
            const products = sellerDetails.sellerAccount[accountIndex].products;
            let updatedCount = 0;
            const CHUNK_SIZE = 200;

            for (let i = 0; i < products.length; i += CHUNK_SIZE) {
                const chunk = products.slice(i, Math.min(i + CHUNK_SIZE, products.length));
                for (const product of chunk) {
                    // Update issues for both Inactive and Incomplete products
                    if ((product.status === 'Inactive' || product.status === 'Incomplete') && issuesMap.has(product.sku)) {
                        product.issues = issuesMap.get(product.sku);
                        updatedCount++;
                    }
                }
                // Yield to event loop to allow lock extension
                await yieldToEventLoop();
            }

            await sellerDetails.save();

            logger.info("updateSellerProductIssues ended", {
                updatedCount,
                totalProducts: products.length
            });

            return true;
        } catch (error) {
            logger.error("Error updating seller product issues", {
                error: error.message,
                userId
            });
            return false;
        }
    }

    /**
     * Process and save data
     */
    static async processAndSaveData(params) {
        logger.info("processAndSaveData starting");
        
        const { userId, Region, Country, apiData, productData, merchantListingsData, loggingHelper } = params;

        // Save generic keywords - Uses service layer to prevent 16MB limit
        if (Array.isArray(apiData.genericKeyWordArray) && apiData.genericKeyWordArray.length > 0) {
            try {
                await saveListingItemsData(userId, Country, Region, apiData.genericKeyWordArray);
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
            ppcMetricsAggregated: apiData.ppcMetricsAggregated?.success ? apiData.ppcMetricsAggregated.data : null,
            ppcUnitsSold: apiData.ppcUnitsSold?.success ? apiData.ppcUnitsSold.data : null,
            campaignData: apiData.campaignData.success ? apiData.campaignData.data : null,
            adGroupsData: apiData.adGroupsData.success ? apiData.adGroupsData.data : null,
            fbaInventoryPlanningData: apiData.fbaInventoryPlanningData.success ? apiData.fbaInventoryPlanningData.data : null,
            strandedInventoryData: apiData.strandedInventoryData.success ? apiData.strandedInventoryData.data : null,
            inboundNonComplianceData: apiData.inboundNonComplianceData.success ? apiData.inboundNonComplianceData.data : null,
            // MCP Economics and BuyBox data
            mcpEconomicsData: apiData.mcpEconomicsData.success ? apiData.mcpEconomicsData.data : null,
            mcpBuyBoxData: apiData.mcpBuyBoxData.success ? apiData.mcpBuyBoxData.data : null
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
            { name: "PPC Metrics (Aggregated)", result: apiData.ppcMetricsAggregated || { success: false, data: null, error: "Not available" } },
            { name: "PPC Units Sold", result: apiData.ppcUnitsSold || { success: false, data: null, error: "Not available" } },
            { name: "Restock Inventory Recommendations", result: apiData.RestockinventoryData },
            { name: "Product Reviews", result: apiData.productReview },
            { name: "Ads Keywords", result: apiData.adsKeywords },
            { name: "Campaign Data", result: apiData.campaignData },
            { name: "FBA Inventory Planning", result: apiData.fbaInventoryPlanningData },
            { name: "Stranded Inventory", result: apiData.strandedInventoryData },
            { name: "Inbound Non-Compliance", result: apiData.inboundNonComplianceData },
            { name: "MCP Economics Data", result: apiData.mcpEconomicsData }, // New: Track MCP Economics service
            { name: "MCP BuyBox Data", result: apiData.mcpBuyBoxData }, // New: Track MCP BuyBox service
            { name: "Shipment Data", result: apiData.shipment },
            { name: "Brand Data", result: apiData.brandData },
            { name: "Ad Groups Data", result: apiData.adGroupsData },
            { name: "Negative Keywords", result: apiData.negativeKeywords },
            { name: "Search Keywords", result: apiData.searchKeywords }
            // Note: WeeklySales, feesResult, financeDataFromAPI are deprecated and not tracked
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

        // All services are treated equally - no critical/non-critical distinction
        // Success is determined by having at least one service succeed
        const successPercentage = Math.round((successful.length / services.length) * 100);
        
        // Consider overall success if at least one service succeeded
        // This ensures partial data is still usable and the job doesn't fail entirely
        const overallSuccess = successful.length > 0;

        return {
            successful,
            failed,
            warnings,
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
                        
                        // Mark first analysis as done when email is successfully sent
                        // This flag indicates the analysis is complete and dashboard is ready
                        await markFirstAnalysisDone(userId);
                        logger.info(`FirstAnalysisDone marked as true for user ${userId}`);
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
     * Now uses local calculation service instead of external calculation server
     */
    static async addNewAccountHistory(userId, country, region) {
        logger.info("addNewAccountHistory starting", { userId, country, region });

        try {
            // Validate input parameters
            if (!userId || !country || !region) {
                logger.error("addNewAccountHistory: Missing required parameters", {
                    userId,
                    country,
                    region
                });
                throw new Error('Missing required parameters');
            }

            const getAnalyseData = await AnalyseService.Analyse(userId, country, region);

            if (!getAnalyseData || getAnalyseData.status !== 200) {
                logger.error("addNewAccountHistory: Failed to get analyse data", {
                    userId,
                    country,
                    region,
                    status: getAnalyseData?.status,
                    hasMessage: !!getAnalyseData?.message
                });
                throw new Error(`Failed to get analyse data: status ${getAnalyseData?.status}`);
            }

            // Use local calculation service instead of external server
            const { analyseData } = require('../Calculations/DashboardCalculation.js');
            const calculationResult = await analyseData(getAnalyseData.message, userId);

            if (!calculationResult?.dashboardData) {
                logger.error("addNewAccountHistory: Failed to calculate dashboard data", {
                    userId,
                    country,
                    region,
                    hasResult: !!calculationResult,
                    hasDashboardData: !!calculationResult?.dashboardData
                });
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
                totalProducts,
                numberOfProductsWithIssues,
                totalIssues
            );

            if (!addAccountHistoryData) {
                throw new Error('Failed to add account history - null result');
            }

            // Store issue summary for quick dashboard access
            // This uses the already-calculated dashboardData to avoid re-fetching
            logger.info("[Integration] Starting issue storage operations", {
                userId,
                country,
                region,
                hasProductWiseError: !!dashboardData.productWiseError,
                productWiseErrorCount: dashboardData.productWiseError?.length || 0,
                hasRankingErrors: !!dashboardData.rankingProductWiseErrors,
                rankingErrorsCount: dashboardData.rankingProductWiseErrors?.length || 0,
                hasConversionErrors: !!dashboardData.conversionProductWiseErrors,
                conversionErrorsCount: dashboardData.conversionProductWiseErrors?.length || 0,
                hasInventoryErrors: !!dashboardData.inventoryProductWiseErrors,
                inventoryErrorsCount: dashboardData.inventoryProductWiseErrors?.length || 0
            });

            try {
                const issueSummaryResult = await storeIssueSummaryFromDashboardData(
                    userId,
                    country,
                    region,
                    dashboardData,
                    'integration'
                );
                
                if (issueSummaryResult.success) {
                    logger.info("Issue summary stored successfully", { 
                        userId, 
                        country, 
                        region,
                        totalIssues: issueSummaryResult.data?.totalIssues 
                    });
                } else {
                    logger.warn("Failed to store issue summary", {
                        userId,
                        country,
                        region,
                        error: issueSummaryResult.error
                    });
                }
            } catch (issueSummaryError) {
                // Don't fail the entire process if issue summary storage fails
                logger.error("Error storing issue summary", {
                    error: issueSummaryError.message,
                    userId,
                    country,
                    region
                });
            }

            // Store detailed issues data for Issues pages (Category.jsx, IssuesByProduct.jsx)
            // This enables fast loading of Issues pages without full recalculation
            try {
                const issuesDataResult = await storeIssuesDataFromDashboard(
                    userId,
                    country,
                    region,
                    dashboardData,
                    'integration'
                );
                
                if (issuesDataResult.success) {
                    logger.info("Issues data stored successfully", { 
                        userId, 
                        country, 
                        region,
                        productCount: dashboardData.productWiseError?.length || 0
                    });
                } else {
                    logger.warn("Failed to store issues data", {
                        userId,
                        country,
                        region,
                        error: issuesDataResult.error
                    });
                }
            } catch (issuesDataError) {
                // Don't fail the entire process if issues data storage fails
                logger.error("Error storing issues data", {
                    error: issuesDataError.message,
                    userId,
                    country,
                    region
                });
            }

            // Store per-product issue counts
            // This uses the productWiseError from dashboardData
            try {
                const productIssuesResult = await storeProductIssuesFromDashboardData(
                    userId,
                    country,
                    region,
                    dashboardData,
                    'integration'
                );
                
                if (productIssuesResult.success) {
                    logger.info("Product issues stored successfully", { 
                        userId, 
                        country, 
                        region,
                        updatedCount: productIssuesResult.data?.updatedCount,
                        productsWithIssues: productIssuesResult.data?.productsWithIssues
                    });
                } else {
                    logger.warn("Failed to store product issues", {
                        userId,
                        country,
                        region,
                        error: productIssuesResult.error
                    });
                }
            } catch (productIssuesError) {
                // Don't fail the entire process if product issues storage fails
                logger.error("Error storing product issues", {
                    error: productIssuesError.message,
                    userId,
                    country,
                    region
                });
            }

            logger.info("addNewAccountHistory completed successfully", { userId, country, region });
            return addAccountHistoryData;

        } catch (error) {
            logger.error("Error in addNewAccountHistory", {
                error: error.message,
                stack: error.stack,
                userId,
                country,
                region
            });
            throw error; // Re-throw so caller can handle
        }
    }

    // ========================================================================
    // PHASE EXECUTION METHODS
    // These methods are used by the chained job architecture to split the
    // integration into smaller, manageable phases that won't exceed lock duration.
    // ========================================================================

    /**
     * Execute Phase 1: Init
     * Validates user, generates tokens, fetches merchant listings, extracts product data
     * 
     * @param {string} userId - User ID
     * @param {string} Region - Region (NA, EU, FE)
     * @param {string} Country - Country code
     * @returns {Object} Phase result with data needed by subsequent phases
     */
    static async executeInitPhase(userId, Region, Country) {
        logger.info(`[Integration:InitPhase] Starting for user ${userId}, ${Country}-${Region}`);
        
        // Create a logging session for the entire integration run
        let loggingHelper = null;
        let sessionId = null;
        try {
            loggingHelper = new LoggingHelper(userId, Region, Country);
            await loggingHelper.initSession();
            sessionId = loggingHelper.sessionId;
            loggingHelper.logFunctionStart('Integration.InitPhase', {
                userId,
                region: Region,
                country: Country
            });
        } catch (sessionError) {
            // Log but don't fail - session creation is supplementary
            logger.warn(`[Integration:InitPhase] Failed to create logging session: ${sessionError.message}`);
        }

        try {
            // Validate inputs
            const validationResult = await this.validateInputs(userId, Region, Country);
            if (!validationResult.success) {
                return {
                    success: false,
                    error: validationResult.error,
                    statusCode: validationResult.statusCode
                };
            }

            // Get configuration
            const config = this.getConfiguration(Region, Country);
            if (!config.success) {
                return {
                    success: false,
                    error: config.error,
                    statusCode: config.statusCode
                };
            }

            const { Base_URI, Marketplace_Id, regionConfig, marketplaceIds } = config;

            // Get seller data and tokens
            const sellerDataResult = await this.getSellerDataAndTokens(userId, Region, Country);
            if (!sellerDataResult.success) {
                return {
                    success: false,
                    error: sellerDataResult.error,
                    statusCode: sellerDataResult.statusCode
                };
            }

            const { RefreshToken, AdsRefreshToken, ProfileId, sellerId } = sellerDataResult;

            // Generate AWS credentials
            const credentialsResult = await this.generateCredentials(regionConfig, null);
            if (!credentialsResult.success) {
                return {
                    success: false,
                    error: credentialsResult.error,
                    statusCode: credentialsResult.statusCode
                };
            }

            const credentials = credentialsResult.credentials;

            // Generate access tokens
            const tokenResult = await this.generateTokens(userId, RefreshToken, AdsRefreshToken, null);
            if (!tokenResult.success) {
                return {
                    success: false,
                    error: tokenResult.error,
                    statusCode: tokenResult.statusCode
                };
            }

            const { AccessToken, AdsAccessToken } = tokenResult;

            // Initialize TokenManager
            tokenManager.setTokens(userId, AccessToken, AdsAccessToken, RefreshToken, AdsRefreshToken);

            // Fetch merchant listings data (this stores to DB)
            const merchantListingsData = await this.fetchMerchantListings(
                AccessToken, marketplaceIds, userId, Country, Region, Base_URI,
                RefreshToken, AdsRefreshToken, null
            );

            // Extract product data (active products)
            const productData = await this.extractProductData(merchantListingsData, Country, Region);

            // Extract inactive product data for issues fetching
            const inactiveProductData = await this.extractInactiveProductData(merchantListingsData, Country, Region);

            logger.info(`[Integration:InitPhase] Completed for user ${userId}`, {
                asinCount: productData.asinArray?.length || 0,
                skuCount: productData.skuArray?.length || 0,
                inactiveCount: inactiveProductData.inactiveSkuArray?.length || 0
            });

            // Log phase success (don't end session - it continues through phases)
            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('Integration.InitPhase', null, {
                    recordsProcessed: productData.asinArray?.length || 0,
                    recordsSuccessful: productData.asinArray?.length || 0
                });
                await loggingHelper.saveSession();
            }

            return {
                success: true,
                dataForNextPhase: {
                    asinArray: productData.asinArray,
                    skuArray: productData.skuArray,
                    inactiveSkuArray: inactiveProductData.inactiveSkuArray,
                    inactiveAsinArray: inactiveProductData.inactiveAsinArray,
                    sellerId,
                    hasAdsAccount: !!AdsRefreshToken,
                    sessionId // Pass sessionId to next phases
                }
            };

        } catch (error) {
            logger.error(`[Integration:InitPhase] Failed for user ${userId}:`, error);
            
            // Log phase failure
            if (loggingHelper) {
                loggingHelper.logFunctionError('Integration.InitPhase', error);
                await loggingHelper.saveSession();
            }
            
            return {
                success: false,
                error: error.message,
                statusCode: 500,
                sessionId // Pass sessionId even on failure for worker to end session
            };
        }
    }

    /**
     * Helper function to process batch results and log individual service errors to the session.
     * This ensures per-service errors are stored in the error model for the phased flow.
     * 
     * @param {Array} results - Array of Promise.allSettled results
     * @param {Array} serviceNames - Array of service names corresponding to results
     * @param {string} sessionId - Session ID to log to
     * @param {string} userId - User ID for context
     * @param {string} region - Region for context
     * @param {string} country - Country for context
     * @param {string} phaseName - Name of the phase for logging
     * @returns {Object} Summary of successful and failed services
     */
    static async processAndLogBatchResults(results, serviceNames, sessionId, userId, region, country, phaseName) {
        const successful = [];
        const failed = [];

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const serviceName = serviceNames[i] || `Unknown Service ${i}`;

            if (result.status === 'fulfilled') {
                const value = result.value;
                
                // Check if the returned value indicates failure
                const isFailure = value === false ||
                    value === null ||
                    (value && typeof value === 'object' && value.success === false);

                if (isFailure) {
                    const errorMsg = value?.message || value?.error || 'Function returned failure indicator';
                    logger.error(`[${phaseName}] ${serviceName} failed`, { error: errorMsg, userId });
                    failed.push({ name: serviceName, error: errorMsg });

                    // Log error to session
                    if (sessionId) {
                        try {
                            await LoggingHelper.addLogToSession(sessionId, {
                                functionName: serviceName,
                                logType: 'error',
                                status: 'failed',
                                message: `${serviceName} failed: ${errorMsg}`,
                                errorDetails: {
                                    errorMessage: errorMsg,
                                    phase: phaseName
                                },
                                contextData: { userId, region, country }
                            });
                        } catch (logError) {
                            logger.warn(`[${phaseName}] Failed to log error for ${serviceName}: ${logError.message}`);
                        }
                    }
                } else {
                    successful.push(serviceName);
                    // Log success to session
                    if (sessionId) {
                        try {
                            const recordCount = Array.isArray(value) ? value.length : 
                                (value?.data ? (Array.isArray(value.data) ? value.data.length : 1) : (value ? 1 : 0));
                            await LoggingHelper.addLogToSession(sessionId, {
                                functionName: serviceName,
                                logType: 'success',
                                status: 'completed',
                                message: `${serviceName} completed successfully`,
                                dataMetrics: {
                                    recordsProcessed: recordCount,
                                    recordsSuccessful: recordCount
                                },
                                contextData: { userId, region, country }
                            });
                        } catch (logError) {
                            logger.warn(`[${phaseName}] Failed to log success for ${serviceName}: ${logError.message}`);
                        }
                    }
                }
            } else {
                // Promise was rejected
                const errorMsg = result.reason?.message || result.reason?.toString() || 'Unknown error';
                logger.error(`[${phaseName}] ${serviceName} failed (rejected)`, { error: errorMsg, userId });
                failed.push({ name: serviceName, error: errorMsg });

                // Log error to session
                if (sessionId) {
                    try {
                        await LoggingHelper.addLogToSession(sessionId, {
                            functionName: serviceName,
                            logType: 'error',
                            status: 'failed',
                            message: `${serviceName} failed: ${errorMsg}`,
                            errorDetails: {
                                errorMessage: errorMsg,
                                stackTrace: result.reason?.stack,
                                phase: phaseName
                            },
                            contextData: { userId, region, country }
                        });
                    } catch (logError) {
                        logger.warn(`[${phaseName}] Failed to log error for ${serviceName}: ${logError.message}`);
                    }
                }
            }
        }

        return { successful, failed };
    }

    /**
     * Execute Phase 2: Batch 1 and 2
     * Runs first two batches of API calls (performance reports, PPC, inventory, reviews)
     * 
     * @param {string} userId - User ID
     * @param {string} Region - Region (NA, EU, FE)
     * @param {string} Country - Country code
     * @param {Object} phaseData - Data from previous phase
     * @returns {Object} Phase result
     */
    static async executeBatch1And2Phase(userId, Region, Country, phaseData = {}) {
        logger.info(`[Integration:Batch1And2Phase] Starting for user ${userId}, ${Country}-${Region}`);
        
        // Load existing session from previous phase (if available)
        const sessionId = phaseData.sessionId;
        if (sessionId) {
            try {
                await LoggingHelper.addLogToSession(sessionId, {
                    functionName: 'Integration.Batch1And2Phase',
                    logType: 'info',
                    status: 'started',
                    message: 'Integration Batch 1 & 2 Phase started',
                    contextData: { userId, region: Region, country: Country }
                });
            } catch (logError) {
                logger.warn(`[Integration:Batch1And2Phase] Failed to add log: ${logError.message}`);
            }
        }

        try {
            // Re-fetch tokens and config (resilient to worker restarts)
            const config = this.getConfiguration(Region, Country);
            if (!config.success) {
                return { success: false, error: config.error, statusCode: config.statusCode };
            }

            const { Base_URI, Marketplace_Id, regionConfig, marketplaceIds } = config;

            const sellerDataResult = await this.getSellerDataAndTokens(userId, Region, Country);
            if (!sellerDataResult.success) {
                return { success: false, error: sellerDataResult.error, statusCode: sellerDataResult.statusCode };
            }

            const { RefreshToken, AdsRefreshToken, ProfileId, sellerId } = sellerDataResult;

            const credentialsResult = await this.generateCredentials(regionConfig, null);
            if (!credentialsResult.success) {
                return { success: false, error: credentialsResult.error, statusCode: credentialsResult.statusCode };
            }

            const tokenResult = await this.generateTokens(userId, RefreshToken, AdsRefreshToken, null);
            if (!tokenResult.success) {
                return { success: false, error: tokenResult.error, statusCode: tokenResult.statusCode };
            }

            const { AccessToken, AdsAccessToken } = tokenResult;
            tokenManager.setTokens(userId, AccessToken, AdsAccessToken, RefreshToken, AdsRefreshToken);

            // Use asinArray from phaseData or re-fetch from DB
            const asinArray = phaseData.asinArray || [];
            const skuArray = phaseData.skuArray || [];

            const credentials = credentialsResult.credentials;
            const dataToSend = this.prepareDataToSend(
                Marketplace_Id, AccessToken, credentials, asinArray, Country, sellerId
            );

            const productData = { asinArray, skuArray };

            // Execute first batch
            logger.info("[Integration:Batch1And2Phase] First Batch Starts");
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
                        (AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken),
                    getPPCMetrics(AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken, null, null, true),
                    getPPCUnitsSold(AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken, null, null, true)
                );
                firstBatchServiceNames.push("PPC Spends by SKU", "Ads Keywords Performance", "PPC Spends Date Wise", "PPC Metrics", "PPC Units Sold");
            }

            const firstBatchResults = await Promise.allSettled(firstBatchPromises);
            
            // Process and log individual service results for first batch
            const firstBatchSummary = await this.processAndLogBatchResults(
                firstBatchResults,
                firstBatchServiceNames,
                sessionId,
                userId,
                Region,
                Country,
                'Integration:Batch1And2Phase:Batch1'
            );
            logger.info("[Integration:Batch1And2Phase] First Batch Ends", {
                successful: firstBatchSummary.successful.length,
                failed: firstBatchSummary.failed.length
            });

            // Execute second batch
            logger.info("[Integration:Batch1And2Phase] Second Batch Starts");
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
                        (AccessToken, marketplaceIds, userId, Base_URI, Country, Region),
                    tokenManager.wrapSpApiFunction(GET_LEDGER_SUMMARY_VIEW_DATA, userId, RefreshToken, AdsRefreshToken)
                        (AccessToken, marketplaceIds, userId, Base_URI, Country, Region),
                    tokenManager.wrapSpApiFunction(GET_LEDGER_DETAIL_VIEW_DATA, userId, RefreshToken, AdsRefreshToken)
                        (AccessToken, marketplaceIds, userId, Base_URI, Country, Region),
                    tokenManager.wrapSpApiFunction(GET_FBA_REIMBURSEMENTS_DATA, userId, RefreshToken, AdsRefreshToken)
                        (AccessToken, marketplaceIds, userId, Base_URI, Country, Region)
                );
                secondBatchServiceNames.push(
                    "Restock Inventory", "FBA Inventory Planning", "Stranded Inventory",
                    "Inbound Non-Compliance", "Ledger Summary", "Ledger Detail", "FBA Reimbursements"
                );
            }

            // Product reviews
            secondBatchPromises.push(
                addReviewDataTODatabase(Array.isArray(asinArray) ? asinArray : [], Country, userId, Region)
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
            
            // Process and log individual service results for second batch
            const secondBatchSummary = await this.processAndLogBatchResults(
                secondBatchResults,
                secondBatchServiceNames,
                sessionId,
                userId,
                Region,
                Country,
                'Integration:Batch1And2Phase:Batch2'
            );
            logger.info("[Integration:Batch1And2Phase] Second Batch Ends", {
                successful: secondBatchSummary.successful.length,
                failed: secondBatchSummary.failed.length
            });

            logger.info(`[Integration:Batch1And2Phase] Completed for user ${userId}`, {
                totalSuccessful: firstBatchSummary.successful.length + secondBatchSummary.successful.length,
                totalFailed: firstBatchSummary.failed.length + secondBatchSummary.failed.length
            });

            // Log phase success
            if (sessionId) {
                try {
                    await LoggingHelper.addLogToSession(sessionId, {
                        functionName: 'Integration.Batch1And2Phase',
                        logType: 'success',
                        status: 'completed',
                        message: 'Integration Batch 1 & 2 Phase completed successfully',
                        contextData: { userId, region: Region, country: Country }
                    });
                } catch (logError) {
                    logger.warn(`[Integration:Batch1And2Phase] Failed to add success log: ${logError.message}`);
                }
            }

            return {
                success: true,
                dataForNextPhase: {
                    ...phaseData
                }
            };

        } catch (error) {
            logger.error(`[Integration:Batch1And2Phase] Failed for user ${userId}:`, error);
            
            // Log phase failure
            if (sessionId) {
                try {
                    await LoggingHelper.addLogToSession(sessionId, {
                        functionName: 'Integration.Batch1And2Phase',
                        logType: 'error',
                        status: 'failed',
                        message: `Integration Batch 1 & 2 Phase failed: ${error.message}`,
                        contextData: { userId, region: Region, country: Country }
                    });
                } catch (logError) {
                    logger.warn(`[Integration:Batch1And2Phase] Failed to add error log: ${logError.message}`);
                }
            }
            
            return {
                success: false,
                error: error.message,
                statusCode: 500
            };
        }
    }

    /**
     * Execute Phase 3: Batch 3 and 4
     * Runs third and fourth batches (shipments, economics, keywords)
     * 
     * @param {string} userId - User ID
     * @param {string} Region - Region (NA, EU, FE)
     * @param {string} Country - Country code
     * @param {Object} phaseData - Data from previous phases
     * @returns {Object} Phase result
     */
    static async executeBatch3And4Phase(userId, Region, Country, phaseData = {}) {
        logger.info(`[Integration:Batch3And4Phase] Starting for user ${userId}, ${Country}-${Region}`);
        
        // Load existing session from previous phase (if available)
        const sessionId = phaseData.sessionId;
        if (sessionId) {
            try {
                await LoggingHelper.addLogToSession(sessionId, {
                    functionName: 'Integration.Batch3And4Phase',
                    logType: 'info',
                    status: 'started',
                    message: 'Integration Batch 3 & 4 Phase started',
                    contextData: { userId, region: Region, country: Country }
                });
            } catch (logError) {
                logger.warn(`[Integration:Batch3And4Phase] Failed to add log: ${logError.message}`);
            }
        }

        try {
            // Re-fetch tokens and config
            const config = this.getConfiguration(Region, Country);
            if (!config.success) {
                return { success: false, error: config.error, statusCode: config.statusCode };
            }

            const { Base_URI, Marketplace_Id, regionConfig, marketplaceIds } = config;

            const sellerDataResult = await this.getSellerDataAndTokens(userId, Region, Country);
            if (!sellerDataResult.success) {
                return { success: false, error: sellerDataResult.error, statusCode: sellerDataResult.statusCode };
            }

            const { RefreshToken, AdsRefreshToken, ProfileId, sellerId } = sellerDataResult;

            const credentialsResult = await this.generateCredentials(regionConfig, null);
            if (!credentialsResult.success) {
                return { success: false, error: credentialsResult.error, statusCode: credentialsResult.statusCode };
            }

            const tokenResult = await this.generateTokens(userId, RefreshToken, AdsRefreshToken, null);
            if (!tokenResult.success) {
                return { success: false, error: tokenResult.error, statusCode: tokenResult.statusCode };
            }

            const { AccessToken, AdsAccessToken } = tokenResult;
            tokenManager.setTokens(userId, AccessToken, AdsAccessToken, RefreshToken, AdsRefreshToken);

            const asinArray = phaseData.asinArray || [];
            const credentials = credentialsResult.credentials;
            const dataToSend = this.prepareDataToSend(
                Marketplace_Id, AccessToken, credentials, asinArray, Country, sellerId
            );

            // Get campaign and ad group IDs from stored data
            const { campaignIdArray, adGroupIdArray } = await this.getCampaignAndAdGroupIds(
                { success: false }, userId, Region, Country
            );

            // Third batch
            logger.info("[Integration:Batch3And4Phase] Third Batch Starts");
            const thirdBatchPromises = [];
            const thirdBatchServiceNames = [];

            if (AccessToken) {
                thirdBatchPromises.push(
                    tokenManager.wrapDataToSendFunction(getshipment, userId, RefreshToken, AdsRefreshToken)
                        (dataToSend, userId, Base_URI, Country, Region),
                    tokenManager.wrapDataToSendFunction(getBrand, userId, RefreshToken, AdsRefreshToken)
                        (dataToSend, userId, Base_URI)
                );
                thirdBatchServiceNames.push("Shipment Data", "Brand Data");
            }

            if (AdsAccessToken) {
                thirdBatchPromises.push(
                    tokenManager.wrapAdsFunction(getAdGroups, userId, RefreshToken, AdsRefreshToken)
                        (AdsAccessToken, ProfileId, Region, userId, Country, [])
                );
                thirdBatchServiceNames.push("Ad Groups");
            }

            // MCP Economics
            if (RefreshToken) {
                thirdBatchPromises.push(
                    fetchAndStoreEconomicsData(userId, RefreshToken, Region, Country)
                );
                thirdBatchServiceNames.push("MCP Economics Data");
            }

            const thirdBatchResults = await Promise.allSettled(thirdBatchPromises);
            
            // Process and log individual service results for third batch
            const thirdBatchSummary = await this.processAndLogBatchResults(
                thirdBatchResults,
                thirdBatchServiceNames,
                sessionId,
                userId,
                Region,
                Country,
                'Integration:Batch3And4Phase:Batch3'
            );

            // MCP BuyBox (after Economics) - handled separately as it depends on Economics
            if (RefreshToken) {
                try {
                    await fetchAndStoreBuyBoxData(userId, RefreshToken, Region, Country);
                    // Log BuyBox success
                    if (sessionId) {
                        try {
                            await LoggingHelper.addLogToSession(sessionId, {
                                functionName: 'MCP BuyBox Data',
                                logType: 'success',
                                status: 'completed',
                                message: 'MCP BuyBox Data completed successfully',
                                contextData: { userId, region: Region, country: Country }
                            });
                        } catch (logError) {
                            logger.warn(`[Integration:Batch3And4Phase] Failed to log BuyBox success: ${logError.message}`);
                        }
                    }
                } catch (buyBoxError) {
                    logger.warn("[Integration:Batch3And4Phase] BuyBox fetch failed:", buyBoxError.message);
                    // Log BuyBox error
                    if (sessionId) {
                        try {
                            await LoggingHelper.addLogToSession(sessionId, {
                                functionName: 'MCP BuyBox Data',
                                logType: 'error',
                                status: 'failed',
                                message: `MCP BuyBox Data failed: ${buyBoxError.message}`,
                                errorDetails: {
                                    errorMessage: buyBoxError.message,
                                    stackTrace: buyBoxError.stack,
                                    phase: 'Integration:Batch3And4Phase:Batch3'
                                },
                                contextData: { userId, region: Region, country: Country }
                            });
                        } catch (logError) {
                            logger.warn(`[Integration:Batch3And4Phase] Failed to log BuyBox error: ${logError.message}`);
                        }
                    }
                }
            }

            logger.info("[Integration:Batch3And4Phase] Third Batch Ends", {
                successful: thirdBatchSummary.successful.length,
                failed: thirdBatchSummary.failed.length
            });

            // Fourth batch - Keywords
            logger.info("[Integration:Batch3And4Phase] Fourth Batch Starts");
            let fourthBatchSummary = { successful: [], failed: [] };
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
                const fourthBatchServiceNames = ["Negative Keywords", "Search Keywords"];

                if (asinArray.length > 0) {
                    fourthBatchPromises.push(
                        tokenManager.wrapAdsFunction(getKeywordRecommendations, userId, RefreshToken, AdsRefreshToken)
                            (AdsAccessToken, ProfileId, userId, Country, Region, asinArray)
                    );
                    fourthBatchServiceNames.push("Keyword Recommendations");
                }

                const fourthBatchResults = await Promise.allSettled(fourthBatchPromises);
                
                // Process and log individual service results for fourth batch
                fourthBatchSummary = await this.processAndLogBatchResults(
                    fourthBatchResults,
                    fourthBatchServiceNames,
                    sessionId,
                    userId,
                    Region,
                    Country,
                    'Integration:Batch3And4Phase:Batch4'
                );
            }
            logger.info("[Integration:Batch3And4Phase] Fourth Batch Ends", {
                successful: fourthBatchSummary.successful.length,
                failed: fourthBatchSummary.failed.length
            });

            logger.info(`[Integration:Batch3And4Phase] Completed for user ${userId}`, {
                totalSuccessful: thirdBatchSummary.successful.length + fourthBatchSummary.successful.length,
                totalFailed: thirdBatchSummary.failed.length + fourthBatchSummary.failed.length
            });

            // Log phase success
            if (sessionId) {
                try {
                    await LoggingHelper.addLogToSession(sessionId, {
                        functionName: 'Integration.Batch3And4Phase',
                        logType: 'success',
                        status: 'completed',
                        message: 'Integration Batch 3 & 4 Phase completed successfully',
                        contextData: { userId, region: Region, country: Country }
                    });
                } catch (logError) {
                    logger.warn(`[Integration:Batch3And4Phase] Failed to add success log: ${logError.message}`);
                }
            }

            return {
                success: true,
                dataForNextPhase: {
                    ...phaseData
                }
            };

        } catch (error) {
            logger.error(`[Integration:Batch3And4Phase] Failed for user ${userId}:`, error);
            
            // Log phase failure
            if (sessionId) {
                try {
                    await LoggingHelper.addLogToSession(sessionId, {
                        functionName: 'Integration.Batch3And4Phase',
                        logType: 'error',
                        status: 'failed',
                        message: `Integration Batch 3 & 4 Phase failed: ${error.message}`,
                        contextData: { userId, region: Region, country: Country }
                    });
                } catch (logError) {
                    logger.warn(`[Integration:Batch3And4Phase] Failed to add error log: ${logError.message}`);
                }
            }
            
            return {
                success: false,
                error: error.message,
                statusCode: 500
            };
        }
    }

    /**
     * Execute Phase 4: Listing Items
     * Processes individual listing items (most time-consuming part)
     * 
     * @param {string} userId - User ID
     * @param {string} Region - Region (NA, EU, FE)
     * @param {string} Country - Country code
     * @param {Object} phaseData - Data from previous phases
     * @returns {Object} Phase result
     */
    static async executeListingItemsPhase(userId, Region, Country, phaseData = {}) {
        logger.info(`[Integration:ListingItemsPhase] Starting for user ${userId}, ${Country}-${Region}`);
        
        // Load existing session from previous phase (if available)
        const sessionId = phaseData.sessionId;
        if (sessionId) {
            try {
                await LoggingHelper.addLogToSession(sessionId, {
                    functionName: 'Integration.ListingItemsPhase',
                    logType: 'info',
                    status: 'started',
                    message: 'Integration Listing Items Phase started',
                    contextData: { userId, region: Region, country: Country }
                });
            } catch (logError) {
                logger.warn(`[Integration:ListingItemsPhase] Failed to add log: ${logError.message}`);
            }
        }

        try {
            // Re-fetch tokens and config
            const config = this.getConfiguration(Region, Country);
            if (!config.success) {
                return { success: false, error: config.error, statusCode: config.statusCode };
            }

            const { Base_URI, Marketplace_Id, regionConfig, marketplaceIds } = config;

            const sellerDataResult = await this.getSellerDataAndTokens(userId, Region, Country);
            if (!sellerDataResult.success) {
                return { success: false, error: sellerDataResult.error, statusCode: sellerDataResult.statusCode };
            }

            const { RefreshToken, AdsRefreshToken, ProfileId, sellerId } = sellerDataResult;

            const credentialsResult = await this.generateCredentials(regionConfig, null);
            if (!credentialsResult.success) {
                return { success: false, error: credentialsResult.error, statusCode: credentialsResult.statusCode };
            }

            const tokenResult = await this.generateTokens(userId, RefreshToken, AdsRefreshToken, null);
            if (!tokenResult.success) {
                return { success: false, error: tokenResult.error, statusCode: tokenResult.statusCode };
            }

            const { AccessToken, AdsAccessToken } = tokenResult;
            tokenManager.setTokens(userId, AccessToken, AdsAccessToken, RefreshToken, AdsRefreshToken);

            const asinArray = phaseData.asinArray || [];
            const skuArray = phaseData.skuArray || [];
            const inactiveSkuArray = phaseData.inactiveSkuArray || [];
            const inactiveAsinArray = phaseData.inactiveAsinArray || [];

            const credentials = credentialsResult.credentials;
            const dataToSend = this.prepareDataToSend(
                Marketplace_Id, AccessToken, credentials, asinArray, Country, sellerId
            );

            // Process active listing items
            logger.info("[Integration:ListingItemsPhase] Processing active listing items");
            let genericKeyWordArray = [];
            try {
                genericKeyWordArray = await this.processListingItems(
                    AccessToken, skuArray, asinArray, dataToSend,
                    userId, Base_URI, Country, Region, RefreshToken, AdsRefreshToken, null
                );
                // Log success for listing items processing
                if (sessionId) {
                    try {
                        await LoggingHelper.addLogToSession(sessionId, {
                            functionName: 'Listing Items Processing',
                            logType: 'success',
                            status: 'completed',
                            message: 'Listing Items Processing completed successfully',
                            dataMetrics: {
                                recordsProcessed: genericKeyWordArray?.length || 0,
                                recordsSuccessful: genericKeyWordArray?.length || 0
                            },
                            contextData: { userId, region: Region, country: Country }
                        });
                    } catch (logError) {
                        logger.warn(`[Integration:ListingItemsPhase] Failed to log listing items success: ${logError.message}`);
                    }
                }
            } catch (listingError) {
                logger.error("[Integration:ListingItemsPhase] Failed to process listing items:", listingError.message);
                // Log error for listing items processing
                if (sessionId) {
                    try {
                        await LoggingHelper.addLogToSession(sessionId, {
                            functionName: 'Listing Items Processing',
                            logType: 'error',
                            status: 'failed',
                            message: `Listing Items Processing failed: ${listingError.message}`,
                            errorDetails: {
                                errorMessage: listingError.message,
                                stackTrace: listingError.stack,
                                phase: 'Integration:ListingItemsPhase'
                            },
                            contextData: { userId, region: Region, country: Country }
                        });
                    } catch (logError) {
                        logger.warn(`[Integration:ListingItemsPhase] Failed to log listing items error: ${logError.message}`);
                    }
                }
            }

            // Save listing items data
            if (Array.isArray(genericKeyWordArray) && genericKeyWordArray.length > 0) {
                try {
                    await saveListingItemsData(userId, Country, Region, genericKeyWordArray);
                    // Log success for saving listing items data
                    if (sessionId) {
                        try {
                            await LoggingHelper.addLogToSession(sessionId, {
                                functionName: 'Save Listing Items Data',
                                logType: 'success',
                                status: 'completed',
                                message: 'Save Listing Items Data completed successfully',
                                dataMetrics: {
                                    recordsProcessed: genericKeyWordArray.length,
                                    recordsSuccessful: genericKeyWordArray.length
                                },
                                contextData: { userId, region: Region, country: Country }
                            });
                        } catch (logError) {
                            logger.warn(`[Integration:ListingItemsPhase] Failed to log save listing items success: ${logError.message}`);
                        }
                    }
                } catch (dbError) {
                    logger.error("[Integration:ListingItemsPhase] Failed to save listing items:", dbError.message);
                    // Log error for saving listing items data
                    if (sessionId) {
                        try {
                            await LoggingHelper.addLogToSession(sessionId, {
                                functionName: 'Save Listing Items Data',
                                logType: 'error',
                                status: 'failed',
                                message: `Save Listing Items Data failed: ${dbError.message}`,
                                errorDetails: {
                                    errorMessage: dbError.message,
                                    stackTrace: dbError.stack,
                                    phase: 'Integration:ListingItemsPhase'
                                },
                                contextData: { userId, region: Region, country: Country }
                            });
                        } catch (logError) {
                            logger.warn(`[Integration:ListingItemsPhase] Failed to log save listing items error: ${logError.message}`);
                        }
                    }
                }
            }

            // Process inactive SKUs
            if (inactiveSkuArray.length > 0) {
                logger.info("[Integration:ListingItemsPhase] Processing inactive SKUs", {
                    count: inactiveSkuArray.length
                });
                try {
                    await this.processInactiveListingItems(
                        AccessToken, inactiveSkuArray, inactiveAsinArray, dataToSend,
                        userId, Base_URI, Country, Region, RefreshToken, AdsRefreshToken, null
                    );
                    // Log success for inactive listing items processing
                    if (sessionId) {
                        try {
                            await LoggingHelper.addLogToSession(sessionId, {
                                functionName: 'Inactive Listing Items Processing',
                                logType: 'success',
                                status: 'completed',
                                message: 'Inactive Listing Items Processing completed successfully',
                                dataMetrics: {
                                    recordsProcessed: inactiveSkuArray.length,
                                    recordsSuccessful: inactiveSkuArray.length
                                },
                                contextData: { userId, region: Region, country: Country }
                            });
                        } catch (logError) {
                            logger.warn(`[Integration:ListingItemsPhase] Failed to log inactive listing items success: ${logError.message}`);
                        }
                    }
                } catch (inactiveError) {
                    logger.error("[Integration:ListingItemsPhase] Failed to process inactive listing items:", inactiveError.message);
                    // Log error for inactive listing items processing
                    if (sessionId) {
                        try {
                            await LoggingHelper.addLogToSession(sessionId, {
                                functionName: 'Inactive Listing Items Processing',
                                logType: 'error',
                                status: 'failed',
                                message: `Inactive Listing Items Processing failed: ${inactiveError.message}`,
                                errorDetails: {
                                    errorMessage: inactiveError.message,
                                    stackTrace: inactiveError.stack,
                                    phase: 'Integration:ListingItemsPhase'
                                },
                                contextData: { userId, region: Region, country: Country }
                            });
                        } catch (logError) {
                            logger.warn(`[Integration:ListingItemsPhase] Failed to log inactive listing items error: ${logError.message}`);
                        }
                    }
                }
            }

            logger.info(`[Integration:ListingItemsPhase] Completed for user ${userId}`, {
                processedCount: genericKeyWordArray?.length || 0,
                inactiveCount: inactiveSkuArray.length
            });

            // Log phase success
            if (sessionId) {
                try {
                    await LoggingHelper.addLogToSession(sessionId, {
                        functionName: 'Integration.ListingItemsPhase',
                        logType: 'success',
                        status: 'completed',
                        message: 'Integration Listing Items Phase completed successfully',
                        dataMetrics: {
                            recordsProcessed: genericKeyWordArray?.length || 0,
                            recordsSuccessful: genericKeyWordArray?.length || 0
                        },
                        contextData: { userId, region: Region, country: Country }
                    });
                } catch (logError) {
                    logger.warn(`[Integration:ListingItemsPhase] Failed to add success log: ${logError.message}`);
                }
            }

            return {
                success: true,
                dataForNextPhase: {
                    ...phaseData,
                    listingItemsProcessed: genericKeyWordArray?.length || 0
                }
            };

        } catch (error) {
            logger.error(`[Integration:ListingItemsPhase] Failed for user ${userId}:`, error);
            
            // Log phase failure
            if (sessionId) {
                try {
                    await LoggingHelper.addLogToSession(sessionId, {
                        functionName: 'Integration.ListingItemsPhase',
                        logType: 'error',
                        status: 'failed',
                        message: `Integration Listing Items Phase failed: ${error.message}`,
                        contextData: { userId, region: Region, country: Country }
                    });
                } catch (logError) {
                    logger.warn(`[Integration:ListingItemsPhase] Failed to add error log: ${logError.message}`);
                }
            }
            
            return {
                success: false,
                error: error.message,
                statusCode: 500
            };
        }
    }

    /**
     * Execute Phase 5: Finalize
     * Clears cache, sends notifications, updates history
     * 
     * @param {string} userId - User ID
     * @param {string} Region - Region (NA, EU, FE)
     * @param {string} Country - Country code
     * @param {Object} phaseData - Data from previous phases
     * @returns {Object} Phase result with summary
     */
    static async executeFinalizePhase(userId, Region, Country, phaseData = {}) {
        logger.info(`[Integration:FinalizePhase] Starting for user ${userId}, ${Country}-${Region}`);
        
        // Load existing session from previous phase (if available)
        const sessionId = phaseData.sessionId;
        if (sessionId) {
            try {
                await LoggingHelper.addLogToSession(sessionId, {
                    functionName: 'Integration.FinalizePhase',
                    logType: 'info',
                    status: 'started',
                    message: 'Integration Finalize Phase started',
                    contextData: { userId, region: Region, country: Country }
                });
            } catch (logError) {
                logger.warn(`[Integration:FinalizePhase] Failed to add log: ${logError.message}`);
            }
        }

        try {
            // Clear Redis cache
            try {
                await clearAnalyseCache(userId, Country, Region, null);
                logger.info('[Integration:FinalizePhase] Redis cache cleared', { userId, Country, Region });
                // Log success for cache clearing
                if (sessionId) {
                    try {
                        await LoggingHelper.addLogToSession(sessionId, {
                            functionName: 'Clear Redis Cache',
                            logType: 'success',
                            status: 'completed',
                            message: 'Clear Redis Cache completed successfully',
                            contextData: { userId, region: Region, country: Country }
                        });
                    } catch (logError) {
                        logger.warn(`[Integration:FinalizePhase] Failed to log cache clear success: ${logError.message}`);
                    }
                }
            } catch (cacheError) {
                logger.warn('[Integration:FinalizePhase] Failed to clear Redis cache:', cacheError.message);
                // Log error for cache clearing
                if (sessionId) {
                    try {
                        await LoggingHelper.addLogToSession(sessionId, {
                            functionName: 'Clear Redis Cache',
                            logType: 'error',
                            status: 'failed',
                            message: `Clear Redis Cache failed: ${cacheError.message}`,
                            errorDetails: {
                                errorMessage: cacheError.message,
                                stackTrace: cacheError.stack,
                                phase: 'Integration:FinalizePhase'
                            },
                            contextData: { userId, region: Region, country: Country }
                        });
                    } catch (logError) {
                        logger.warn(`[Integration:FinalizePhase] Failed to log cache clear error: ${logError.message}`);
                    }
                }
            }

            // Handle success (send email, mark first analysis done)
            try {
                await this.handleSuccess(userId, Country, Region);
                // Log success for handle success
                if (sessionId) {
                    try {
                        await LoggingHelper.addLogToSession(sessionId, {
                            functionName: 'Handle Success (Email/Mark Done)',
                            logType: 'success',
                            status: 'completed',
                            message: 'Handle Success (Email/Mark Done) completed successfully',
                            contextData: { userId, region: Region, country: Country }
                        });
                    } catch (logError) {
                        logger.warn(`[Integration:FinalizePhase] Failed to log handle success: ${logError.message}`);
                    }
                }
            } catch (handleSuccessError) {
                logger.error("[Integration:FinalizePhase] Error in handleSuccess:", handleSuccessError.message);
                // Log error for handle success
                if (sessionId) {
                    try {
                        await LoggingHelper.addLogToSession(sessionId, {
                            functionName: 'Handle Success (Email/Mark Done)',
                            logType: 'error',
                            status: 'failed',
                            message: `Handle Success (Email/Mark Done) failed: ${handleSuccessError.message}`,
                            errorDetails: {
                                errorMessage: handleSuccessError.message,
                                stackTrace: handleSuccessError.stack,
                                phase: 'Integration:FinalizePhase'
                            },
                            contextData: { userId, region: Region, country: Country }
                        });
                    } catch (logError) {
                        logger.warn(`[Integration:FinalizePhase] Failed to log handle success error: ${logError.message}`);
                    }
                }
            }

            // Add account history
            try {
                await this.addNewAccountHistory(userId, Country, Region);
                // Log success for add account history
                if (sessionId) {
                    try {
                        await LoggingHelper.addLogToSession(sessionId, {
                            functionName: 'Add Account History',
                            logType: 'success',
                            status: 'completed',
                            message: 'Add Account History completed successfully',
                            contextData: { userId, region: Region, country: Country }
                        });
                    } catch (logError) {
                        logger.warn(`[Integration:FinalizePhase] Failed to log add account history success: ${logError.message}`);
                    }
                }
            } catch (historyError) {
                logger.error("[Integration:FinalizePhase] Error adding account history:", historyError.message);
                // Log error for add account history
                if (sessionId) {
                    try {
                        await LoggingHelper.addLogToSession(sessionId, {
                            functionName: 'Add Account History',
                            logType: 'error',
                            status: 'failed',
                            message: `Add Account History failed: ${historyError.message}`,
                            errorDetails: {
                                errorMessage: historyError.message,
                                stackTrace: historyError.stack,
                                phase: 'Integration:FinalizePhase'
                            },
                            contextData: { userId, region: Region, country: Country }
                        });
                    } catch (logError) {
                        logger.warn(`[Integration:FinalizePhase] Failed to log add account history error: ${logError.message}`);
                    }
                }
            }

            logger.info(`[Integration:FinalizePhase] Completed for user ${userId}`);

            // Log phase success and END the session with 'completed' status
            if (sessionId) {
                try {
                    await LoggingHelper.addLogToSession(sessionId, {
                        functionName: 'Integration.FinalizePhase',
                        logType: 'success',
                        status: 'completed',
                        message: 'Integration Finalize Phase completed successfully',
                        contextData: { userId, region: Region, country: Country }
                    });
                    // End the session as completed
                    await LoggingHelper.endSessionById(sessionId, 'completed');
                    logger.info(`[Integration:FinalizePhase] Session ended as completed: ${sessionId}`);
                } catch (logError) {
                    logger.warn(`[Integration:FinalizePhase] Failed to end session: ${logError.message}`);
                }
            }

            return {
                success: true,
                summary: {
                    userId,
                    country: Country,
                    region: Region,
                    listingItemsProcessed: phaseData.listingItemsProcessed || 0,
                    completedAt: new Date().toISOString()
                }
            };

        } catch (error) {
            logger.error(`[Integration:FinalizePhase] Failed for user ${userId}:`, error);
            
            // Log phase failure (don't end session here - worker will handle it)
            if (sessionId) {
                try {
                    await LoggingHelper.addLogToSession(sessionId, {
                        functionName: 'Integration.FinalizePhase',
                        logType: 'error',
                        status: 'failed',
                        message: `Integration Finalize Phase failed: ${error.message}`,
                        contextData: { userId, region: Region, country: Country }
                    });
                } catch (logError) {
                    logger.warn(`[Integration:FinalizePhase] Failed to add error log: ${logError.message}`);
                }
            }
            
            return {
                success: false,
                error: error.message,
                statusCode: 500
            };
        }
    }
}

module.exports = { Integration };

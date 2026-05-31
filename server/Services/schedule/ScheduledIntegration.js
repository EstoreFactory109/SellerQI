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
// Use service layers for models that can hit 16MB limit
const { saveListingItemsData } = require('../products/ListingItemsService.js');
const { getProductWiseSponsoredAdsData } = require('../amazon-ads/ProductWiseSponsoredAdsService.js');
const { GetListingItemIssuesForInactive } = require('../Sp_API/GetListingItemsIssues.js');
const limit = require('promise-limit')(3); // Limit to 3 concurrent promises
const DataFetchTrackingService = require('../system/DataFetchTrackingService.js');
const { runFbaInventorySyncForMarketplace } = require('../Sp_API/FbaInventoryStorageService.js');
// Incremental dashboard slice writes — additive, non-fatal (see DashboardSliceService).
const dashboardSliceService = require('../dashboard/DashboardSliceService.js');
const { SLICE_KEYS } = dashboardSliceService;

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

        // Track data fetch for calendar-affecting services (defined outside try for catch access)
        let trackingEntry = null;

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

            // Start tracking ONLY on Mon/Wed/Fri when calendar-affecting services run
            // Calendar-affecting services: mcpEconomicsData, ppcMetricsAggregated, ppcSpendsDateWise,
            // adsKeywordsPerformanceData, searchKeywords, ppcSpendsBySKU, campaignData
            // These are the only services whose data can be filtered by calendar date range
            const isCalendarAffectingDay = dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5; // Mon/Wed/Fri
            
            if (isCalendarAffectingDay) {
                // Use Pacific-time "yesterday" to match FinanceService's date logic
                const { getDefaultReportDateRange } = require('../../utils/reportDateRange.js');
                const trackingRange = getDefaultReportDateRange(30);
                
                try {
                    trackingEntry = await DataFetchTrackingService.startTracking(
                        userId,
                        Country,
                        Region,
                        { startDate: trackingRange.startDate, endDate: trackingRange.endDate },
                        loggingHelper?.sessionId || null
                    );
                    logger.info('[ScheduledIntegration] Calendar tracking started (Mon/Wed/Fri)', {
                        trackingId: trackingEntry._id,
                        dayName: trackingEntry.dayName,
                        dayOfWeek: dayOfWeek,
                        dataRange: trackingRange
                    });
                } catch (trackingError) {
                    logger.warn('[ScheduledIntegration] Failed to start calendar tracking (non-critical)', {
                        error: trackingError.message,
                        userId,
                        Country,
                        Region
                    });
                }
            } else {
                logger.info('[ScheduledIntegration] Skipping calendar tracking (not Mon/Wed/Fri)', {
                    dayOfWeek: dayOfWeek,
                    dayName: dayNames[dayOfWeek]
                });
            }

            // Fetch merchant listings data (needed for product data)
            const merchantListingsData = await this.fetchMerchantListings(
                AccessToken, marketplaceIds, userId, Country, Region, Base_URI,
                RefreshToken, AdsRefreshToken, loggingHelper
            );

            await runFbaInventorySyncForMarketplace({
                userId,
                country: Country,
                region: Region,
                accessToken: AccessToken,
                loggingHelper,
            });

            // Extract product data (active products)
            const productData = this.extractProductData(merchantListingsData, Country, Region);

            // Extract inactive product data for issues fetching
            const inactiveProductData = this.extractInactiveProductData(merchantListingsData, Country, Region);

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

            // Process inactive SKUs to fetch and store their issues
            if (inactiveProductData.inactiveSkuArray.length > 0) {
                logger.info("Processing inactive SKUs for issues (scheduled)", { 
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
                    loggingHelper.logFunctionWarning('ScheduledIntegration.getScheduledApiData', 'All services failed', {
                        failedServices: serviceSummary.failed,
                        successRate: serviceSummary.successPercentage
                    });
                    await loggingHelper.endSession('failed');
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

            // Build error message if there are any failures (partial or complete)
            let errorMessage = null;
            if (serviceSummary.failed.length > 0) {
                const failedServices = serviceSummary.failed.map(f => `${f.service}: ${f.error}`).join('; ');
                if (!serviceSummary.overallSuccess) {
                    // All services failed
                    errorMessage = `All services failed: ${failedServices}`;
                } else {
                    // Partial failure - some succeeded, some failed
                    errorMessage = `Partial failure (${serviceSummary.failed.length}/${serviceSummary.totalServices} failed): ${failedServices}`;
                }
            }

            // Complete calendar tracking (Mon/Wed/Fri only - trackingEntry only exists on those days)
            if (trackingEntry) {
                try {
                    if (serviceSummary.failed.length === 0 && serviceSummary.successful.length > 0) {
                        // All calendar services succeeded - mark as completed
                        await DataFetchTrackingService.completeTracking(trackingEntry._id);
                        logger.info('[ScheduledIntegration] Calendar tracking completed successfully', {
                            trackingId: trackingEntry._id,
                            dayName: trackingEntry.dayName,
                            dataRange: trackingEntry.dataRange,
                            successfulServices: serviceSummary.successful.length
                        });
                    } else if (serviceSummary.failed.length > 0 && serviceSummary.successful.length > 0) {
                        // Partial success - some calendar services failed, some succeeded
                        // Mark as partial so calendar still has valid data from successful services
                        trackingEntry.status = 'partial';
                        trackingEntry.errorMessage = errorMessage;
                        await trackingEntry.save();
                        logger.info('[ScheduledIntegration] Calendar tracking completed with partial success', {
                            trackingId: trackingEntry._id,
                            successfulServices: serviceSummary.successful.length,
                            failedServices: serviceSummary.failed.length,
                            failedServiceNames: serviceSummary.failed.map(f => f.service)
                        });
                    } else {
                        // All calendar services failed - mark as failed
                        await DataFetchTrackingService.failTracking(trackingEntry._id, errorMessage || 'All services failed');
                        logger.info('[ScheduledIntegration] Calendar tracking marked as failed', {
                            trackingId: trackingEntry._id,
                            failedServices: serviceSummary.failed.length
                        });
                    }
                } catch (trackingError) {
                    logger.warn('[ScheduledIntegration] Failed to complete calendar tracking', {
                        error: trackingError.message,
                        trackingId: trackingEntry._id
                    });
                }
            }

            return {
                success: serviceSummary.overallSuccess,
                statusCode: serviceSummary.overallSuccess ? 200 : 207,
                data: result,
                error: errorMessage, // Always include error property, even if null
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
            // Ensure we have a proper error message
            const errorMessage = unexpectedError?.message || 
                                (typeof unexpectedError === 'string' ? unexpectedError : 
                                (unexpectedError?.error || 'Unknown error occurred'));
            
            logger.error("Unexpected error in ScheduledIntegration.getScheduledApiData", {
                error: errorMessage,
                stack: unexpectedError?.stack,
                userId,
                errorType: typeof unexpectedError,
                errorString: String(unexpectedError)
            });

            // Create a proper Error object if it's not already one
            const errorToLog = unexpectedError instanceof Error 
                ? unexpectedError 
                : new Error(errorMessage);

            if (loggingHelper) {
                loggingHelper.logFunctionError('ScheduledIntegration.getScheduledApiData', errorToLog);
                await loggingHelper.endSession('failed');
            }

            // Mark calendar tracking as failed if it was started (only exists on Mon/Wed/Fri)
            if (trackingEntry) {
                try {
                    await DataFetchTrackingService.failTracking(trackingEntry._id, `Fatal error: ${errorMessage}`);
                    logger.info('[ScheduledIntegration] Calendar tracking marked as failed due to unexpected error', {
                        trackingId: trackingEntry._id,
                        error: errorMessage
                    });
                } catch (trackingError) {
                    logger.warn('[ScheduledIntegration] Failed to mark calendar tracking as failed', {
                        error: trackingError.message,
                        trackingId: trackingEntry._id
                    });
                }
            }

            return {
                success: false,
                statusCode: 500,
                error: `Unexpected error: ${errorMessage}`
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
     * Extract inactive product data from merchant listings (same as Integration)
     * Returns arrays of ASINs and SKUs for inactive products only
     */
    static extractInactiveProductData(merchantListingsData, Country, Region) {
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

        inactiveProducts.forEach(product => {
            inactiveAsinArray.push(product.asin.trim());
            inactiveSkuArray.push(product.sku.trim());
        });

        logger.info("extractInactiveProductData ended", { 
            inactiveCount: inactiveAsinArray.length 
        });
        return { inactiveAsinArray, inactiveSkuArray };
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
            productData, dataToSend, loggingHelper, dayOfWeek,
            _batchFilter
        } = params;
        const runBatch = (n) => !_batchFilter || _batchFilter.includes(n);

        const apiData = {};

        // Daily schedules fetch only yesterday's data (Pacific time, consistent with reportDateRange.js).
        const PACIFIC_OFFSET_MS = 7 * 60 * 60 * 1000;
        const _nowPacific = new Date(Date.now() - PACIFIC_OFFSET_MS);
        const _yesterdayPacific = new Date(Date.UTC(
            _nowPacific.getUTCFullYear(), _nowPacific.getUTCMonth(), _nowPacific.getUTCDate() - 1
        ));
        const scheduleYesterday = _yesterdayPacific.toISOString().split('T')[0];
        logger.info(`ScheduledIntegration: Daily date window = ${scheduleYesterday} (yesterday Pacific)`);
        
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
        // First batch: V2/V1 Seller Performance
        logger.info("First Batch Starts");
        const firstBatchPromises = [];
        const firstBatchServiceNames = [];

        // Second batch: Restock Inventory, FBA Inventory Planning, Stranded Inventory, Inbound Non-Compliance, Product Reviews, Ads Keywords, Campaign Data
        logger.info("Second Batch Starts");
        const secondBatchPromises = [];
        const secondBatchServiceNames = [];

        // Ads batch: PPC async report services (isolated into sched_ads phase).
        // PPCMetrics, PPCProductWise, PPCUnitsSold, DateWiseSpend, WastedSpend.
        const adsBatchPromises = [];
        const adsBatchServiceNames = [];

        // Third batch: Shipment, Brand, Ad Groups, MCP SalesOnly, BuyBox
        logger.info("Third Batch Starts");
        const thirdBatchPromises = [];
        const thirdBatchServiceNames = [];

        // Finance batch: Isolated Finance Sync (runs between Third and Fourth)
        const financeBatchPromises = [];
        const financeBatchServiceNames = [];

        // Fourth batch: Negative Keywords, Search Keywords, Keyword Recommendations
        logger.info("Fourth Batch Starts");
        const fourthBatchPromises = [];
        const fourthBatchServiceNames = [];

        // Fifth batch: Calculation services (run after all API fetches complete)
        const fifthBatchPromises = [];
        const fifthBatchServiceNames = [];

        // Sixth batch: Review order ingestion (fetches orders + items into DB)
        const sixthBatchPromises = [];
        const sixthBatchServiceNames = [];

        // Seventh batch: Review request sender (must run AFTER ingestion completes)
        const seventhBatchPromises = [];
        const seventhBatchServiceNames = [];

        // Helper function to determine batch number for a function key
        const getBatchNumber = (functionKey) => {
            // Ads batch: PPC async report services (isolated into sched_ads phase, 40-50 min)
            if (['ppcSpendsBySKU', 'adsKeywordsPerformanceData', 'ppcSpendsDateWise', 'ppcMetricsAggregated'].includes(functionKey)) {
                return 'ads';
            }
            // Batch 1: V2/V1 Seller Performance
            if (['v2data', 'v1data'].includes(functionKey)) {
                return 1;
            }
            // Batch 2: Restock Inventory, FBA Inventory Planning, Stranded Inventory, Inbound Non-Compliance, Product Reviews, Ads Keywords, Campaign Data, Reimbursement Data & Calculations
            if (['RestockinventoryData', 'fbaInventoryPlanningData', 'strandedInventoryData', 'inboundNonComplianceData', 'productReview', 'adsKeywords', 'campaignData',
                 'ledgerSummaryViewData', 'ledgerDetailViewData', 'fbaReimbursementsData',
                 'calculateShipmentDiscrepancy', 'calculateLostInventoryReimbursement', 'calculateDamagedInventoryReimbursement', 
                 'calculateDisposedInventoryReimbursement'].includes(functionKey)) {
                return 2;
            }
            // Batch 3: Shipment Data, Brand Data, Ad Groups Data, MCP SalesOnly, MCP BuyBox
            if (['shipment', 'brandData', 'adGroupsData', 'mcpEconomicsData', 'mcpBuyBoxData'].includes(functionKey)) {
                return 3;
            }
            // Finance: ISOLATED from batch 3 because syncFinanceData polls Amazon for 10-25 min
            // and was previously pinning a worker slot inside the old batch_3_4 phase.
            // Uses a string identifier so `runBatch('finance')` only fires from the dedicated
            // `sched_finance` phase (and from the legacy `executeScheduledBatch3And4Phase` which
            // passes `[3, 'finance', 4]` for in-flight job drain).
            if (functionKey === 'financeSync') {
                return 'finance';
            }
            // Batch 4: Negative Keywords, Search Keywords, Keyword Recommendations
            if (['negativeKeywords', 'searchKeywords', 'keywordRecommendations'].includes(functionKey)) {
                return 4;
            }
            // Batch 5: Calculation services (run after all API fetches complete)
            // These are marked with isCalculationService: true in ScheduleConfig
            if (['issueSummary', 'productIssues', 'issuesData'].includes(functionKey)) {
                return 5;
            }
            // Batch 6: Review order ingestion (must complete before sender)
            if (functionKey === 'reviewOrderIngestion') {
                return 6;
            }
            // Batch 7: Review request sender (runs after ingestion finishes)
            if (functionKey === 'reviewRequestSender') {
                return 7;
            }
            // Default to batch 2 if function key is not recognized
            logger.warn(`Unknown function key for batch assignment: ${functionKey}, defaulting to batch 2`);
            return 2;
        };

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
                case 'ads':
                    adsBatchPromises.push(promise);
                    adsBatchServiceNames.push(description);
                    break;
                case 3:
                    thirdBatchPromises.push(promise);
                    thirdBatchServiceNames.push(description);
                    break;
                case 'finance':
                    financeBatchPromises.push(promise);
                    financeBatchServiceNames.push(description);
                    break;
                case 4:
                    fourthBatchPromises.push(promise);
                    fourthBatchServiceNames.push(description);
                    break;
                case 5:
                    fifthBatchPromises.push(promise);
                    fifthBatchServiceNames.push(description);
                    break;
                case 6:
                    sixthBatchPromises.push(promise);
                    sixthBatchServiceNames.push(description);
                    break;
                case 7:
                    seventhBatchPromises.push(promise);
                    seventhBatchServiceNames.push(description);
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

            // Skip functions whose batch is filtered out (phased execution)
            const batchNum = getBatchNumber(functionKey);
            if (!runBatch(batchNum)) {
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
                        try {
                            const { campaignIdArray } = await this.getCampaignAndAdGroupIds(
                                apiData.ppcSpendsBySKU || { success: false }, userId, Region, Country
                            );
                            return tokenManager.wrapAdsFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                                AdsAccessToken, ProfileId, Region, userId, Country, campaignIdArray || []
                            );
                        } catch (error) {
                            logger.error(`Error in adGroupsData setup for ${functionKey}`, { error: error.message, userId });
                            throw error;
                        }
                    }).catch(error => {
                        logger.error(`Error in adGroupsData promise chain for ${functionKey}`, { error: error.message, userId });
                        return { success: false, error: error.message || 'Ad Groups data fetch failed', data: null };
                    });
                } else if (functionKey === 'negativeKeywords') {
                    // Need campaign and ad group IDs - will be available after batch 1
                    promise = Promise.resolve().then(async () => {
                        try {
                            const { campaignIdArray, adGroupIdArray } = await this.getCampaignAndAdGroupIds(
                                apiData.ppcSpendsBySKU || { success: false }, userId, Region, Country
                            );
                            return tokenManager.wrapAdsFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                                AdsAccessToken, ProfileId, userId, Country, Region,
                                campaignIdArray || [],
                                adGroupIdArray || []
                            );
                        } catch (error) {
                            logger.error(`Error in negativeKeywords setup for ${functionKey}`, { error: error.message, userId });
                            throw error;
                        }
                    }).catch(error => {
                        logger.error(`Error in negativeKeywords promise chain for ${functionKey}`, { error: error.message, userId });
                        return { success: false, error: error.message || 'Negative Keywords fetch failed', data: null };
                    });
                } else if (functionKey === 'mcpEconomicsData') {
                    // Sales-only MCP returns { success, data, error } structure
                    logger.info('Starting MCP SalesOnly fetch', { userId, region: Region, country: Country, hasRefreshToken: !!RefreshToken });
                    promise = serviceFunction(userId, RefreshToken, Region, Country)
                        .then(result => {
                            logger.info('MCP SalesOnly raw result', { 
                                userId, 
                                region: Region, 
                                country: Country,
                                hasResult: !!result,
                                success: result?.success,
                                hasData: !!result?.data,
                                error: result?.error
                            });
                            // Convert to standard format - KEEP the success wrapper for batch handler
                            if (result && result.success) {
                                logger.info('MCP SalesOnly succeeded', { userId, region: Region, country: Country });
                                // Return the full success wrapper, not just the data
                                return { success: true, data: result.data, error: null };
                            } else {
                                // Don't throw - return error object instead to be handled by Promise.allSettled
                                const errorMsg = result?.error || 'MCP SalesOnly fetch failed';
                                logger.warn('MCP SalesOnly returned failure', { error: errorMsg, userId, region: Region, country: Country });
                                return { success: false, error: errorMsg, data: null };
                            }
                        })
                        .catch(error => {
                            logger.error('Error in MCP SalesOnly promise chain', { 
                                error: error.message, 
                                stack: error.stack,
                                userId, 
                                region: Region, 
                                country: Country 
                            });
                            return { success: false, error: error.message || 'MCP SalesOnly fetch failed', data: null };
                        });
                } else if (functionKey === 'ppcMetricsAggregated') {
                    // PPC Metrics Aggregated — daily schedule fetches the last 14 days
                    // to capture the full attribution window across all campaign types:
                    //   SP uses sales7d (7-day window)
                    //   SB/SD use sales which is 14-day attribution
                    // Re-fetching 14 days ensures every campaign type's metrics converge
                    // to their final values. Uses upsertMetricsForDate (findOneAndUpdate)
                    // so re-fetched days are cleanly overwritten with the latest data.
                    // getPPCMetrics(accessToken, profileId, userId, country, region, refreshToken, startDate, endDate, saveToDatabase)
                    const _adsResyncStart = new Date(_yesterdayPacific);
                    _adsResyncStart.setUTCDate(_adsResyncStart.getUTCDate() - 13);
                    const adsResyncStartDate = _adsResyncStart.toISOString().split('T')[0];
                    promise = serviceFunction(AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken, adsResyncStartDate, scheduleYesterday, true)
                        .then(result => {
                            if (result && result.success !== false) {
                                logger.info('PPC Metrics Aggregated succeeded', { userId, region: Region, country: Country });
                                return { success: true, data: result, error: null };
                            } else {
                                const errorMsg = result?.error || 'PPC Metrics Aggregated fetch failed';
                                logger.warn('PPC Metrics Aggregated returned failure', { error: errorMsg, userId, region: Region, country: Country });
                                return { success: false, error: errorMsg, data: null };
                            }
                        })
                        .catch(error => {
                            logger.error('Error in PPC Metrics Aggregated promise chain', { 
                                error: error.message, 
                                stack: error.stack,
                                userId, 
                                region: Region, 
                                country: Country 
                            });
                            return { success: false, error: error.message || 'PPC Metrics Aggregated fetch failed', data: null };
                        });
                } else if (functionKey === 'mcpBuyBoxData') {
                    // MCP BuyBox returns { success, data, error } structure
                    promise = serviceFunction(userId, RefreshToken, Region, Country)
                        .then(result => {
                            // Convert to standard format - KEEP the success wrapper for batch handler
                            if (result && result.success) {
                                logger.info('MCP BuyBox succeeded', { userId, region: Region, country: Country });
                                // Return the full success wrapper, not just the data
                                return { success: true, data: result.data, error: null };
                            } else {
                                // Don't throw - return error object instead to be handled by Promise.allSettled
                                const errorMsg = result?.error || 'MCP BuyBox fetch failed';
                                logger.warn('MCP BuyBox returned failure', { error: errorMsg, userId, region: Region, country: Country });
                                return { success: false, error: errorMsg, data: null };
                            }
                        })
                        .catch(error => {
                            logger.error('Error in MCP BuyBox promise chain', { 
                                error: error.message, 
                                stack: error.stack,
                                userId, 
                                region: Region, 
                                country: Country 
                            });
                            return { success: false, error: error.message || 'MCP BuyBox fetch failed', data: null };
                        });
                } else if (functionKey === 'financeSync') {
                    // Daily schedule does NOT pin forceDates anymore — instead it
                    // lets syncFinanceData's incremental branch (FinanceService.js
                    // `if (!latestSync) → backfill / else → latestSync+1 → yesterday`)
                    // fill whatever gap exists. This means a missed day on Monday
                    // self-heals on Tuesday's run.
                    //
                    // `backfillDays: 1` caps the first-time fallback at 1 day so
                    // the daily schedule never triggers a 30-day window. The full
                    // 30-day backfill is reserved for the integration worker
                    // (`Integration.js`) where `backfillDays` defaults to 30.
                    //
                    // `resyncDays: 5` re-fetches the last 5 days on every run to
                    // correct orders that were captured as Pending/Unshipped but
                    // later got cancelled. The Sales Report is a single API call
                    // regardless of date range, so 5 days costs the same as 1 day.
                    //
                    // Pending-order backfill still runs inside syncFinanceData
                    // regardless of which branch is taken.
                    promise = serviceFunction({
                        userId,
                        country: Country,
                        regionModel: Region,
                        refreshToken: RefreshToken,
                        accessToken: AccessToken,
                        clientId: process.env.SPAPI_CLIENT_ID,
                        clientSecret: process.env.SPAPI_CLIENT_SECRET,
                        backfillDays: 1,
                        maxIncrementalDays: 7,
                        resyncDays: 5,
                    })
                        .then(result => {
                            logger.info('Finance Sync succeeded', {
                                userId,
                                region: Region,
                        country: Country,
                                status: result?.status,
                                startDate: result?.startDate,
                                endDate: result?.endDate,
                            });
                            return { success: true, data: result, error: null };
                        })
                        .catch(error => {
                            logger.error('Error in Finance Sync promise chain', {
                                error: error.message,
                                stack: error.stack,
                                userId,
                                region: Region,
                                country: Country,
                            });
                            return { success: false, error: error.message || 'Finance Sync failed', data: null };
                        });
                } else if (requiresAdsToken) {
                    // Daily report services — fetch last 14 days to capture the full
                    // attribution window (SP=7d, SB/SD=14d). A click on Day N can
                    // generate an attributed sale up to 14 days later; re-fetching
                    // ensures each day's metrics converge to their final values.
                    const _adsResyncStartForOpts = new Date(_yesterdayPacific);
                    _adsResyncStartForOpts.setUTCDate(_adsResyncStartForOpts.getUTCDate() - 13);
                    const adsResyncStartForOpts = _adsResyncStartForOpts.toISOString().split('T')[0];
                    const dailyDateOpts = { startDate: adsResyncStartForOpts, endDate: scheduleYesterday };

                    if (functionKey === 'ppcSpendsBySKU' || functionKey === 'adsKeywordsPerformanceData' || functionKey === 'ppcSpendsDateWise') {
                        // fn(accessToken, profileId, userId, country, region, refreshToken, options)
                        promise = tokenManager.wrapAdsFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                            AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken, dailyDateOpts
                        );
                    } else if (functionKey === 'searchKeywords') {
                        // fn(accessToken, profileId, userId, country, region, refreshToken, options)
                        promise = tokenManager.wrapAdsFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                            AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken, dailyDateOpts
                        );
                    } else if (functionKey === 'campaignData') {
                        // Entity snapshot — no date range
                        promise = tokenManager.wrapAdsFunction(serviceFunction, userId, RefreshToken, AdsRefreshToken)(
                            AdsAccessToken, ProfileId, Region, userId, Country
                        );
                    } else {
                        // Entity endpoints (adsKeywords, etc.) — no date range
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
                } else if (functionConfig.isCalculationService) {
                    // Calculation services (IssueSummary, ProductIssues)
                    // These run after all API fetches complete and use (userId, country, region, source)
                    promise = serviceFunction(userId, Country, Region, 'schedule');
                } else {
                    // Reimbursement functions (calculation only, no API call)
                    promise = serviceFunction(userId, Country, Region);
                }

                addToBatch(functionKey, functionConfig, promise, batchNum);

            } catch (setupError) {
                logger.error(`Error setting up ${description}`, { error: setupError.message, userId });
                apiData[dataKey] = { success: false, data: null, error: setupError.message };
            }
        }

        // Execute batches sequentially (same as Integration.js)
        
        // First Batch
        if (firstBatchPromises.length > 0 && runBatch(1)) {
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
            
            if (scheduledFunctions['ppcMetricsAggregated'] && AdsAccessToken) {
                // Special handling for PPC Metrics Aggregated (returns structured result)
                const result = firstBatchResults[resultIndex++];
                if (result.status === 'fulfilled') {
                    const value = result.value;
                    if (value && typeof value === 'object' && 'success' in value) {
                        apiData.ppcMetricsAggregated = value;
                    } else if (value && value.success !== false) {
                        apiData.ppcMetricsAggregated = { success: true, data: value, error: null };
                    } else {
                        const errorMsg = value?.error || 'Unknown error';
                        apiData.ppcMetricsAggregated = { success: false, data: null, error: errorMsg };
                    }
                } else {
                    const errorMsg = result.reason?.message || 'Promise rejected';
                    apiData.ppcMetricsAggregated = { success: false, data: null, error: errorMsg };
                }
            } else if (scheduledFunctions['ppcMetricsAggregated']) {
                apiData.ppcMetricsAggregated = { success: false, data: null, error: "Ads token not available" };
            }
        }
        logger.info("First Batch Ends");

        // Get campaign and ad group IDs (needed for batch 3 and 4)
        let campaignIdArray = [];
        let adGroupIdArray = [];
        if (runBatch(2) || runBatch(3) || runBatch(4)) try {
            const idsResult = await this.getCampaignAndAdGroupIds(
                apiData.ppcSpendsBySKU || { success: false }, userId, Region, Country
            );
            campaignIdArray = idsResult.campaignIdArray || [];
            adGroupIdArray = idsResult.adGroupIdArray || [];
        } catch (error) {
            logger.warn('Failed to get campaign and ad group IDs, continuing with empty arrays', {
                error: error.message,
                userId,
                region: Region,
                country: Country
            });
        }

        // Second Batch
        if (secondBatchPromises.length > 0 && runBatch(2)) {
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

        // Ads Batch (isolated into sched_ads phase): PPC async report services.
        // These take 40-50 min (report create → poll → download → parse) so they
        // run in their own phase to avoid pinning the batch_1_2 worker slot.
        if (adsBatchPromises.length > 0 && runBatch('ads')) {
            logger.info("Ads Batch Starts");
            const adsBatchResults = await Promise.allSettled(adsBatchPromises);
            let resultIndex = 0;
            for (const serviceName of adsBatchServiceNames) {
                const functionKey = Object.keys(scheduledFunctions).find(key =>
                    scheduledFunctions[key].description === serviceName
                );
                if (functionKey && resultIndex < adsBatchResults.length) {
                    const dataKey = scheduledFunctions[functionKey].apiDataKey || functionKey;
                    if (!apiData[dataKey]) {
                        apiData[dataKey] = processApiResult(adsBatchResults[resultIndex], serviceName);
                    }
                    resultIndex++;
                }
            }
        }
        logger.info("Ads Batch Ends");

        // Third Batch
        if (thirdBatchPromises.length > 0 && runBatch(3)) {
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
                            if (result.status === 'fulfilled') {
                                const value = result.value;
                                // Check if it's already in the error format we return from catch handlers
                                if (value && typeof value === 'object' && 'success' in value) {
                                    apiData[dataKey] = value;
                                } else if (value && value.success) {
                                    apiData[dataKey] = { success: true, data: value.data || value, error: null };
                                } else {
                                    const errorMsg = value?.error || 'Unknown error';
                                    apiData[dataKey] = { success: false, data: null, error: errorMsg };
                                }
                            } else {
                                const errorMsg = result.reason?.message || 'Promise rejected';
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

        // Finance Batch (isolated): syncFinanceData runs alone here.
        // The old combined batch_3_4 phase used to keep this serialised after batch 3 which
        // held the worker slot for 10-25 min while Amazon report polling ran. The new
        // `sched_finance` phase calls `fetchScheduledApiData` with `_batchFilter: ['finance']`
        // so it can run alone without pinning batch 3 / batch 4 work.
        if (financeBatchPromises.length > 0 && runBatch('finance')) {
            logger.info("Finance Batch Starts");
            const financeBatchResults = await Promise.allSettled(financeBatchPromises);
            let resultIndex = 0;
            for (const serviceName of financeBatchServiceNames) {
                const functionKey = Object.keys(scheduledFunctions).find(key =>
                    scheduledFunctions[key].description === serviceName
                );
                if (functionKey && resultIndex < financeBatchResults.length) {
                    const dataKey = scheduledFunctions[functionKey].apiDataKey || functionKey;
                    if (!apiData[dataKey]) {
                        apiData[dataKey] = processApiResult(financeBatchResults[resultIndex], serviceName);
                    }
                    resultIndex++;
                }
            }
            logger.info("Finance Batch Ends");
        }

        // Fourth Batch
        if (fourthBatchPromises.length > 0 && runBatch(4)) {
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

        // Fifth Batch: Calculation services (run after all API fetches complete)
        if (fifthBatchPromises.length > 0 && runBatch(5)) {
            logger.info("Fifth Batch (Calculation Services) Starts");
            const fifthBatchResults = await Promise.allSettled(fifthBatchPromises);
            let resultIndex = 0;
            
            // Process results in order
            for (const serviceName of fifthBatchServiceNames) {
                const functionKey = Object.keys(scheduledFunctions).find(key => 
                    scheduledFunctions[key].description === serviceName
                );
                if (functionKey && resultIndex < fifthBatchResults.length) {
                    const dataKey = scheduledFunctions[functionKey].apiDataKey || functionKey;
                    if (!apiData[dataKey]) {
                        // Calculation services return { success, data, error } format
                        const result = fifthBatchResults[resultIndex];
                        if (result.status === 'fulfilled') {
                            const value = result.value;
                            if (value && typeof value === 'object' && 'success' in value) {
                                apiData[dataKey] = value;
                            } else if (value) {
                                apiData[dataKey] = { success: true, data: value, error: null };
                            } else {
                                apiData[dataKey] = { success: false, data: null, error: 'Unknown error' };
                            }
                        } else {
                            const errorMsg = result.reason?.message || 'Promise rejected';
                            apiData[dataKey] = { success: false, data: null, error: errorMsg };
                        }
                    }
                    resultIndex++;
                }
            }
        }
        logger.info("Fifth Batch (Calculation Services) Ends");

        // Sixth Batch: Review order ingestion (must finish before sender)
        if (sixthBatchPromises.length > 0 && runBatch(6)) {
            logger.info("Sixth Batch (Review Order Ingestion) Starts");
            const sixthBatchResults = await Promise.allSettled(sixthBatchPromises);
            let resultIndex = 0;

            for (const serviceName of sixthBatchServiceNames) {
                const functionKey = Object.keys(scheduledFunctions).find(key =>
                    scheduledFunctions[key].description === serviceName
                );
                if (functionKey && resultIndex < sixthBatchResults.length) {
                    const dataKey = scheduledFunctions[functionKey].apiDataKey || functionKey;
                    if (!apiData[dataKey]) {
                        const result = sixthBatchResults[resultIndex];
                        if (result.status === 'fulfilled') {
                            const value = result.value;
                            if (value && typeof value === 'object' && 'success' in value) {
                                apiData[dataKey] = value;
                            } else if (value) {
                                apiData[dataKey] = { success: true, data: value, error: null };
                            } else {
                                apiData[dataKey] = { success: false, data: null, error: 'Unknown error' };
                            }
                        } else {
                            const errorMsg = result.reason?.message || 'Promise rejected';
                            apiData[dataKey] = { success: false, data: null, error: errorMsg };
                        }
                    }
                    resultIndex++;
                }
            }
        }
        logger.info("Sixth Batch (Review Order Ingestion) Ends");

        // Seventh Batch: Review request sender (runs after ingestion completes)
        if (seventhBatchPromises.length > 0 && runBatch(7)) {
            logger.info("Seventh Batch (Review Request Sender) Starts");
            const seventhBatchResults = await Promise.allSettled(seventhBatchPromises);
            let resultIndex = 0;

            for (const serviceName of seventhBatchServiceNames) {
                const functionKey = Object.keys(scheduledFunctions).find(key =>
                    scheduledFunctions[key].description === serviceName
                );
                if (functionKey && resultIndex < seventhBatchResults.length) {
                    const dataKey = scheduledFunctions[functionKey].apiDataKey || functionKey;
                    if (!apiData[dataKey]) {
                        const result = seventhBatchResults[resultIndex];
                        if (result.status === 'fulfilled') {
                            const value = result.value;
                            if (value && typeof value === 'object' && 'success' in value) {
                                apiData[dataKey] = value;
                            } else if (value) {
                                apiData[dataKey] = { success: true, data: value, error: null };
                            } else {
                                apiData[dataKey] = { success: false, data: null, error: 'Unknown error' };
                            }
                        } else {
                            const errorMsg = result.reason?.message || 'Promise rejected';
                            apiData[dataKey] = { success: false, data: null, error: errorMsg };
                        }
                    }
                    resultIndex++;
                }
            }
        }
        logger.info("Seventh Batch (Review Request Sender) Ends");

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
            // Use service layer that handles both old (embedded array) and new (separate collection) formats
            const storedSponsoredAdsData = await getProductWiseSponsoredAdsData(userId, Country, Region);

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
     * Process inactive listing items and fetch their issues from Amazon SP-API (same as Integration)
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
                    await this.updateSellerProductIssues(userId, Country, Region, validResults);
                }

                logger.info("processInactiveListingItems batch completed", {
                    batchNumber,
                    batchProcessed: validResults.length,
                    batchTotal: batchSKUs.length,
                    totalProcessed: totalProcessedCount,
                    totalRemaining: inactiveSkuArray.length - batchEnd
                });

                if (batchEnd < inactiveSkuArray.length) {
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
     * Update Seller model with issues for inactive products (same as Integration)
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

            // Create a map of SKU to issues for quick lookup
            const issuesMap = new Map();
            issuesDataArray.forEach(item => {
                if (item && item.sku && Array.isArray(item.issues)) {
                    issuesMap.set(item.sku, item.issues);
                }
            });

            // Update the products array with issues
            const products = sellerDetails.sellerAccount[accountIndex].products;
            let updatedCount = 0;

            products.forEach(product => {
                // Update issues for both Inactive and Incomplete products
                if ((product.status === 'Inactive' || product.status === 'Incomplete') && issuesMap.has(product.sku)) {
                    product.issues = issuesMap.get(product.sku);
                    updatedCount++;
                }
            });

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
     * Process and save data (same as Integration)
     */
    static async processAndSaveData(params) {
        logger.info("processAndSaveData starting");
        
        const { userId, Region, Country, apiData, productData, merchantListingsData, loggingHelper } = params;

        // Save generic keywords if available - Uses service layer to prevent 16MB limit
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
            ppcMetricsAggregated: apiData.ppcMetricsAggregated?.success ? apiData.ppcMetricsAggregated.data : null,
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
     * Generate service summary based on scheduled functions only
     * Only counts services that were scheduled for the current day
     */
    static generateServiceSummary(apiData) {
        const services = [];
        
        // Add all services that were attempted (only scheduled functions have success property)
        // Note: genericKeyWordArray is an array, not an object with success, so it's excluded
        for (const [key, value] of Object.entries(apiData)) {
            // Only count objects with 'success' property (scheduled functions)
            // Exclude arrays and other non-service entries
            if (value && typeof value === 'object' && !Array.isArray(value) && 'success' in value) {
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

        // All services are treated equally - no critical/non-critical distinction
        // Calculate success percentage based on scheduled functions only
        const successPercentage = services.length > 0 ? Math.round((successful.length / services.length) * 100) : 0;
        
        // Consider overall success if at least one service succeeded
        // This ensures partial data is still usable and the job doesn't fail entirely
        const overallSuccess = successful.length > 0;

        logger.info('Service summary calculated', {
            totalScheduledServices: services.length,
            successful: successful.length,
            failed: failed.length,
            successPercentage: `${successPercentage}%`
        });

        return {
            successful,
            failed,
            warnings,
            overallSuccess,
            successPercentage,
            totalServices: services.length // Only scheduled services are counted
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
            const { markFirstAnalysisDone } = require('../User/userServices.js');
            
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
     * Same implementation as Integration.js
     * Uses local calculation service instead of external calculation server
     */
    static async addNewAccountHistory(userId, country, region) {
        logger.info("addNewAccountHistory starting (scheduled)", { userId, country, region });

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

            const { AnalyseService } = require('../main/Analyse.js');
            const { addAccountHistory } = require('../History/addAccountHistory.js');
            
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
            logger.info("Saving account history (scheduled)", {
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

            // NOTE: IssueSummary, ProductIssues, and IssuesData are NOT updated here for scheduled runs.
            // They are only recalculated on Sundays via ScheduleConfig (after NumberOfProductReviews runs)
            // This avoids unnecessary daily recalculation of issue counts/data.
            // First-time integration (Integration.js) still calculates them immediately.

            logger.info("addNewAccountHistory completed successfully (scheduled)", { userId, country, region });
            return addAccountHistoryData;

        } catch (error) {
            logger.error("Error in addNewAccountHistory (scheduled)", {
                error: error.message,
                stack: error.stack,
                userId,
                country,
                region
            });
            throw error; // Re-throw so caller can handle
        }
    }

    // =========================================================================
    // PHASED EXECUTION METHODS
    // These methods break getScheduledApiData into independent BullMQ jobs.
    // Each phase re-fetches tokens (resilient to worker restarts) and passes
    // minimal data forward via phaseData.
    // The existing getScheduledApiData() is preserved as legacy fallback.
    // =========================================================================

    /**
     * Phase 1: INIT
     * Validate user, generate tokens, fetch merchant listings, start tracking.
     */
    static async executeScheduledInitPhase(userId, Region, Country) {
        logger.info(`[ScheduledIntegration:InitPhase] Starting for user ${userId}, ${Country}-${Region}`);

        let loggingHelper = null;
        let sessionId = null;
        try {
            loggingHelper = new LoggingHelper(userId, Region, Country);
            await loggingHelper.initSession();
            sessionId = loggingHelper.sessionId;
            loggingHelper.logFunctionStart('ScheduledIntegration.InitPhase', { userId, region: Region, country: Country });
        } catch (e) {
            logger.warn(`[ScheduledIntegration:InitPhase] Failed to create logging session: ${e.message}`);
        }

        try {
            const validationResult = await this.validateInputs(userId, Region, Country);
            if (!validationResult.success) return { success: false, error: validationResult.error, statusCode: validationResult.statusCode };

            const config = this.getConfiguration(Region, Country);
            if (!config.success) return { success: false, error: config.error, statusCode: config.statusCode };
            const { Base_URI, Marketplace_Id, regionConfig, marketplaceIds } = config;

            const sellerDataResult = await this.getSellerDataAndTokens(userId, Region, Country);
            if (!sellerDataResult.success) return { success: false, error: sellerDataResult.error, statusCode: sellerDataResult.statusCode };
            const { RefreshToken, AdsRefreshToken, ProfileId, sellerId } = sellerDataResult;

            const credentialsResult = await this.generateCredentials(regionConfig, loggingHelper);
            if (!credentialsResult.success) return { success: false, error: credentialsResult.error, statusCode: credentialsResult.statusCode };

            const tokenResult = await this.generateTokens(userId, RefreshToken, AdsRefreshToken, loggingHelper);
            if (!tokenResult.success) return { success: false, error: tokenResult.error, statusCode: tokenResult.statusCode };
            const { AccessToken, AdsAccessToken } = tokenResult;

            tokenManager.setTokens(userId, AccessToken, AdsAccessToken, RefreshToken, AdsRefreshToken);

            const dayOfWeek = new Date().getDay();
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            logger.info(`[ScheduledIntegration:InitPhase] Processing for ${dayNames[dayOfWeek]} (day ${dayOfWeek})`, { userId, Region, Country });

            // DataFetchTracking runs every day now that PPC reports are daily.
            // Previously gated to Mon/Wed/Fri only.
            let trackingEntryId = null;
            {
                const { getDefaultReportDateRange } = require('../../utils/reportDateRange.js');
                const trackingRange = getDefaultReportDateRange(30);
                try {
                    const entry = await DataFetchTrackingService.startTracking(userId, Country, Region, { startDate: trackingRange.startDate, endDate: trackingRange.endDate }, sessionId);
                    trackingEntryId = entry._id.toString();
                    logger.info('[ScheduledIntegration:InitPhase] Calendar tracking started', { trackingId: trackingEntryId, dayName: dayNames[dayOfWeek], dataRange: trackingRange });
                } catch (te) {
                    logger.warn('[ScheduledIntegration:InitPhase] Failed to start calendar tracking', { error: te.message });
                }
            }

            const merchantListingsData = await this.fetchMerchantListings(AccessToken, marketplaceIds, userId, Country, Region, Base_URI, RefreshToken, AdsRefreshToken, loggingHelper);

            await runFbaInventorySyncForMarketplace({
                userId,
                country: Country,
                region: Region,
                accessToken: AccessToken,
                loggingHelper,
            });

            const productData = this.extractProductData(merchantListingsData, Country, Region);
            const inactiveProductData = this.extractInactiveProductData(merchantListingsData, Country, Region);

            logger.info(`[ScheduledIntegration:InitPhase] Completed for user ${userId}`, {
                asinCount: productData.asinArray?.length || 0,
                inactiveCount: inactiveProductData.inactiveSkuArray?.length || 0
            });

            // DashboardSlice write (additive, non-fatal): "listings" summary used by
            // finalize's slice-assembler path. The active/inactive counts here mirror
            // what `productWiseError` length renders on the dashboard today.
            await dashboardSliceService.writeSlice({
                userId,
                country: Country,
                region: Region,
                sliceKey: SLICE_KEYS.LISTINGS,
                producedByPhase: 'sched_init',
                data: {
                    activeProductCount: productData.asinArray?.length || 0,
                    inactiveProductCount: inactiveProductData.inactiveSkuArray?.length || 0,
                    hasAdsAccount: !!AdsRefreshToken,
                    sellerId: sellerId || null,
                    dayOfWeek,
                    capturedAt: new Date().toISOString()
                }
            });

            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('ScheduledIntegration.InitPhase', null, { recordsProcessed: productData.asinArray?.length || 0 });
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
                    sessionId,
                    dayOfWeek,
                    trackingEntryId,
                    apiResults: {}
                }
            };
        } catch (error) {
            logger.error(`[ScheduledIntegration:InitPhase] Failed for user ${userId}:`, error);
            if (loggingHelper) { loggingHelper.logFunctionError('ScheduledIntegration.InitPhase', error); await loggingHelper.endSession('failed'); }
            return { success: false, error: error.message, statusCode: 500 };
        }
    }

    /**
     * Shared helper: re-fetch tokens and config for a batch phase.
     * Each batch phase calls this so it survives worker restarts.
     */
    static async _prepareForBatchPhase(userId, Region, Country, phaseData) {
        const config = this.getConfiguration(Region, Country);
        if (!config.success) throw new Error(config.error);
        const { Base_URI, Marketplace_Id, regionConfig, marketplaceIds } = config;

        const sellerDataResult = await this.getSellerDataAndTokens(userId, Region, Country);
        if (!sellerDataResult.success) throw new Error(sellerDataResult.error);
        const { RefreshToken, AdsRefreshToken, ProfileId, sellerId } = sellerDataResult;

        const credentialsResult = await this.generateCredentials(regionConfig, null);
        if (!credentialsResult.success) throw new Error(credentialsResult.error);
        const credentials = credentialsResult.credentials;

        const tokenResult = await this.generateTokens(userId, RefreshToken, AdsRefreshToken, null);
        if (!tokenResult.success) throw new Error(tokenResult.error);
        const { AccessToken, AdsAccessToken } = tokenResult;

        tokenManager.setTokens(userId, AccessToken, AdsAccessToken, RefreshToken, AdsRefreshToken);

        // Fetch active product arrays directly from DB instead of phaseData
        const productArrays = await this._fetchProductArraysFromDB(userId, Country, Region);
        const dataToSend = this.prepareDataToSend(Marketplace_Id, AccessToken, credentials, productArrays.asinArray, Country, sellerId);

        return {
            AccessToken, AdsAccessToken, RefreshToken, AdsRefreshToken, ProfileId, sellerId,
            marketplaceIds, Base_URI, credentials, dataToSend, productArrays
        };
    }

    /**
     * Fetch active/inactive product arrays directly from the Seller model.
     */
    static async _fetchProductArraysFromDB(userId, country, region) {
        const asinArray = [];
        const skuArray = [];
        const inactiveAsinArray = [];
        const inactiveSkuArray = [];

        const seller = await Seller.findOne({ User: userId }).lean();
        if (!seller || !Array.isArray(seller.sellerAccount)) {
            logger.warn('[ScheduledIntegration:_fetchProductArraysFromDB] Seller not found or no accounts', { userId, country, region });
            return { asinArray, skuArray, inactiveAsinArray, inactiveSkuArray };
        }

        const account = seller.sellerAccount.find(
            acc => acc && acc.country === country && acc.region === region
        );

        if (!account || !Array.isArray(account.products)) {
            logger.warn('[ScheduledIntegration:_fetchProductArraysFromDB] No matching account or products', { userId, country, region });
            return { asinArray, skuArray, inactiveAsinArray, inactiveSkuArray };
        }

        for (const product of account.products) {
            if (!product || typeof product !== 'object') continue;
            const asin = typeof product.asin === 'string' ? product.asin.trim() : '';
            const sku = typeof product.sku === 'string' ? product.sku.trim() : '';
            if (!asin || !sku) continue;

            if (product.status === 'Active') {
                asinArray.push(asin);
                skuArray.push(sku);
            } else if (product.status === 'Inactive' || product.status === 'Incomplete') {
                inactiveAsinArray.push(asin);
                inactiveSkuArray.push(sku);
            }
        }

        logger.info('[ScheduledIntegration:_fetchProductArraysFromDB] Fetched product arrays from DB', {
            userId, country, region, active: asinArray.length, inactive: inactiveAsinArray.length
        });

        return { asinArray, skuArray, inactiveAsinArray, inactiveSkuArray };
    }

    // =========================================================================
    // DashboardSlice helpers (additive, non-fatal — see DashboardSliceService).
    // Function-key → slice categorisation. Keeping it static here means the
    // mapping lives next to the phase logic that produces it; if a new service
    // is added to ScheduleConfig.js, only this map needs updating.
    // =========================================================================
    static _SLICE_CATEGORY_MAP = {
        // Ads slice (sched_ads phase — PPC async report services)
        ads: [
            'ppcSpendsBySKU', 'adsKeywordsPerformanceData', 'ppcSpendsDateWise',
            'ppcMetricsAggregated'
        ],
        // PPC slice (entity endpoints that remain in batch_3/batch_4 via Mon/Wed/Fri)
        ppc: ['adsKeywords', 'campaignData'],
        // Inventory slice (batch 2)
        inventory: [
            'RestockinventoryData', 'fbaInventoryPlanningData',
            'strandedInventoryData', 'inboundNonComplianceData'
        ],
        // Performance slice (batch 1/2 — V2/V1 perf + reviews + ledger/reimbursement reads)
        performance: [
            'v2data', 'v1data', 'productReview',
            'ledgerSummaryViewData', 'ledgerDetailViewData', 'fbaReimbursementsData',
            'calculateShipmentDiscrepancy', 'calculateLostInventoryReimbursement',
            'calculateDamagedInventoryReimbursement', 'calculateDisposedInventoryReimbursement'
        ],
        // MCP slice (batch 3 — shipment + brand + adGroups + MCP SalesOnly + BuyBox)
        mcp: ['shipment', 'brandData', 'adGroupsData', 'mcpEconomicsData', 'mcpBuyBoxData'],
        // Finance slice (isolated finance phase)
        finance: ['financeSync'],
        // Keywords slice (batch 4)
        keywords: ['negativeKeywords', 'searchKeywords', 'keywordRecommendations'],
        // Issues slice (calc_review phase)
        issues: ['issueSummary', 'productIssues', 'issuesData', 'reviewOrderIngestion', 'reviewRequestSender']
    };

    /**
     * Build a single slice payload from a phase's apiData.
     * Returns null when no matching service ran (so we don't overwrite a
     * previously-written slice with empty data).
     */
    static _buildSlicePayload(sliceKey, apiData) {
        const keys = ScheduledIntegration._SLICE_CATEGORY_MAP[sliceKey] || [];
        const services = {};
        let ran = 0;
        let succeeded = 0;
        let failed = 0;
        const errors = [];

        for (const k of keys) {
            const v = apiData ? apiData[k] : undefined;
            if (!v || typeof v !== 'object' || !('success' in v)) continue;
            ran += 1;
            services[k] = { success: !!v.success, error: v.error || null };
            if (v.success) succeeded += 1;
            else { failed += 1; if (v.error) errors.push({ service: k, error: v.error }); }
        }

        if (ran === 0) return null;

        return {
            services,
            counts: { ran, succeeded, failed },
            errors,
            producedAt: new Date().toISOString()
        };
    }

    /**
     * Write the slice documents that belong to a given phase.
     * Slice writes never throw — DashboardSliceService swallows errors.
     *
     * @param {string} phaseName  - e.g. 'sched_batch_1_2'
     * @param {Array<string>} sliceKeys - which slices this phase produces
     * @param {Object} args - { userId, country, region, apiData }
     */
    static async _writePhaseSlices(phaseName, sliceKeys, args) {
        const { userId, country, region, apiData } = args;
        await Promise.all(
            sliceKeys.map(sliceKey => {
                const data = ScheduledIntegration._buildSlicePayload(sliceKey, apiData);
                if (!data) return null;
                return dashboardSliceService.writeSlice({
                    userId,
                    country,
                    region,
                    sliceKey,
                    producedByPhase: phaseName,
                    data
                });
            })
        );
    }

    /**
     * Phase 2: BATCH_1_2
     * Runs original batches 1 and 2 (reports, PPC, inventory).
     */
    static async executeScheduledBatch1And2Phase(userId, Region, Country, phaseData = {}) {
        logger.info(`[ScheduledIntegration:Batch1And2Phase] Starting for user ${userId}, ${Country}-${Region}`);
        try {
            const ctx = await this._prepareForBatchPhase(userId, Region, Country, phaseData);
            const dayOfWeek = phaseData.dayOfWeek !== undefined ? phaseData.dayOfWeek : new Date().getDay();

            const apiData = await this.fetchScheduledApiData({
                ...ctx, marketplaceIds: ctx.marketplaceIds, userId, Country, Region,
                productData: { asinArray: ctx.productArrays.asinArray, skuArray: ctx.productArrays.skuArray, ProductDetails: [] },
                dataToSend: ctx.dataToSend, loggingHelper: null, dayOfWeek,
                _batchFilter: [1, 2]
            });

            const phaseApiResults = {};
            for (const [key, value] of Object.entries(apiData)) {
                if (value && typeof value === 'object' && !Array.isArray(value) && 'success' in value) {
                    phaseApiResults[key] = { success: value.success, error: value.error || null };
                }
            }

            // DashboardSlice writes (additive, non-fatal): this phase produces the
            // inventory + performance slices. PPC report data moved to sched_ads phase.
            await this._writePhaseSlices(
                'sched_batch_1_2',
                [SLICE_KEYS.INVENTORY, SLICE_KEYS.PERFORMANCE],
                { userId, country: Country, region: Region, apiData }
            );

            logger.info(`[ScheduledIntegration:Batch1And2Phase] Completed for user ${userId}`, { servicesRun: Object.keys(phaseApiResults).length });
            return {
                success: true,
                dataForNextPhase: { apiResults: { ...(phaseData.apiResults || {}), ...phaseApiResults } }
            };
        } catch (error) {
            logger.error(`[ScheduledIntegration:Batch1And2Phase] Failed for user ${userId}:`, error);
            return { success: false, error: error.message, statusCode: 500 };
        }
    }

    /**
     * Phase: ADS (new, post-split from batch_1_2)
     *
     * All PPC async report services: PPCMetrics, PPCProductWise, PPCUnitsSold,
     * DateWiseSpend, WastedSpendKeywords. These take 40-50 min because of the
     * async report create → poll → download → parse cycle with Amazon Ads API.
     *
     * Isolating them means sched_batch_1_2 completes in 3-5 min (reports + inventory)
     * instead of 40-50 min, freeing the worker slot much earlier.
     *
     * These now run daily (moved from Mon/Wed/Fri) so the dashboard always shows
     * yesterday's ad spend.
     */
    static async executeScheduledAdsPhase(userId, Region, Country, phaseData = {}) {
        logger.info(`[ScheduledIntegration:AdsPhase] Starting for user ${userId}, ${Country}-${Region}`);
        try {
            const ctx = await this._prepareForBatchPhase(userId, Region, Country, phaseData);
            const dayOfWeek = phaseData.dayOfWeek !== undefined ? phaseData.dayOfWeek : new Date().getDay();

            const apiData = await this.fetchScheduledApiData({
                ...ctx, marketplaceIds: ctx.marketplaceIds, userId, Country, Region,
                productData: { asinArray: ctx.productArrays.asinArray, skuArray: ctx.productArrays.skuArray, ProductDetails: [] },
                dataToSend: ctx.dataToSend, loggingHelper: null, dayOfWeek,
                _batchFilter: ['ads']
            });

            const phaseApiResults = {};
            for (const [key, value] of Object.entries(apiData)) {
                if (value && typeof value === 'object' && !Array.isArray(value) && 'success' in value) {
                    phaseApiResults[key] = { success: value.success, error: value.error || null };
                }
            }

            // DashboardSlice write (additive, non-fatal): "ads" slice summarises PPC report results.
            await this._writePhaseSlices(
                'sched_ads',
                [SLICE_KEYS.ADS],
                { userId, country: Country, region: Region, apiData }
            );

            // Honest phase status: the worker pipeline always advances to the
            // next phase, but the *recorded* outcome on this row must reflect
            // whether any ads service actually returned data. Finalize uses
            // these flags to decide whether to stamp lastDailyUpdate (A.3).
            //
            // We treat the phase as failed only when EVERY ads service either
            // didn't run or returned success: false. A single successful service
            // is enough to count the phase as a (partial) success.
            const adsServiceKeys = ['ppcSpendsBySKU', 'adsKeywordsPerformanceData', 'ppcSpendsDateWise', 'ppcMetricsAggregated'];
            const adsResults = adsServiceKeys
                .map(k => phaseApiResults[k])
                .filter(r => r && typeof r === 'object');
            const anyAdsSucceeded = adsResults.some(r => r.success === true);
            const adsRan = adsResults.length > 0;
            const phaseSucceeded = !adsRan || anyAdsSucceeded;
            const phaseError = phaseSucceeded
                ? null
                : (adsResults.find(r => r.error)?.error || 'No ads services returned data');

            logger.info(`[ScheduledIntegration:AdsPhase] Completed for user ${userId}`, {
                servicesRun: Object.keys(phaseApiResults).length,
                adsServicesRan: adsResults.length,
                anyAdsSucceeded,
                phaseSucceeded
            });
            return {
                success: phaseSucceeded,
                error: phaseError,
                dataForNextPhase: { apiResults: { ...(phaseData.apiResults || {}), ...phaseApiResults } }
            };
        } catch (error) {
            logger.error(`[ScheduledIntegration:AdsPhase] Failed for user ${userId}:`, error);
            return { success: false, error: error.message, statusCode: 500 };
        }
    }

    /**
     * Phase: ADS_CATCHUP (one-shot, NOT chained)
     *
     * Enqueued by `freshnessSweeper` for accounts with missing past PPC days.
     * Fetches all four PPC report services for a single `catchupDate` and writes
     * to the same `PPCMetrics` / `SponsoredAds` / `adsKeywordsPerformance`
     * collections that the daily `sched_ads` phase writes to.
     *
     * Why it's a separate phase (instead of overloading sched_ads):
     *  - `sched_ads` is part of PHASE_ORDER and chains to BATCH_4 → CALC → FINALIZE.
     *    A catch-up should NOT trigger calc/finalize for an old day.
     *  - This phase is absent from PHASE_ORDER, so `getNextPhase` returns null
     *    and the worker stops after running it.
     *
     * Internal logic guarantee:
     *  - Calls the existing 4 ads service functions with the catchupDate as
     *    both startDate and endDate. Those functions handle their own report
     *    creation, polling, parsing, and per-date upsert writes. NO ads code
     *    is modified by this phase.
     *
     * Expected phaseData shape:
     *   { catchupDate: 'YYYY-MM-DD' }
     */
    static async executeAdsCatchupPhase(userId, Region, Country, phaseData = {}) {
        const catchupDate = phaseData?.catchupDate;
        logger.info(`[ScheduledIntegration:AdsCatchupPhase] Starting for user ${userId}, ${Country}-${Region}, date=${catchupDate}`);

        if (!catchupDate || !/^\d{4}-\d{2}-\d{2}$/.test(catchupDate)) {
            const err = `Invalid catchupDate: ${catchupDate}. Expected YYYY-MM-DD.`;
            logger.error(`[ScheduledIntegration:AdsCatchupPhase] ${err}`);
            return { success: false, error: err };
        }

        try {
            const ctx = await this._prepareForBatchPhase(userId, Region, Country, phaseData);
            const { AdsAccessToken, AdsRefreshToken, ProfileId } = ctx;

            if (!AdsAccessToken || !ProfileId) {
                logger.warn(`[ScheduledIntegration:AdsCatchupPhase] No ads token/profile — skipping`, { userId, Country, Region });
                return { success: false, error: 'Ads token/profile unavailable' };
            }

            // Lazy-require the ads service modules so a syntax error in one
            // can't break unrelated phases at module-load time.
            const { getPPCMetrics } = require('../AmazonAds/GetPPCMetrics.js');
            const { getPPCSpendsBySKU } = require('../AmazonAds/GetPPCProductWise.js');
            const { getKeywordPerformanceReport } = require('../AmazonAds/GetWastedSpendKeywords.js');
            const { getPPCSpendsDateWise } = require('../AmazonAds/GetDateWiseSpendKeywords.js');

            const dateOpts = { startDate: catchupDate, endDate: catchupDate };
            const results = {};

            // Each service is wrapped so a failure of one doesn't abort the
            // others — analogous to Promise.allSettled in fetchScheduledApiData.
            const safeRun = async (label, fn) => {
                try {
                    const value = await fn();
                    results[label] = { success: true, error: null };
                    return value;
                } catch (err) {
                    logger.warn(`[ScheduledIntegration:AdsCatchupPhase] ${label} failed for ${catchupDate}: ${err.message}`);
                    results[label] = { success: false, error: err.message };
                    return null;
                }
            };

            await Promise.all([
                safeRun('ppcMetricsAggregated', () =>
                    getPPCMetrics(AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken, catchupDate, catchupDate, true)
                ),
                safeRun('ppcSpendsBySKU', () =>
                    tokenManager.wrapAdsFunction(getPPCSpendsBySKU, userId, ctx.RefreshToken, AdsRefreshToken)(
                        AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken, dateOpts
                    )
                ),
                safeRun('adsKeywordsPerformanceData', () =>
                    tokenManager.wrapAdsFunction(getKeywordPerformanceReport, userId, ctx.RefreshToken, AdsRefreshToken)(
                        AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken, dateOpts
                    )
                ),
                safeRun('ppcSpendsDateWise', () =>
                    tokenManager.wrapAdsFunction(getPPCSpendsDateWise, userId, ctx.RefreshToken, AdsRefreshToken)(
                        AdsAccessToken, ProfileId, userId, Country, Region, AdsRefreshToken, dateOpts
                    )
                )
            ]);

            const anySucceeded = Object.values(results).some(r => r?.success === true);
            const succeededCount = Object.values(results).filter(r => r?.success === true).length;

            logger.info(`[ScheduledIntegration:AdsCatchupPhase] Completed for user ${userId}, date=${catchupDate}`, {
                succeededCount,
                totalServices: Object.keys(results).length,
                anySucceeded
            });

            return {
                success: anySucceeded,
                error: anySucceeded ? null : 'All ads services failed during catch-up',
                catchupDate,
                results
            };
        } catch (error) {
            logger.error(`[ScheduledIntegration:AdsCatchupPhase] Failed for user ${userId}, date=${catchupDate}:`, error);
            return { success: false, error: error.message, statusCode: 500 };
        }
    }

    /**
     * LEGACY Phase: BATCH_3_4 (combined)
     *
     * Kept ONLY to drain in-flight `sched_batch_3_4` jobs that existed at deploy time
     * (their pipelines were enqueued before the split). New pipelines never enqueue
     * this phase — `sched_batch_1_2` now chains to `sched_batch_3`.
     *
     * Filter includes `'finance'` so legacy jobs still get finance synced before
     * advancing to `sched_calc_review` (see `LEGACY_NEXT_PHASE` in scheduledPhases.js).
     *
     * Safe to delete once the queue is verified empty of `sched_batch_3_4` jobs:
     *   redis-cli -n 0 KEYS 'bullmq:user-data-processing:*sched_batch_3_4*'
     */
    static async executeScheduledBatch3And4Phase(userId, Region, Country, phaseData = {}) {
        logger.info(`[ScheduledIntegration:Batch3And4Phase][LEGACY] Starting for user ${userId}, ${Country}-${Region}`);
        try {
            const ctx = await this._prepareForBatchPhase(userId, Region, Country, phaseData);
            const dayOfWeek = phaseData.dayOfWeek !== undefined ? phaseData.dayOfWeek : new Date().getDay();

            const apiData = await this.fetchScheduledApiData({
                ...ctx, marketplaceIds: ctx.marketplaceIds, userId, Country, Region,
                productData: { asinArray: ctx.productArrays.asinArray, skuArray: ctx.productArrays.skuArray, ProductDetails: [] },
                dataToSend: ctx.dataToSend, loggingHelper: null, dayOfWeek,
                _batchFilter: [3, 'finance', 4]
            });

            const phaseApiResults = {};
            for (const [key, value] of Object.entries(apiData)) {
                if (value && typeof value === 'object' && !Array.isArray(value) && 'success' in value) {
                    phaseApiResults[key] = { success: value.success, error: value.error || null };
                }
            }

            logger.info(`[ScheduledIntegration:Batch3And4Phase][LEGACY] Completed for user ${userId}`, { servicesRun: Object.keys(phaseApiResults).length });
            return {
                success: true,
                dataForNextPhase: { apiResults: { ...(phaseData.apiResults || {}), ...phaseApiResults } }
            };
        } catch (error) {
            logger.error(`[ScheduledIntegration:Batch3And4Phase][LEGACY] Failed for user ${userId}:`, error);
            return { success: false, error: error.message, statusCode: 500 };
        }
    }

    /**
     * Phase: BATCH_3 (new, post-split)
     *
     * Runs shipment, brand, adGroups, MCP SalesOnly, MCP BuyBox.
     * Excludes Finance Sync (moved to its own `sched_finance` phase).
     * Typical duration: ~3-5 min. Releases the worker slot before Finance Sync polling.
     */
    static async executeScheduledBatch3Phase(userId, Region, Country, phaseData = {}) {
        logger.info(`[ScheduledIntegration:Batch3Phase] Starting for user ${userId}, ${Country}-${Region}`);
        try {
            const ctx = await this._prepareForBatchPhase(userId, Region, Country, phaseData);
            const dayOfWeek = phaseData.dayOfWeek !== undefined ? phaseData.dayOfWeek : new Date().getDay();

            const apiData = await this.fetchScheduledApiData({
                ...ctx, marketplaceIds: ctx.marketplaceIds, userId, Country, Region,
                productData: { asinArray: ctx.productArrays.asinArray, skuArray: ctx.productArrays.skuArray, ProductDetails: [] },
                dataToSend: ctx.dataToSend, loggingHelper: null, dayOfWeek,
                _batchFilter: [3]
            });

            const phaseApiResults = {};
            for (const [key, value] of Object.entries(apiData)) {
                if (value && typeof value === 'object' && !Array.isArray(value) && 'success' in value) {
                    phaseApiResults[key] = { success: value.success, error: value.error || null };
                }
            }

            // DashboardSlice write (additive, non-fatal): "mcp" slice rolls up shipment,
            // brand, adGroups, MCP SalesOnly and MCP BuyBox into one summary doc.
            await this._writePhaseSlices(
                'sched_batch_3',
                [SLICE_KEYS.MCP],
                { userId, country: Country, region: Region, apiData }
            );

            logger.info(`[ScheduledIntegration:Batch3Phase] Completed for user ${userId}`, { servicesRun: Object.keys(phaseApiResults).length });
            return {
                success: true,
                dataForNextPhase: { apiResults: { ...(phaseData.apiResults || {}), ...phaseApiResults } }
            };
        } catch (error) {
            logger.error(`[ScheduledIntegration:Batch3Phase] Failed for user ${userId}:`, error);
            return { success: false, error: error.message, statusCode: 500 };
        }
    }

    /**
     * Phase: FINANCE (new, post-split)
     *
     * Isolated execution of `syncFinanceData` ONLY. This phase polls Amazon for
     * 10-25 minutes (Sales Report + Finance API). Isolating it means the worker
     * slot it pins doesn't block any other batch services — batch 3 has already
     * released its slot, and batch 4 (keywords) gets its own slot from a different
     * worker via the next BullMQ job hop.
     *
     * If Finance Sync fails, the pipeline still advances to `sched_batch_4`
     * (worker.js never fails the pipeline on a single phase failure).
     */
    static async executeScheduledFinancePhase(userId, Region, Country, phaseData = {}) {
        logger.info(`[ScheduledIntegration:FinancePhase] Starting for user ${userId}, ${Country}-${Region}`);
        try {
            const ctx = await this._prepareForBatchPhase(userId, Region, Country, phaseData);
            const dayOfWeek = phaseData.dayOfWeek !== undefined ? phaseData.dayOfWeek : new Date().getDay();

            const apiData = await this.fetchScheduledApiData({
                ...ctx, marketplaceIds: ctx.marketplaceIds, userId, Country, Region,
                productData: { asinArray: ctx.productArrays.asinArray, skuArray: ctx.productArrays.skuArray, ProductDetails: [] },
                dataToSend: ctx.dataToSend, loggingHelper: null, dayOfWeek,
                _batchFilter: ['finance']
            });

            const phaseApiResults = {};
            for (const [key, value] of Object.entries(apiData)) {
                if (value && typeof value === 'object' && !Array.isArray(value) && 'success' in value) {
                    phaseApiResults[key] = { success: value.success, error: value.error || null };
                }
            }

            // DashboardSlice write (additive, non-fatal). The finance slice also records
            // the synced date range so finalize can show data-freshness on the dashboard.
            const financeRaw = apiData?.financeSync || null;
            const financeSummary = (financeRaw && financeRaw.success && financeRaw.data) ? {
                status: financeRaw.data.status || null,
                startDate: financeRaw.data.startDate || null,
                endDate: financeRaw.data.endDate || null
            } : null;
            await this._writePhaseSlices(
                'sched_finance',
                [SLICE_KEYS.FINANCE],
                {
                    userId,
                    country: Country,
                    region: Region,
                    // Inject the summary so _buildSlicePayload uses it via the financeSync entry
                    apiData
                }
            );
            // Augment the finance slice with the synced date range (cheap second write).
            if (financeSummary) {
                await dashboardSliceService.writeSlice({
                    userId,
                    country: Country,
                    region: Region,
                    sliceKey: SLICE_KEYS.FINANCE,
                    producedByPhase: 'sched_finance',
                    data: {
                        services: { financeSync: { success: true, error: null } },
                        counts: { ran: 1, succeeded: 1, failed: 0 },
                        errors: [],
                        sync: financeSummary,
                        producedAt: new Date().toISOString()
                    }
                });
            }

            // Honest phase status: success iff syncFinanceData returned success.
            // Finalize uses this to decide whether to stamp lastDailyUpdate (A.3).
            const financeSucceeded = !!(apiData?.financeSync?.success);
            const financeError = financeSucceeded ? null : (apiData?.financeSync?.error || 'Finance sync did not return success');

            logger.info(`[ScheduledIntegration:FinancePhase] Completed for user ${userId}`, {
                servicesRun: Object.keys(phaseApiResults).length,
                financeSucceeded,
                syncStatus: financeSummary?.status || null
            });
            return {
                success: financeSucceeded,
                error: financeError,
                dataForNextPhase: { apiResults: { ...(phaseData.apiResults || {}), ...phaseApiResults } }
            };
        } catch (error) {
            logger.error(`[ScheduledIntegration:FinancePhase] Failed for user ${userId}:`, error);
            return { success: false, error: error.message, statusCode: 500 };
        }
    }

    /**
     * Phase: BATCH_4 (new, post-split)
     *
     * Runs negativeKeywords, searchKeywords, keywordRecommendations.
     * In the legacy combined batch_3_4 these waited behind Finance Sync polling
     * for 10-25 min for no reason; now they start as soon as Batch 3 finishes
     * (worker slot freed) regardless of Finance phase state.
     */
    static async executeScheduledBatch4Phase(userId, Region, Country, phaseData = {}) {
        logger.info(`[ScheduledIntegration:Batch4Phase] Starting for user ${userId}, ${Country}-${Region}`);
        try {
            const ctx = await this._prepareForBatchPhase(userId, Region, Country, phaseData);
            const dayOfWeek = phaseData.dayOfWeek !== undefined ? phaseData.dayOfWeek : new Date().getDay();

            const apiData = await this.fetchScheduledApiData({
                ...ctx, marketplaceIds: ctx.marketplaceIds, userId, Country, Region,
                productData: { asinArray: ctx.productArrays.asinArray, skuArray: ctx.productArrays.skuArray, ProductDetails: [] },
                dataToSend: ctx.dataToSend, loggingHelper: null, dayOfWeek,
                _batchFilter: [4]
            });

            const phaseApiResults = {};
            for (const [key, value] of Object.entries(apiData)) {
                if (value && typeof value === 'object' && !Array.isArray(value) && 'success' in value) {
                    phaseApiResults[key] = { success: value.success, error: value.error || null };
                }
            }

            // DashboardSlice write (additive, non-fatal): "keywords" slice (neg/search/recs).
            await this._writePhaseSlices(
                'sched_batch_4',
                [SLICE_KEYS.KEYWORDS],
                { userId, country: Country, region: Region, apiData }
            );

            logger.info(`[ScheduledIntegration:Batch4Phase] Completed for user ${userId}`, { servicesRun: Object.keys(phaseApiResults).length });
            return {
                success: true,
                dataForNextPhase: { apiResults: { ...(phaseData.apiResults || {}), ...phaseApiResults } }
            };
        } catch (error) {
            logger.error(`[ScheduledIntegration:Batch4Phase] Failed for user ${userId}:`, error);
            return { success: false, error: error.message, statusCode: 500 };
        }
    }

    /**
     * Phase 4: CALC_REVIEW
     * Runs original batches 5, 6, 7 (calculations, review ingestion, review sender).
     * Also processes inactive listing items.
     */
    static async executeScheduledCalcReviewPhase(userId, Region, Country, phaseData = {}) {
        logger.info(`[ScheduledIntegration:CalcReviewPhase] Starting for user ${userId}, ${Country}-${Region}`);
        try {
            const ctx = await this._prepareForBatchPhase(userId, Region, Country, phaseData);
            const dayOfWeek = phaseData.dayOfWeek !== undefined ? phaseData.dayOfWeek : new Date().getDay();

            const apiData = await this.fetchScheduledApiData({
                ...ctx, marketplaceIds: ctx.marketplaceIds, userId, Country, Region,
                productData: { asinArray: ctx.productArrays.asinArray, skuArray: ctx.productArrays.skuArray, ProductDetails: [] },
                dataToSend: ctx.dataToSend, loggingHelper: null, dayOfWeek,
                _batchFilter: [5, 6, 7]
            });

            // Process inactive listing items (fetched from DB, not phaseData)
            const inactiveSkuArray = ctx.productArrays.inactiveSkuArray;
            const inactiveAsinArray = ctx.productArrays.inactiveAsinArray;
            if (inactiveSkuArray.length > 0) {
                logger.info('[ScheduledIntegration:CalcReviewPhase] Processing inactive SKUs', { count: inactiveSkuArray.length });
                await this.processInactiveListingItems(
                    ctx.AccessToken, inactiveSkuArray, inactiveAsinArray,
                    ctx.dataToSend, userId, ctx.Base_URI, Country, Region,
                    ctx.RefreshToken, ctx.AdsRefreshToken, null
                );
            }

            const phaseApiResults = {};
            for (const [key, value] of Object.entries(apiData)) {
                if (value && typeof value === 'object' && !Array.isArray(value) && 'success' in value) {
                    phaseApiResults[key] = { success: value.success, error: value.error || null };
                }
            }

            // DashboardSlice write (additive, non-fatal): "issues" slice rolls up the
            // calculator outputs (issue summary, productIssues, issuesData) + review
            // ingestion/sender. This is the last per-phase slice before finalize.
            await this._writePhaseSlices(
                'sched_calc_review',
                [SLICE_KEYS.ISSUES],
                { userId, country: Country, region: Region, apiData }
            );

            logger.info(`[ScheduledIntegration:CalcReviewPhase] Completed for user ${userId}`, { servicesRun: Object.keys(phaseApiResults).length });
            return {
                success: true,
                dataForNextPhase: { apiResults: { ...(phaseData.apiResults || {}), ...phaseApiResults } }
            };
        } catch (error) {
            logger.error(`[ScheduledIntegration:CalcReviewPhase] Failed for user ${userId}:`, error);
            return { success: false, error: error.message, statusCode: 500 };
        }
    }

    /**
     * Phase 7: FINALIZE
     *
     * Two execution modes, controlled by env flag `USE_SLICE_ASSEMBLER`:
     *
     *   1. **Slice-assembler mode** (when `USE_SLICE_ASSEMBLER=true` AND slices
     *      meet `SLICE_MIN_FOR_ASSEMBLY`):
     *      - Read all DashboardSlice docs in a single Mongo query
     *      - Merge them into a dashboard object
     *      - Compute lightweight cross-slice metrics (health %, service totals)
     *      - Cache the merged dashboard at the standard `analyse_data:...` key
     *      - Write account history from slice rollups
     *      - SKIPS `Analyse()` — this is the "lightweight finalize" target
     *
     *   2. **Legacy mode** (default, or when slices are insufficient or assembler
     *      throws / returns failure):
     *      - Runs `Analyse()` as before, calls `analyseData()`, caches result,
     *      - Writes account history from Analyse output
     *      - Identical behaviour to pre-V2 finalize — guaranteed dashboard parity
     *
     * Rollout note: ship with `USE_SLICE_ASSEMBLER=false` (default). Verify
     * `db.dashboardslices.countDocuments()` grows per phase tick for ~24h. Once
     * slice payloads have been enriched to match the React dashboard contract,
     * flip the flag per environment. Slice assembler failures auto-fallback to
     * legacy, so an unexpected slice gap can't break finalize.
     */
    static async executeScheduledFinalizePhase(userId, Region, Country, phaseData = {}) {
        logger.info(`[ScheduledIntegration:FinalizePhase] Starting for user ${userId}, ${Country}-${Region}`);

        const trackingEntryId = phaseData.trackingEntryId;
        const apiResults = phaseData.apiResults || {};

        try {
            // Build a summary from accumulated apiResults across all phases (used by both modes)
            const successful = [];
            const failed = [];
            for (const [key, result] of Object.entries(apiResults)) {
                if (result.success) { successful.push(key); }
                else { failed.push({ service: key, error: result.error || 'Unknown error' }); }
            }
            const totalServices = successful.length + failed.length;
            const overallSuccess = successful.length > 0;
            const successPercentage = totalServices > 0 ? Math.round((successful.length / totalServices) * 100) : 0;

            logger.info(`[ScheduledIntegration:FinalizePhase] Service summary`, {
                totalServices, successful: successful.length, failed: failed.length, successPercentage: `${successPercentage}%`
            });

            // Complete DataFetchTracking (mode-agnostic — same in both paths)
            if (trackingEntryId) {
                try {
                    if (failed.length === 0 && successful.length > 0) {
                        await DataFetchTrackingService.completeTracking(trackingEntryId);
                    } else if (failed.length > 0 && successful.length > 0) {
                        const DataFetchTracking = require('../../models/system/DataFetchTrackingModel');
                        const entry = await DataFetchTracking.findById(trackingEntryId);
                        if (entry) { entry.status = 'partial'; entry.errorMessage = `Partial: ${failed.length}/${totalServices} failed`; await entry.save(); }
                    } else {
                        await DataFetchTrackingService.failTracking(trackingEntryId, 'All services failed');
                    }
                } catch (te) { logger.warn('[ScheduledIntegration:FinalizePhase] Tracking completion error', { error: te.message }); }
            }

            if (overallSuccess) {
                await this.handleSuccess(userId, Country, Region);
            }

            // ============== Mode selection ==============
            const useAssembler = process.env.USE_SLICE_ASSEMBLER === 'true';
            let assemblerMode = 'legacy';
            let assemblerSummary = null;

            if (useAssembler) {
                try {
                    const sliceCheck = await dashboardSliceService.hasMinimumSlices(userId, Country, Region);
                    logger.info('[ScheduledIntegration:FinalizePhase] Slice readiness check', {
                        sliceCount: sliceCheck.count,
                        threshold: dashboardSliceService.SLICE_MIN_FOR_ASSEMBLY,
                        ready: sliceCheck.ready,
                        sliceKeys: sliceCheck.sliceKeys
                    });
                    if (sliceCheck.ready) {
                        const sliced = await this._finalizeFromSlices(userId, Country, Region, sliceCheck);
                        if (sliced && sliced.success) {
                            assemblerMode = 'sliced';
                            assemblerSummary = sliced;
                        } else {
                            logger.warn('[ScheduledIntegration:FinalizePhase] Slice assembler returned non-success; falling back to Analyse()');
                        }
                    }
                } catch (assemblerError) {
                    logger.error('[ScheduledIntegration:FinalizePhase] Slice assembler threw; falling back to Analyse()', {
                        error: assemblerError?.message,
                        stack: assemblerError?.stack
                    });
                }
            }

            // ============== Legacy mode (Analyse-based) ==============
            // Runs when the flag is off, slices are insufficient, or assembler failed.
            if (assemblerMode !== 'sliced') {
            // Run Analyse once (used for both account history and Redis cache)
            const { AnalyseService } = require('../main/Analyse.js');
            const analysisResult = await AnalyseService.Analyse(userId, Country, Region);
            if (analysisResult.status !== 200) {
                logger.warn(`[ScheduledIntegration:FinalizePhase] Analysis returned non-200`, { status: analysisResult.status, userId });
            }

            // Add account history using the already-computed analysis data
            try {
                const { addAccountHistory } = require('../History/addAccountHistory.js');
                const { analyseData } = require('../Calculations/DashboardCalculation.js');
                if (analysisResult.status === 200 && analysisResult.message) {
                    const calcResult = await analyseData(analysisResult.message, userId);
                    if (calcResult?.dashboardData) {
                        const dd = calcResult.dashboardData;
                        const totalIssues = (dd.TotalRankingerrors || 0) + (dd.totalErrorInConversion || 0) +
                            (dd.totalErrorInAccount || 0) + (dd.totalProfitabilityErrors || 0) +
                            (dd.totalSponsoredAdsErrors || 0) + (dd.totalInventoryErrors || 0);
                        const healthScore = analysisResult.message.AccountData?.getAccountHealthPercentge?.Percentage || 0;
                        await addAccountHistory(userId, Country, Region, healthScore,
                            dd.TotalProduct?.length || 0, dd.productWiseError?.length || 0, totalIssues);
                    }
                }
            } catch (historyError) {
                logger.error('[ScheduledIntegration:FinalizePhase] Account history error', { error: historyError.message, userId });
            }

            // Update Redis cache with analysis result
            const { getRedisClient } = require('../../config/redisConn.js');
            try {
                const redisClient = getRedisClient();
                const cacheKey = `analyse_data:${userId}:${Country}:${Region}:null`;
                await redisClient.setEx(cacheKey, 3600, JSON.stringify(analysisResult.message));
                logger.info(`[ScheduledIntegration:FinalizePhase] Updated Redis cache for ${cacheKey}`);
            } catch (cacheError) {
                logger.error('[ScheduledIntegration:FinalizePhase] Cache update error', { error: cacheError.message });
                }
            }

            // Mark daily update complete — but ONLY when the critical data
            // phases (finance + at least one ads service) actually returned
            // data. If they didn't, leave lastDailyUpdate untouched so the
            // hourly cron tick will retry this account on the next run.
            //
            // Without this gate, a phase that failed to produce data would
            // still flip lastDailyUpdate to "today", and `getUsersNeedingDailyUpdate`
            // would skip the account for the rest of the day — the exact
            // silent-skip behaviour that caused May 22's data hole.
            const { UserSchedulingService } = require('../BackgroundJobs/UserSchedulingService.js');
            const financeOk = !!(apiResults?.financeSync?.success);
            const adsServiceKeys = ['ppcSpendsBySKU', 'adsKeywordsPerformanceData', 'ppcSpendsDateWise', 'ppcMetricsAggregated'];
            const anyAdsOk = adsServiceKeys.some(k => apiResults?.[k]?.success === true);
            const adsRan = adsServiceKeys.some(k => apiResults?.[k] && typeof apiResults[k] === 'object' && 'success' in apiResults[k]);
            // Treat ads as "ok" when no ads service ran at all (e.g. user has no
            // ads connection) — we only block on ads failures that actually
            // surfaced from an attempted fetch.
            const adsOk = !adsRan || anyAdsOk;
            const canMarkComplete = financeOk && adsOk;

            if (canMarkComplete) {
                await UserSchedulingService.markDailyUpdateComplete(userId, Country, Region);
                logger.info(`[ScheduledIntegration:FinalizePhase] Marked daily update complete for ${userId} ${Country}-${Region}`);
            } else {
                logger.warn(`[ScheduledIntegration:FinalizePhase] Skipping markDailyUpdateComplete — finance/ads did not return data; next cron tick will retry.`, {
                    userId, country: Country, region: Region, financeOk, anyAdsOk, adsRan
                });
            }

            // End logging session
            if (phaseData.sessionId) {
                try {
                    const LoggingHelperClass = require('../../utils/LoggingHelper.js');
                    await LoggingHelperClass.endSessionById(phaseData.sessionId, 'completed');
                } catch (le) { logger.warn('[ScheduledIntegration:FinalizePhase] Session end error', { error: le.message }); }
            }

            logger.info(`[ScheduledIntegration:FinalizePhase] Completed for user ${userId}, ${Country}-${Region}`, { mode: assemblerMode });
            return {
                success: true,
                summary: {
                    overallSuccess,
                    successPercentage,
                    totalServices,
                    successful: successful.length,
                    failed: failed.length,
                    finalizeMode: assemblerMode,
                    assembler: assemblerSummary
                }
            };
        } catch (error) {
            logger.error(`[ScheduledIntegration:FinalizePhase] Failed for user ${userId}:`, error);
            if (trackingEntryId) {
                try { await DataFetchTrackingService.failTracking(trackingEntryId, error.message); } catch (_) {}
            }
            if (phaseData.sessionId) {
                try { const LH = require('../../utils/LoggingHelper.js'); await LH.endSessionById(phaseData.sessionId, 'failed'); } catch (_) {}
            }
            return { success: false, error: error.message, statusCode: 500 };
        }
    }

    /**
     * Finalize implementation that reads DashboardSlice docs and merges them
     * into a dashboard payload WITHOUT calling Analyse().
     *
     * This is gated behind `USE_SLICE_ASSEMBLER=true` in the parent method.
     * Returns `{ success: false }` on any internal error so the parent can
     * fall back to the legacy Analyse() path.
     */
    static async _finalizeFromSlices(userId, country, region, sliceCheck) {
        logger.info('[ScheduledIntegration:FinalizePhase:Sliced] Assembling dashboard from slices', {
            userId, country, region, sliceCount: sliceCheck.count
        });

        const slices = await dashboardSliceService.readAllSlices(userId, country, region);
        if (!slices || Object.keys(slices).length === 0) {
            logger.warn('[ScheduledIntegration:FinalizePhase:Sliced] readAllSlices returned empty — falling back');
            return { success: false, reason: 'no_slices' };
        }

        // Merge: dashboard is a map of sliceKey → slice.data
        const dashboard = { ...slices };

        // Lightweight cross-slice metrics
        let totalServicesRun = 0;
        let totalServicesFailed = 0;
        const allErrors = [];
        for (const slice of Object.values(slices)) {
            if (!slice || typeof slice !== 'object') continue;
            if (slice.counts) {
                totalServicesRun += (slice.counts.ran || 0);
                totalServicesFailed += (slice.counts.failed || 0);
            }
            if (Array.isArray(slice.errors)) {
                allErrors.push(...slice.errors);
            }
        }
        const healthPercentage = totalServicesRun > 0
            ? Math.round(((totalServicesRun - totalServicesFailed) / totalServicesRun) * 100)
            : 0;

        const listings = slices.listings || {};
        const totalProducts = (listings.activeProductCount || 0) + (listings.inactiveProductCount || 0);

        dashboard._slicedMeta = {
            sliceCount: sliceCheck.count,
            sliceKeys: sliceCheck.sliceKeys,
            totalServicesRun,
            totalServicesFailed,
            healthPercentage,
            assembledAt: new Date().toISOString(),
            assemblerVersion: 1
        };

        // Write to the canonical Redis cache key so dashboard reads pick it up.
        // (If the slice contract isn't yet rich enough for the React app, set
        //  USE_SLICE_ASSEMBLER=false — the legacy Analyse path will resume.)
        try {
            const { getRedisClient } = require('../../config/redisConn.js');
            const redisClient = getRedisClient();
            const cacheKey = `analyse_data:${userId}:${country}:${region}:null`;
            await redisClient.setEx(cacheKey, 3600, JSON.stringify(dashboard));
            logger.info(`[ScheduledIntegration:FinalizePhase:Sliced] Wrote sliced dashboard to ${cacheKey}`);
        } catch (cacheError) {
            logger.error('[ScheduledIntegration:FinalizePhase:Sliced] Cache write failed', { error: cacheError?.message });
            return { success: false, reason: 'cache_write_failed' };
        }

        // Account history from slice rollups (lightweight)
        try {
            const { addAccountHistory } = require('../History/addAccountHistory.js');
            const issuesSlice = slices.issues || {};
            const productsWithErrors = (issuesSlice.counts && issuesSlice.counts.failed) || 0;
            await addAccountHistory(
                userId, country, region,
                healthPercentage, totalProducts, productsWithErrors, totalServicesFailed
            );
        } catch (historyError) {
            logger.error('[ScheduledIntegration:FinalizePhase:Sliced] Account history error', { error: historyError?.message });
            // History failure is non-fatal — sliced dashboard already cached.
        }

        return {
            success: true,
            mode: 'sliced',
            healthPercentage,
            totalProducts,
            totalServicesRun,
            totalServicesFailed,
            sliceCount: sliceCheck.count
        };
    }
}

module.exports = { ScheduledIntegration };


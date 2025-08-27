const limit = require('promise-limit')(3); // Limit to 3 concurrent promises
const { ApiError } = require('../utils/ApiError.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const asyncHandler = require('../utils/AsyncHandler.js');
const { generateAccessToken } = require('../Services/Sp_API/GenerateTokens.js');
const getTemporaryCredentials = require('../utils/GenerateTemporaryCredentials.js');
const logger = require('../utils/Logger.js');
const Seller = require('../models/sellerCentralModel.js')
const { URIs, marketplaceConfig, spapiRegions } = require('./config/config.js')
const tokenManager = require('../utils/TokenManager.js');
const { sendAnalysisReadyEmail } = require('../Services/Email/SendAnalysisReadyEmail.js');
const { getUserById } = require('../Services/User/userServices.js');
const LoggingHelper = require('../utils/LoggingHelper.js');

const ListingItemsModel = require('../models/GetListingItemsModel.js');

// RESTORED - ALL SP-API FUNCTIONS
const GET_MERCHANT_LISTINGS_ALL_DATA = require('../Services/Sp_API/GET_MERCHANT_LISTINGS_ALL_DATA.js');
const GET_V2_SELLER_PERFORMANCE_REPORT = require('../Services/Sp_API/V2_Seller_Performance_Report.js');
const GET_V1_SELLER_PERFORMANCE_REPORT = require('../Services/Sp_API/GET_V1_SELLER_PERFORMANCE_REPORT.js');
const { listFinancialEventsMethod } = require('../Services/Sp_API/Finance.js');
const { getCompetitivePricing } = require('../Services/Sp_API/CompetitivePrices.js');
const GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT = require('../Services/Sp_API/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT.js');
const { addReviewDataTODatabase } = require('../Services/Sp_API/NumberOfProductReviews.js');
const { GetListingItem } = require('../Services/Sp_API/GetListingItemsIssues.js');
const TotalSales = require('../Services/Sp_API/WeeklySales.js');
const getshipment = require('../Services/Sp_API/shipment.js');
const CompetitivePricing = require('../models/CompetitivePricingModel.js');

// KEYWORDS-RELATED IMPORTS - ENHANCED AND ACTIVE
const { generateAdsAccessToken } = require('../Services/AmazonAds/GenerateToken.js');
const { getPPCSpendsBySKU } = require('../Services/AmazonAds/GetPPCProductWise.js');
const { getKeywords } = require('../Services/AmazonAds/Keywords.js');
const { getNegativeKeywords } = require('../Services/AmazonAds/NegetiveKeywords.js');
const { getSearchKeywords } = require('../Services/AmazonAds/GetSearchKeywords.js');
const { getCampaign } = require('../Services/AmazonAds/GetCampaigns.js');
const ProductWiseSponsoredAdsData = require('../models/ProductWiseSponseredAdsModel.js');
const { getKeywordPerformanceReport } = require('../Services/AmazonAds/GetWastedSpendKeywords.js');
const { getPPCSpendsDateWise } = require('../Services/AmazonAds/GetDateWiseSpendKeywords.js');
const { getAdGroups } = require('../Services/AmazonAds/AdGroups.js');
const { getProfileById } = require('../Services/AmazonAds/GenerateProfileId.js');

// RESTORED - ALL OTHER FUNCTIONS
const { getBrand } = require('../Services/Sp_API/GetBrand.js');
const GET_FBA_INVENTORY_PLANNING_DATA = require('../Services/Sp_API/GET_FBA_INVENTORY_PLANNING_DATA.js');
const GET_STRANDED_INVENTORY_UI_DATA = require('../Services/Sp_API/GET_STRANDED_INVENTORY_UI_DATA.js');
const GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA = require('../Services/Sp_API/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA.js');
const getAmazonFees = require('../Services/Finance/AmazonFees.js');
const { addAccountHistory } = require('../Services/History/addAccountHistory.js');
const {Analyse} = require('./AnalysingController.js');
const axios = require('axios');
const userModel = require('../models/userModel.js');


const addNewAccountHistory = async (userId, country, region) => {
    if (!userId || !country || !region) {
        throw new Error('User id, country and region are required')
    }

    const getAnalyseData = await Analyse(userId, country, region)

    if (getAnalyseData.status !== 200) {
        throw new Error('Failed to get analyse data')
    }

    const getCalculationData = await axios.post(`http://localhost:8080/calculation-api/calculate`,
        getAnalyseData.message
    );

    if (!getCalculationData || !getCalculationData.data || !getCalculationData.data.data || !getCalculationData.data.data.dashboardData) {
        throw new Error('Failed to get calculation data')
    }



    const rankingErrors = getCalculationData.data.data.dashboardData.TotalRankingerrors || 0;
    const conversionErrors = getCalculationData.data.data.dashboardData.totalErrorInConversion || 0;
    const accountErrors = getCalculationData.data.data.dashboardData.totalErrorInAccount || 0;
    const profitabilityErrors = getCalculationData.data.data.dashboardData.totalProfitabilityErrors || 0;
    const sponsoredAdsErrors = getCalculationData.data.data.dashboardData.totalSponsoredAdsErrors || 0;
    const inventoryErrors = getCalculationData.data.data.dashboardData.totalInventoryErrors || 0;

    const totalIssues = rankingErrors + conversionErrors + accountErrors + profitabilityErrors + sponsoredAdsErrors + inventoryErrors;

    const healthScore = getAnalyseData.AccountData?.getAccountHealthPercentge?.Percentage || 0;

   // const totalActiveProducts = getCalculationData.data.data.ActiveProducts.length;

   // const numberOfProductsWithIssues = getCalculationData.data.data.dashboardData.productWiseError.length;

    const addAccountHistoryData = await addAccountHistory(userId,country,region,healthScore,"69","29",totalIssues);

    if(!addAccountHistoryData){
        throw new Error('Failed to add account history')
    }

    return addAccountHistoryData;

}






const getSpApiData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    // ===== INITIALIZE LOGGING SESSION =====
    let loggingHelper = null;
    try {
        loggingHelper = new LoggingHelper(userId, Region, Country);
        await loggingHelper.initSession();
        loggingHelper.logFunctionStart('getSpApiData', {
            userId: userId,
            region: Region,
            country: Country,
            requestOrigin: req.headers.origin || 'unknown'
        });
    } catch (loggingError) {
        logger.warn('Failed to initialize logging session', { error: loggingError.message, userId });
        // Continue without logging rather than failing the entire request
    }

    try {

        // ===== COMPREHENSIVE INPUT VALIDATION =====
        if (!userId) {
            logger.error("User ID is missing from request");
            if (loggingHelper) {
                loggingHelper.logFunctionError('validation', new Error("User ID is missing from request"));
            }
            return res.status(400).json(new ApiError(400, "User id is missing"));
        }

        if (!Region || !Country) {
            logger.error("Region and country are missing from request", { Region, Country });
            if (loggingHelper) {
                loggingHelper.logFunctionError('validation', new Error("Region and country are required"));
            }
            return res.status(400).json(new ApiError(400, "Region and country are required"));
        }

        // Validate region format
        const validRegions = ["NA", "EU", "FE"];
        if (!validRegions.includes(Region)) {
            logger.error("Invalid region provided", { Region, validRegions });
            if (loggingHelper) {
                loggingHelper.logFunctionError('validation', new Error(`Invalid region: ${Region}`));
            }
            return res.status(400).json(new ApiError(400, `Invalid region. Must be one of: ${validRegions.join(', ')}`));
        }

        // ===== CONFIGURATION VALIDATION =====
        // Validate configuration objects exist and are properly loaded
        if (!URIs || typeof URIs !== 'object') {
            logger.error("URIs configuration object is not properly loaded");
            return res.status(500).json(new ApiError(500, "Server configuration error - URIs not available"));
        }

        if (!marketplaceConfig || typeof marketplaceConfig !== 'object') {
            logger.error("marketplaceConfig object is not properly loaded");
            return res.status(500).json(new ApiError(500, "Server configuration error - marketplace config not available"));
        }

        if (!spapiRegions || typeof spapiRegions !== 'object') {
            logger.error("spapiRegions configuration object is not properly loaded");
            return res.status(500).json(new ApiError(500, "Server configuration error - SP-API regions not available"));
        }

        // ===== SAFE CONFIGURATION ACCESS =====
        console.log("🔍 Debug - Country being processed:", Country);
        console.log("🔍 Debug - Available countries in config:", Object.keys(marketplaceConfig));

        const Base_URI = URIs[Region];
        // Try direct match first, then case-insensitive match
        let Marketplace_Id = marketplaceConfig[Country];
        console.log("Marketplace_Id: ", Marketplace_Id);
        if (!Marketplace_Id && Country) {
            // Try uppercase version
            const upperCountry = Country.toUpperCase();
            Marketplace_Id = marketplaceConfig[upperCountry];
            if (Marketplace_Id) {
                console.log(`🔧 Debug - Found marketplace ID using uppercase: ${Country} -> ${upperCountry}`);
            } else {
                // Try to find case-insensitive match
                const foundKey = Object.keys(marketplaceConfig).find(key =>
                    key.toLowerCase() === Country.toLowerCase()
                );
                if (foundKey) {
                    Marketplace_Id = marketplaceConfig[foundKey];
                    console.log(`🔧 Debug - Found marketplace ID using case-insensitive match: ${Country} -> ${foundKey}`);
                }
            }
        }

        const regionConfig = spapiRegions[Region];

        console.log("🔍 Debug - Resolved values:", {
            Region,
            Country,
            Base_URI,
            Marketplace_Id,
            regionConfig: regionConfig ? "found" : "not found"
        });

        if (!Base_URI) {
            logger.error("Invalid region configuration - no URI found", { Region, availableRegions: Object.keys(URIs) });
            return res.status(400).json(new ApiError(400, `Unsupported region: ${Region}. Available regions: ${Object.keys(URIs).join(', ')}`));
        }

        if (!Marketplace_Id) {
            logger.error("Invalid country configuration - no marketplace ID found", {
                Country,
                availableCountries: Object.keys(marketplaceConfig),
                countryType: typeof Country,
                countryLength: Country ? Country.length : 0,
                trimmedCountry: Country ? Country.trim() : 'null'
            });
            return res.status(400).json(new ApiError(400, `Unsupported country: ${Country}. Available countries: ${Object.keys(marketplaceConfig).join(', ')}`));
        }

        if (!regionConfig) {
            logger.error("Invalid region configuration for credentials", { Region, availableRegions: Object.keys(spapiRegions) });
            return res.status(400).json(new ApiError(400, `No credential configuration for region: ${Region}`));
        }

        // ===== ADDITIONAL MARKETPLACE ID VALIDATION =====
        // Validate marketplace ID format (Amazon marketplace IDs are typically 14 characters)
        if (typeof Marketplace_Id !== 'string' || Marketplace_Id.length < 10) {
            logger.error("Invalid marketplace ID format", {
                Marketplace_Id,
                Country,
                marketplaceIdType: typeof Marketplace_Id,
                marketplaceIdLength: Marketplace_Id ? Marketplace_Id.length : 0
            });
            return res.status(500).json(new ApiError(500, "Invalid marketplace ID configuration"));
        }

        // Create validated marketplace array for API calls
        const marketplaceIds = [Marketplace_Id];

        // ===== VALIDATE MARKETPLACE IDS ARRAY =====
        if (!Array.isArray(marketplaceIds) || marketplaceIds.length === 0) {
            logger.error("Marketplace IDs array is empty or invalid", { marketplaceIds, Marketplace_Id });
            return res.status(500).json(new ApiError(500, "Invalid marketplace IDs configuration"));
        }

        // Check for undefined/null values in the array
        const invalidIds = marketplaceIds.filter(id => !id || typeof id !== 'string');
        if (invalidIds.length > 0) {
            logger.error("Invalid marketplace IDs found in array", { marketplaceIds, invalidIds });
            return res.status(500).json(new ApiError(500, "Invalid marketplace IDs in array"));
        }

        console.log("✅ Input validation passed", {
            userId,
            Region,
            Country,
            Base_URI,
            Marketplace_Id,
            marketplaceIds,
            marketplaceIdsLength: marketplaceIds.length
        });

        // ===== DATABASE CONNECTION VALIDATION =====
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState !== 1) {
            logger.error("Database connection not available", { readyState: mongoose.connection.readyState });
            return res.status(500).json(new ApiError(500, "Database connection unavailable"));
        }

        //Getting all the required credentials
        let getSellerData;
        try {
            getSellerData = await Seller.findOne({ User: userId });
        } catch (dbError) {
            logger.error("Database error while fetching seller data", { error: dbError.message, userId });
            return res.status(500).json(new ApiError(500, "Database error while fetching seller data"));
        }

        if (!getSellerData) {
            logger.error("No seller data found for user", { userId });
            return res.status(404).json(new ApiError(404, "No seller account found for this user"));
        }

        // Safer access to configuration objects
        const sellerAccounts = Array.isArray(getSellerData.sellerAccount) ? getSellerData.sellerAccount : [];
        const getSellerAccount = sellerAccounts.find(item => item && item.country === Country && item.region === Region);

        if (!getSellerAccount) {
            logger.error("No seller account found for the specified region and country", { userId, Region, Country, availableAccounts: sellerAccounts.length });
            return res.status(400).json(new ApiError(400, `No seller account found for region ${Region} and country ${Country}`));
        }

        const RefreshToken = getSellerAccount.spiRefreshToken;
        const AdsRefreshToken = getSellerAccount.adsRefreshToken;

        // ===== TOKEN VALIDATION =====
        // Check if at least one refresh token is available
        if (!RefreshToken && !AdsRefreshToken) {
            logger.error("Both SP-API and Amazon Ads refresh tokens are missing", { userId, Region, Country });
            return res.status(400).json(new ApiError(400, "Both SP-API and Amazon Ads refresh tokens are missing. At least one is required for analysis."));
        }

        if (!RefreshToken) {
            logger.warn("SP-API refresh token is missing - SP-API functions will be skipped", { userId, Region, Country });
        }

        if (!AdsRefreshToken) {
            logger.warn("Amazon Ads refresh token is missing - Ads functions will be skipped", { userId, Region, Country });
        }

        // ===== AWS CREDENTIALS GENERATION WITH VALIDATION =====
        let credentials;
        if (loggingHelper) {
            loggingHelper.logFunctionStart('generateTemporaryCredentials', { region: Region });
        }
        try {
            credentials = await getTemporaryCredentials(regionConfig);

            // Validate credentials structure
            if (!credentials || typeof credentials !== 'object') {
                throw new Error("Invalid credentials object returned");
            }

            const requiredFields = ['AccessKey', 'SecretKey', 'SessionToken'];
            const missingFields = requiredFields.filter(field => !credentials[field]);

            if (missingFields.length > 0) {
                throw new Error(`Missing required credential fields: ${missingFields.join(', ')}`);
            }

            console.log("✅ AWS credentials generated successfully");
            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('generateTemporaryCredentials', null, {
                    recordsProcessed: 1,
                    recordsSuccessful: 1
                });
            }
        } catch (credError) {
            logger.error("Failed to generate AWS temporary credentials", {
                error: credError.message,
                Region,
                regionConfig: regionConfig ? "present" : "missing"
            });
            if (loggingHelper) {
                loggingHelper.logFunctionError('generateTemporaryCredentials', credError);
            }
            return res.status(500).json(new ApiError(500, "Failed to generate AWS credentials"));
        }

        // ===== TOKEN GENERATION WITH PROPER ERROR HANDLING =====
        let AccessToken, AdsAccessToken;
        if (loggingHelper) {
            loggingHelper.logFunctionStart('generateAccessTokens', {
                hasRefreshToken: !!RefreshToken,
                hasAdsRefreshToken: !!AdsRefreshToken
            });
        }
        try {
            console.log("🔄 Generating access tokens...");

            // Generate tokens only for available refresh tokens
            const tokenPromises = [];
            const tokenTypes = [];

            console.log("RefreshToken: ", RefreshToken);

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

            // Handle SP-API token result if refresh token was available
            if (RefreshToken) {
                if (tokenResults[tokenIndex].status === 'rejected') {
                    logger.warn(`SP-API token generation failed: ${tokenResults[tokenIndex].reason}`);
                    AccessToken = null;
                } else {
                    AccessToken = tokenResults[tokenIndex].value;
                    if (!AccessToken) {
                        logger.warn("SP-API token generation returned false/null");
                        AccessToken = null;
                    }
                }
                tokenIndex++;
            } else {
                AccessToken = null;
            }

            // Handle Ads token result if refresh token was available
            if (AdsRefreshToken) {
                if (tokenResults[tokenIndex].status === 'rejected') {
                    logger.warn(`Amazon Ads token generation failed: ${tokenResults[tokenIndex].reason}`);
                    AdsAccessToken = null;
                } else {
                    AdsAccessToken = tokenResults[tokenIndex].value;
                    if (!AdsAccessToken) {
                        logger.warn("Amazon Ads token generation returned false/null");
                        AdsAccessToken = null;
                    }
                }
            } else {
                AdsAccessToken = null;
            }

            // Check if at least one token was generated successfully
            if (!AccessToken && !AdsAccessToken) {
                throw new Error("Failed to generate both SP-API and Amazon Ads access tokens");
            }

            console.log(`✅ Access tokens generated successfully - SP-API: ${!!AccessToken}, Ads: ${!!AdsAccessToken}`);
            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('generateAccessTokens', null, {
                    recordsProcessed: tokenPromises.length,
                    recordsSuccessful: (AccessToken ? 1 : 0) + (AdsAccessToken ? 1 : 0),
                    recordsFailed: tokenPromises.length - ((AccessToken ? 1 : 0) + (AdsAccessToken ? 1 : 0))
                });
            }
        } catch (tokenError) {
            logger.error("Failed to generate any access tokens", {
                error: tokenError.message,
                userId,
                hasRefreshToken: !!RefreshToken,
                hasAdsRefreshToken: !!AdsRefreshToken
            });
            if (loggingHelper) {
                loggingHelper.logFunctionError('generateAccessTokens', tokenError);
            }
            return res.status(500).json(new ApiError(500, `Token generation failed: ${tokenError.message}`));
        }

        // ===== PROFILE ID GENERATION WITH VALIDATION =====
        let ProfileId = getSellerAccount.ProfileId;


        // Initialize tokens in TokenManager for automatic refresh (only available tokens)
        tokenManager.setTokens(userId, AccessToken, AdsAccessToken, RefreshToken, AdsRefreshToken);

        const sellerId = getSellerAccount.selling_partner_id;

        if (!sellerId) {
            logger.error("Seller ID not found in seller data", { userId });
            return res.status(400).json(new ApiError(400, "Seller ID not found"));
        }

        // ===== MERCHANT LISTINGS DATA WITH ERROR HANDLING =====
        let merchantListingsData = null;

        if (AccessToken) {
            if (loggingHelper) {
                loggingHelper.logFunctionStart('GET_MERCHANT_LISTINGS_ALL_DATA', {
                    hasAccessToken: true,
                    marketplaceIds: marketplaceIds
                });
            }
            try {
                merchantListingsData = await tokenManager.wrapSpApiFunction(
                    GET_MERCHANT_LISTINGS_ALL_DATA, userId, RefreshToken, AdsRefreshToken
                )(AccessToken, marketplaceIds, userId, Country, Region, Base_URI);

                if (!merchantListingsData) {
                    throw new Error("Merchant listings API returned null/false");
                }

                console.log("✅ Merchant listings data fetched successfully");
                if (loggingHelper) {
                    const recordCount = merchantListingsData?.sellerAccount?.length || 0;
                    loggingHelper.logFunctionSuccess('GET_MERCHANT_LISTINGS_ALL_DATA', merchantListingsData, {
                        recordsProcessed: recordCount,
                        recordsSuccessful: recordCount
                    });
                }
            } catch (merchantError) {
                logger.error("Failed to fetch merchant listings data", {
                    error: merchantError.message,
                    userId,
                    marketplaceIds
                });
                if (loggingHelper) {
                    loggingHelper.logFunctionError('GET_MERCHANT_LISTINGS_ALL_DATA', merchantError);
                }
                // Don't return error here, continue with null merchantListingsData
                logger.warn("Continuing without merchant listings data due to SP-API error");
                merchantListingsData = null;
            }
        } else {
            console.log("⚠️ Skipping merchant listings - AccessToken not available");
            if (loggingHelper) {
                loggingHelper.logFunctionSkipped('GET_MERCHANT_LISTINGS_ALL_DATA', 'AccessToken not available');
            }
            merchantListingsData = null;
        }

        // HARDCODED FOR KEYWORDS TESTING - REPLACE WITH ACTUAL DATA WHEN NEEDED
        const asinArray = [];
        const skuArray = [];
        const ProductDetails = [];

        // ===== SAFE DATA EXTRACTION WITH VALIDATION =====
        try {
            // Safer access to merchant listings data with detailed validation
            const merchantSellerAccounts = Array.isArray(merchantListingsData.sellerAccount) ? merchantListingsData.sellerAccount : [];

            if (merchantSellerAccounts.length === 0) {
                logger.warn("No seller accounts found in merchant listings data", { userId });
                // Continue with empty arrays rather than failing
            } else {
                const SellerAccount = merchantSellerAccounts.find(item => item && item.country === Country && item.region === Region);

                if (!SellerAccount) {
                    logger.warn("No matching seller account found in merchant listings", {
                        userId,
                        Country,
                        Region,
                        availableAccounts: merchantSellerAccounts.map(acc => ({ country: acc?.country, region: acc?.region }))
                    });
                    // Continue with empty arrays rather than failing
                } else if (!Array.isArray(SellerAccount.products)) {
                    logger.warn("Products array is missing or invalid in seller account", {
                        userId,
                        hasProducts: !!SellerAccount.products,
                        productsType: typeof SellerAccount.products
                    });
                    // Continue with empty arrays rather than failing
                } else {
                    // Filter products and extract ASINs and SKUs safely with validation
                    const activeProducts = SellerAccount.products.filter(product => {
                        // Comprehensive product validation
                        if (!product || typeof product !== 'object') {
                            logger.debug("Invalid product object found", { product });
                            return false;
                        }

                        if (product.status !== "Active") {
                            return false;
                        }

                        if (!product.asin || typeof product.asin !== 'string' || product.asin.trim() === '') {
                            logger.debug("Product missing valid ASIN", { productId: product.id || 'unknown', asin: product.asin });
                            return false;
                        }

                        if (!product.sku || typeof product.sku !== 'string' || product.sku.trim() === '') {
                            logger.debug("Product missing valid SKU", { productId: product.id || 'unknown', sku: product.sku });
                            return false;
                        }

                        return true;
                    });

                    console.log(`✅ Found ${activeProducts.length} valid active products out of ${SellerAccount.products.length} total products`);

                    // Extract data from validated products
                    activeProducts.forEach(product => {
                        asinArray.push(product.asin.trim());
                        skuArray.push(product.sku.trim());

                        // Safe price extraction with fallback
                        let price = product.price;
                        if (typeof price === 'string') {
                            // Remove currency symbols and parse
                            price = parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
                        } else if (typeof price !== 'number' || isNaN(price)) {
                            price = 0;
                        }

                        ProductDetails.push({
                            asin: product.asin.trim(),
                            price: price
                        });
                    });
                }
            }

            // ===== ARRAY CORRESPONDENCE VALIDATION =====
            if (asinArray.length !== skuArray.length) {
                logger.error("CRITICAL: ASIN and SKU arrays have different lengths", {
                    asinCount: asinArray.length,
                    skuCount: skuArray.length,
                    userId
                });
                return res.status(500).json(new ApiError(500, "Data integrity error: ASIN and SKU arrays mismatch"));
            }

            if (asinArray.length !== ProductDetails.length) {
                logger.error("CRITICAL: Product details array length mismatch", {
                    asinCount: asinArray.length,
                    productDetailsCount: ProductDetails.length,
                    userId
                });
                return res.status(500).json(new ApiError(500, "Data integrity error: Product details array mismatch"));
            }

            // ===== MEMORY SAFETY CHECK =====
            const MAX_PRODUCTS = 10000; // Prevent memory exhaustion
            if (asinArray.length > MAX_PRODUCTS) {
                logger.error("Too many products - potential memory exhaustion", {
                    productCount: asinArray.length,
                    maxAllowed: MAX_PRODUCTS,
                    userId
                });
                return res.status(400).json(new ApiError(400, `Too many products (${asinArray.length}). Maximum allowed: ${MAX_PRODUCTS}`));
            }

            console.log(`✅ Data extraction completed safely`, {
                asinCount: asinArray.length,
                skuCount: skuArray.length,
                productDetailsCount: ProductDetails.length
            });

        } catch (extractionError) {
            logger.error("Error during data extraction from merchant listings", {
                error: extractionError.message,
                stack: extractionError.stack,
                userId
            });
            return res.status(500).json(new ApiError(500, `Data extraction failed: ${extractionError.message}`));
        }

        // Calculate dynamic dates
        const now = new Date();
        const before = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours before now
        const after = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000); // 31 days before now

        const dataToSend = {
            before: before.toISOString(), // 24 hours before now
            after: after.toISOString(), // 31 days before now
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

        // ===== VALIDATE dataToSend OBJECT =====
        // Note: AccessToken is now optional since it might not be available
        const requiredDataFields = ['marketplaceId', 'AccessKey', 'SecretKey', 'SessionToken', 'SellerId'];
        const missingDataFields = requiredDataFields.filter(field => !dataToSend[field]);

        // Check for AccessToken separately and log its availability
        if (!dataToSend.AccessToken) {
            console.log("⚠️ AccessToken not available in dataToSend - SP-API functions will be skipped");
        }

        if (missingDataFields.length > 0) {
            logger.error("Missing required fields in dataToSend object", {
                missingFields: missingDataFields,
                dataToSend: {
                    ...dataToSend,
                    AccessToken: dataToSend.AccessToken ? "[REDACTED]" : "missing",
                    AccessKey: dataToSend.AccessKey ? "[REDACTED]" : "missing",
                    SecretKey: dataToSend.SecretKey ? "[REDACTED]" : "missing",
                    SessionToken: dataToSend.SessionToken ? "[REDACTED]" : "missing"
                },
                userId
            });
            return res.status(500).json(new ApiError(500, `Missing required data fields: ${missingDataFields.join(', ')}`));
        }

        console.log("🔍 Debug - dataToSend validation passed:", {
            hasMarketplaceId: !!dataToSend.marketplaceId,
            hasAccessToken: !!dataToSend.AccessToken,
            hasCredentials: !!(dataToSend.AccessKey && dataToSend.SecretKey && dataToSend.SessionToken),
            hasSellerId: !!dataToSend.SellerId,
            asinCount: asinArray.length
        });

        // ===== FIRST BATCH OF API CALLS WITH STRUCTURED ERROR HANDLING =====
        console.log("🔄 Starting first batch of API calls...");
        console.log("🔍 Debug - marketplaceIds being passed:", marketplaceIds);
        console.log("🔍 Debug - dataToSend.marketplaceId:", dataToSend.marketplaceId);
        console.log(`🔍 Debug - Available tokens - SP-API: ${!!AccessToken}, Ads: ${!!AdsAccessToken}`);

        if (loggingHelper) {
            loggingHelper.logFunctionStart('firstBatch_ApiCalls', {
                hasAccessToken: !!AccessToken,
                hasAdsToken: !!AdsAccessToken,
                marketplaceIds: marketplaceIds
            });
        }

        // Create batch arrays based on available tokens
        const firstBatchPromises = [];
        const firstBatchServiceNames = [];

        // SP-API functions (require AccessToken)
        if (AccessToken) {
            firstBatchPromises.push(
                tokenManager.wrapSpApiFunction(
                    GET_V2_SELLER_PERFORMANCE_REPORT, userId, RefreshToken, AdsRefreshToken
                )(AccessToken, marketplaceIds, userId, Base_URI, Country, Region)
            );
            firstBatchServiceNames.push("V2 Seller Performance Report");

            firstBatchPromises.push(
                tokenManager.wrapSpApiFunction(
                    GET_V1_SELLER_PERFORMANCE_REPORT, userId, RefreshToken, AdsRefreshToken
                )(AccessToken, marketplaceIds, userId, Base_URI, Country, Region)
            );
            firstBatchServiceNames.push("V1 Seller Performance Report");
        } else {
            console.log("⚠️ Skipping SP-API functions - AccessToken not available");
        }

        // Ads functions (require AdsAccessToken)
        if (AdsAccessToken) {
            firstBatchPromises.push(
                tokenManager.wrapAdsFunction(
                    getPPCSpendsBySKU, userId, RefreshToken, AdsRefreshToken
                )(AdsAccessToken, ProfileId, userId, Country, Region)
            );
            firstBatchServiceNames.push("PPC Spends by SKU");

            firstBatchPromises.push(
                tokenManager.wrapAdsFunction(
                    getKeywordPerformanceReport, userId, RefreshToken, AdsRefreshToken
                )(AdsAccessToken, ProfileId, userId, Country, Region)
            );
            firstBatchServiceNames.push("Ads Keywords Performance");

            firstBatchPromises.push(
                tokenManager.wrapAdsFunction(
                    getPPCSpendsDateWise, userId, RefreshToken, AdsRefreshToken
                )(AdsAccessToken, ProfileId, userId, Country, Region)
            );
            firstBatchServiceNames.push("PPC Spends Date Wise");
        } else {
            console.log("⚠️ Skipping Ads functions - AdsAccessToken not available");
        }

        const firstBatchResults = await Promise.allSettled(firstBatchPromises);

        // Process results with detailed error tracking
        const processApiResult = (result, serviceName) => {
            if (result.status === 'fulfilled') {
                console.log(`✅ ${serviceName} completed successfully`);
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
                const errorStack = result.reason?.stack || '';
                const isUnauthorizedRelated = (
                    errorMsg.toLowerCase().includes('unauthorized') ||
                    errorMsg.toLowerCase().includes('access denied') ||
                    errorMsg.toLowerCase().includes('access to requested resource is denied') ||
                    errorMsg.toLowerCase().includes('401') ||
                    result.reason?.status === 401 ||
                    result.reason?.statusCode === 401 ||
                    result.reason?.amazonApiError
                );

                // Check for specific marketplace ID errors
                if (errorMsg.includes('marketplaceIds') || errorMsg.includes('InvalidInput')) {
                    logger.error(`❌ ${serviceName} failed - MARKETPLACE ID ERROR`, {
                        error: errorMsg,
                        errorStack,
                        userId,
                        marketplaceIds,
                        Country,
                        Region,
                        fullError: result.reason
                    });
                } else if (isUnauthorizedRelated) {
                    logger.error(`❌ ${serviceName} failed - UNAUTHORIZED ERROR (${result.reason?.amazonApiError ? 'WITH' : 'WITHOUT'} TokenManager flag)`, {
                        error: errorMsg,
                        userId,
                        hasAmazonApiErrorFlag: !!result.reason?.amazonApiError,
                        hasResponseStatus: !!result.reason?.response?.status,
                        responseStatus: result.reason?.response?.status,
                        errorType: typeof result.reason,
                        // Include partial error details for debugging
                        errorPreview: errorMsg.substring(0, 200)
                    });

                    // Log if TokenManager should have caught this but didn't
                    if (!result.reason?.amazonApiError && isUnauthorizedRelated) {
                        console.log(`⚠️ ${serviceName}: Unauthorized error detected but no TokenManager flag - this may indicate error propagation issue`);
                    }
                } else {
                    logger.error(`❌ ${serviceName} failed`, { error: errorMsg, userId });
                }

                if (loggingHelper) {
                    loggingHelper.logFunctionError(serviceName, result.reason);
                }

                return { success: false, data: null, error: errorMsg };
            }
        };

        // Process first batch results dynamically based on executed functions
        let v2data = { success: false, data: null, error: "SP-API token not available" };
        let v1data = { success: false, data: null, error: "SP-API token not available" };
        let ppcSpendsBySKU = { success: false, data: null, error: "Ads token not available" };
        let adsKeywordsPerformanceData = { success: false, data: null, error: "Ads token not available" };
        let ppcSpendsDateWise = { success: false, data: null, error: "Ads token not available" };

        let resultIndex = 0;

        // Process SP-API results if token was available
        if (AccessToken) {
            v2data = processApiResult(firstBatchResults[resultIndex], firstBatchServiceNames[resultIndex]);
            resultIndex++;
            v1data = processApiResult(firstBatchResults[resultIndex], firstBatchServiceNames[resultIndex]);
            resultIndex++;
        }

        // Process Ads results if token was available
        if (AdsAccessToken) {
            ppcSpendsBySKU = processApiResult(firstBatchResults[resultIndex], firstBatchServiceNames[resultIndex]);
            resultIndex++;
            adsKeywordsPerformanceData = processApiResult(firstBatchResults[resultIndex], firstBatchServiceNames[resultIndex]);
            resultIndex++;
            ppcSpendsDateWise = processApiResult(firstBatchResults[resultIndex], firstBatchServiceNames[resultIndex]);
            resultIndex++;
        }

        // ===== SECOND BATCH OF API CALLS WITH STRUCTURED ERROR HANDLING =====
        console.log("🔄 Starting second batch of API calls...");

        if (loggingHelper) {
            loggingHelper.logFunctionStart('secondBatch_ApiCalls', {
                hasAccessToken: !!AccessToken,
                hasAdsToken: !!AdsAccessToken
            });
        }

        const secondBatchPromises = [];
        const secondBatchServiceNames = [];

        // SP-API functions (require AccessToken)
        if (AccessToken) {
            secondBatchPromises.push(
                tokenManager.wrapSpApiFunction(
                    GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT, userId, RefreshToken, AdsRefreshToken
                )(AccessToken, marketplaceIds, userId, Base_URI, Country, Region)
            );
            secondBatchServiceNames.push("Restock Inventory Recommendations");

            secondBatchPromises.push(
                tokenManager.wrapSpApiFunction(
                    GET_FBA_INVENTORY_PLANNING_DATA, userId, RefreshToken, AdsRefreshToken
                )(AccessToken, marketplaceIds, userId, Base_URI, Country, Region)
            );
            secondBatchServiceNames.push("FBA Inventory Planning");

            secondBatchPromises.push(
                tokenManager.wrapSpApiFunction(
                    GET_STRANDED_INVENTORY_UI_DATA, userId, RefreshToken, AdsRefreshToken
                )(AccessToken, marketplaceIds, userId, Base_URI, Country, Region)
            );
            secondBatchServiceNames.push("Stranded Inventory");

            secondBatchPromises.push(
                tokenManager.wrapSpApiFunction(
                    GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA, userId, RefreshToken, AdsRefreshToken
                )(AccessToken, marketplaceIds, userId, Base_URI, Country, Region)
            );
            secondBatchServiceNames.push("Inbound Non-Compliance");
        }

        // Functions that don't require tokens (independent)
        secondBatchPromises.push(
            addReviewDataTODatabase(
                Array.isArray(asinArray) ? asinArray : [], Country, userId, Region
            )
        );
        secondBatchServiceNames.push("Product Reviews");

        // Ads functions (require AdsAccessToken)
        if (AdsAccessToken) {
            secondBatchPromises.push(
                tokenManager.wrapAdsFunction(
                    getKeywords, userId, RefreshToken, AdsRefreshToken
                )(AdsAccessToken, ProfileId, userId, Country, Region)
            );
            secondBatchServiceNames.push("Ads Keywords");

            secondBatchPromises.push(
                tokenManager.wrapAdsFunction(
                    getCampaign, userId, RefreshToken, AdsRefreshToken
                )(AdsAccessToken, ProfileId, Region, userId, Country)
            );
            secondBatchServiceNames.push("Campaign Data");
        }

        const secondBatchResults = await Promise.allSettled(secondBatchPromises);

        // Process second batch results dynamically
        let RestockinventoryData = { success: false, data: null, error: "SP-API token not available" };
        let fbaInventoryPlanningData = { success: false, data: null, error: "SP-API token not available" };
        let strandedInventoryData = { success: false, data: null, error: "SP-API token not available" };
        let inboundNonComplianceData = { success: false, data: null, error: "SP-API token not available" };
        let productReview = { success: false, data: null, error: "Function failed" };
        let adsKeywords = { success: false, data: null, error: "Ads token not available" };
        let campaignData = { success: false, data: null, error: "Ads token not available" };

        let secondResultIndex = 0;

        // Process SP-API results if token was available
        if (AccessToken) {
            RestockinventoryData = processApiResult(secondBatchResults[secondResultIndex], secondBatchServiceNames[secondResultIndex]);
            secondResultIndex++;
            fbaInventoryPlanningData = processApiResult(secondBatchResults[secondResultIndex], secondBatchServiceNames[secondResultIndex]);
            secondResultIndex++;
            strandedInventoryData = processApiResult(secondBatchResults[secondResultIndex], secondBatchServiceNames[secondResultIndex]);
            secondResultIndex++;
            inboundNonComplianceData = processApiResult(secondBatchResults[secondResultIndex], secondBatchServiceNames[secondResultIndex]);
            secondResultIndex++;
        }

        // Process independent function (Product Reviews)
        productReview = processApiResult(secondBatchResults[secondResultIndex], secondBatchServiceNames[secondResultIndex]);
        secondResultIndex++;

        // Process Ads results if token was available
        if (AdsAccessToken) {
            adsKeywords = processApiResult(secondBatchResults[secondResultIndex], secondBatchServiceNames[secondResultIndex]);
            secondResultIndex++;
            campaignData = processApiResult(secondBatchResults[secondResultIndex], secondBatchServiceNames[secondResultIndex]);
            secondResultIndex++;
        }

        // ===== VALIDATE SPONSORED ADS DATA WITH FALLBACK =====
        let sponsoredAdsData = [];
        if (ppcSpendsBySKU.success && ppcSpendsBySKU.data && Array.isArray(ppcSpendsBySKU.data.sponsoredAds)) {
            sponsoredAdsData = ppcSpendsBySKU.data.sponsoredAds;
            console.log(`✅ Using live sponsored ads data: ${sponsoredAdsData.length} records`);
        } else {
            logger.warn("Live PPC data not available, will use database fallback", {
                ppcSuccess: ppcSpendsBySKU.success,
                hasData: !!ppcSpendsBySKU.data,
                error: ppcSpendsBySKU.error
            });
        }

        // ===== DATABASE FALLBACK FOR CAMPAIGN/AD GROUP IDs =====
        let campaignIdArray = [];
        let adGroupIdArray = [];

        try {
            console.log("🔄 Fetching campaign and ad group IDs from database...");

            const storedSponsoredAdsData = await ProductWiseSponsoredAdsData.findOne({
                userId: userId,
                region: Region,
                country: Country
            });

            if (storedSponsoredAdsData && Array.isArray(storedSponsoredAdsData.sponsoredAds)) {
                // Extract unique campaign and ad group IDs from stored data
                const campaignIds = new Set();
                const adGroupIds = new Set();

                storedSponsoredAdsData.sponsoredAds.forEach(ad => {
                    if (ad && ad.campaignId) campaignIds.add(ad.campaignId);
                    if (ad && ad.adGroupId) adGroupIds.add(ad.adGroupId);
                });

                campaignIdArray = Array.from(campaignIds);
                adGroupIdArray = Array.from(adGroupIds);

                console.log(`✅ Database fallback successful: ${campaignIdArray.length} campaigns, ${adGroupIdArray.length} ad groups`);
            } else {
                // Fallback to live PPC data if available
                if (sponsoredAdsData.length > 0) {
                    const campaignIds = new Set();
                    const adGroupIds = new Set();

                    sponsoredAdsData.forEach(item => {
                        if (item && item.campaignId) campaignIds.add(item.campaignId);
                        if (item && item.adGroupId) adGroupIds.add(item.adGroupId);
                    });

                    campaignIdArray = Array.from(campaignIds);
                    adGroupIdArray = Array.from(adGroupIds);

                    console.log(`✅ Using live PPC data for IDs: ${campaignIdArray.length} campaigns, ${adGroupIdArray.length} ad groups`);
                } else {
                    logger.warn("No campaign/ad group data available from either database or live API", { userId });
                }
            }
        } catch (dbError) {
            logger.error("Database error while fetching sponsored ads data", {
                error: dbError.message,
                userId
            });
            // Continue with empty arrays rather than failing
        }

        // ===== COMPETITIVE PRICING WITH CHUNKING AND ERROR HANDLING =====
        let competitivePriceData = [];

        if (AccessToken && Array.isArray(asinArray) && asinArray.length > 0) {
            console.log(`🔄 Processing competitive pricing for ${asinArray.length} ASINs...`);

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

                    console.log(`Processing competitive pricing chunk ${Math.floor(start / CHUNK_SIZE) + 1}/${Math.ceil(asinArray.length / CHUNK_SIZE)} (ASINs ${start + 1}-${end})`);

                    try {
                        const competitiveResponseData = await tokenManager.wrapDataToSendFunction(
                            getCompetitivePricing, userId, RefreshToken, AdsRefreshToken
                        )(asinArrayChunk, dataToSend, userId, Base_URI, Country, Region);

                        if (competitiveResponseData && Array.isArray(competitiveResponseData)) {
                            competitivePriceData.push(...competitiveResponseData);
                            console.log(`✅ Chunk processed: ${competitiveResponseData.length} records added`);
                        } else {
                            logger.warn(`Competitive pricing chunk returned invalid data`, {
                                chunkStart: start,
                                chunkEnd: end,
                                responseType: typeof competitiveResponseData
                            });
                        }
                    } catch (chunkError) {
                        logger.error(`Competitive pricing error for chunk ${start}-${end}`, {
                            error: chunkError.message,
                            chunkSize: asinArrayChunk.length
                        });
                        // Continue processing other chunks rather than failing completely
                    }

                    start = end;

                    // Add delay between chunks to respect rate limits
                    if (start < asinArray.length) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                console.log(`✅ Competitive pricing completed: ${competitivePriceData.length} total records`);
                if (loggingHelper) {
                    loggingHelper.logFunctionSuccess('getCompetitivePricing_chunked', competitivePriceData, {
                        recordsProcessed: asinArray.length,
                        recordsSuccessful: competitivePriceData.length,
                        totalChunks: Math.ceil(asinArray.length / CHUNK_SIZE)
                    });
                }
            } catch (overallError) {
                logger.error("Overall competitive pricing processing failed", {
                    error: overallError.message,
                    totalASINs: asinArray.length
                });
                if (loggingHelper) {
                    loggingHelper.logFunctionError('getCompetitivePricing_chunked', overallError);
                }
                // Continue with empty competitive data rather than failing
            }
        } else {
            console.log("ℹ️ No ASINs available for competitive pricing");
            if (loggingHelper) {
                loggingHelper.logFunctionSkipped('getCompetitivePricing_chunked',
                    !AccessToken ? 'AccessToken not available' : 'No ASINs available');
            }
        }

        // ===== SAVE COMPETITIVE PRICING WITH ERROR HANDLING =====
        let CreateCompetitivePricing = null;
        try {
            if (competitivePriceData.length > 0 || asinArray.length === 0) {
                CreateCompetitivePricing = await CompetitivePricing.create({
                    User: userId,
                    region: Region,
                    country: Country,
                    Products: competitivePriceData
                });
                console.log(`✅ Competitive pricing saved: ${competitivePriceData.length} records`);
            } else {
                logger.warn("No competitive pricing data to save", { userId });
            }
        } catch (dbError) {
            logger.error("Failed to save competitive pricing to database", {
                error: dbError.message,
                dataLength: competitivePriceData.length,
                userId
            });
            // Continue without saving rather than failing
        }



        // ===== THIRD BATCH OF API CALLS =====
        console.log("🔄 Starting third batch of API calls...");

        if (loggingHelper) {
            loggingHelper.logFunctionStart('thirdBatch_ApiCalls', {
                hasAccessToken: !!AccessToken,
                hasAdsToken: !!AdsAccessToken
            });
        }

        const thirdBatchPromises = [];
        const thirdBatchServiceNames = [];

        // SP-API functions (require AccessToken in dataToSend)
        if (AccessToken) {
            thirdBatchPromises.push(
                tokenManager.wrapDataToSendFunction(
                    TotalSales, userId, RefreshToken, AdsRefreshToken
                )(dataToSend, userId, Base_URI, Country, Region)
            );
            thirdBatchServiceNames.push("Weekly Sales");

            thirdBatchPromises.push(
                tokenManager.wrapDataToSendFunction(
                    getshipment, userId, RefreshToken, AdsRefreshToken
                )(dataToSend, userId, Base_URI, Country, Region)
            );
            thirdBatchServiceNames.push("Shipment Data");

            thirdBatchPromises.push(
                tokenManager.wrapDataToSendFunction(
                    getBrand, userId, RefreshToken, AdsRefreshToken
                )(dataToSend, userId, Base_URI)
            );
            thirdBatchServiceNames.push("Brand Data");

            thirdBatchPromises.push(
                tokenManager.wrapDataToSendFunction(
                    getAmazonFees, userId, RefreshToken, AdsRefreshToken
                )(dataToSend, userId, Base_URI, Country, Region, ProductDetails)
            );
            thirdBatchServiceNames.push("Amazon Fees");

            thirdBatchPromises.push(
                tokenManager.wrapDataToSendFunction(
                    listFinancialEventsMethod, userId, RefreshToken, AdsRefreshToken
                )(dataToSend, userId, Base_URI, Country, Region)
            );
            thirdBatchServiceNames.push("Financial Events");
        }

        // Ads functions (require AdsAccessToken)
        if (AdsAccessToken) {
            // Extract campaign IDs with validation
            let campaignids = [];
            if (campaignData.success && campaignData.data && campaignData.data.campaignData) {
                if (Array.isArray(campaignData.data.campaignData)) {
                    campaignids = campaignData.data.campaignData
                        .filter(item => item && item.campaignId)
                        .map(item => item.campaignId);
                }
            }

            thirdBatchPromises.push(
                tokenManager.wrapAdsFunction(
                    getAdGroups, userId, RefreshToken, AdsRefreshToken
                )(AdsAccessToken, ProfileId, Region, userId, Country, campaignids)
            );
            thirdBatchServiceNames.push("Ad Groups Data");
        }

        const thirdBatchResults = await Promise.allSettled(thirdBatchPromises);

        // Process third batch results dynamically
        let WeeklySales = { success: false, data: null, error: "SP-API token not available" };
        let shipment = { success: false, data: null, error: "SP-API token not available" };
        let brandData = { success: false, data: null, error: "SP-API token not available" };
        let feesResult = { success: false, data: null, error: "SP-API token not available" };
        let financeDataFromAPI = { success: false, data: null, error: "SP-API token not available" };
        let adGroupsData = { success: false, data: null, error: "Ads token not available" };

        let thirdResultIndex = 0;

        // Process SP-API results if token was available
        if (AccessToken) {
            WeeklySales = processApiResult(thirdBatchResults[thirdResultIndex], thirdBatchServiceNames[thirdResultIndex]);
            thirdResultIndex++;
            shipment = processApiResult(thirdBatchResults[thirdResultIndex], thirdBatchServiceNames[thirdResultIndex]);
            thirdResultIndex++;
            brandData = processApiResult(thirdBatchResults[thirdResultIndex], thirdBatchServiceNames[thirdResultIndex]);
            thirdResultIndex++;
            feesResult = processApiResult(thirdBatchResults[thirdResultIndex], thirdBatchServiceNames[thirdResultIndex]);
            thirdResultIndex++;
            financeDataFromAPI = processApiResult(thirdBatchResults[thirdResultIndex], thirdBatchServiceNames[thirdResultIndex]);
            thirdResultIndex++;
        }

        // Process Ads results if token was available
        if (AdsAccessToken) {
            adGroupsData = processApiResult(thirdBatchResults[thirdResultIndex], thirdBatchServiceNames[thirdResultIndex]);
            thirdResultIndex++;
        }

        // ===== VALIDATE AND TRANSFORM FINANCE DATA =====
        let financeData = [];
        if (financeDataFromAPI.success && financeDataFromAPI.data) {
            if (Array.isArray(financeDataFromAPI.data)) {
                financeData = financeDataFromAPI.data;
                console.log(`✅ Using finance data: ${financeData.length} records`);
            } else if (typeof financeDataFromAPI.data === 'object') {
                // Try to extract array from common object structures
                const possibleArrays = ['financialEvents', 'events', 'data', 'items'];
                let extracted = false;

                for (const prop of possibleArrays) {
                    if (Array.isArray(financeDataFromAPI.data[prop])) {
                        financeData = financeDataFromAPI.data[prop];
                        console.log(`✅ Extracted finance data from ${prop}: ${financeData.length} records`);
                        extracted = true;
                        break;
                    }
                }

                if (!extracted) {
                    logger.warn("Finance data is an object but no recognizable array property found", {
                        objectKeys: Object.keys(financeDataFromAPI.data),
                        userId
                    });
                    financeData = [];
                }
            } else {
                logger.warn("Finance data is not an array or object", {
                    dataType: typeof financeDataFromAPI.data,
                    userId
                });
                financeData = [];
            }
        } else {
            logger.warn("Finance data not available", {
                success: financeDataFromAPI.success,
                error: financeDataFromAPI.error,
                userId
            });
            financeData = [];
        }

        // ===== FOURTH BATCH: NEGATIVE KEYWORDS AND SEARCH KEYWORDS =====
        console.log("🔄 Starting fourth batch of API calls...");

        if (loggingHelper) {
            loggingHelper.logFunctionStart('fourthBatch_Keywords', {
                hasAdsToken: !!AdsAccessToken,
                campaignIdCount: campaignIdArray.length,
                adGroupIdCount: adGroupIdArray.length
            });
        }

        let negativeKeywords = { success: false, data: null, error: "Ads token not available" };
        let searchKeywords = { success: false, data: null, error: "Ads token not available" };

        // Only proceed if Ads token is available
        if (AdsAccessToken) {
            const fourthBatchResults = await Promise.allSettled([
                tokenManager.wrapAdsFunction(
                    getNegativeKeywords, userId, RefreshToken, AdsRefreshToken
                )(AdsAccessToken, ProfileId, userId, Country, Region,
                    Array.isArray(campaignIdArray) ? campaignIdArray : [],
                    Array.isArray(adGroupIdArray) ? adGroupIdArray : []
                ),

                tokenManager.wrapAdsFunction(
                    getSearchKeywords, userId, RefreshToken, AdsRefreshToken
                )(AdsAccessToken, ProfileId, userId, Country, Region)
            ]);

            // Process fourth batch results
            negativeKeywords = processApiResult(fourthBatchResults[0], "Negative Keywords");
            searchKeywords = processApiResult(fourthBatchResults[1], "Search Keywords");
        } else {
            console.log("⚠️ Skipping fourth batch - AdsAccessToken not available");
        }

        // ===== LISTING ITEMS PROCESSING WITH MEMORY SAFETY =====
        console.log("🔄 Starting listing items processing...");

        function delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        let genericKeyWordArray = [];

        // Ensure both arrays exist and are actually arrays before processing, and AccessToken is available
        if (AccessToken && Array.isArray(skuArray) && Array.isArray(asinArray) && skuArray.length > 0) {
            if (loggingHelper) {
                loggingHelper.logFunctionStart('listingItems_processing', {
                    totalSkus: skuArray.length,
                    maxConcurrent: 50
                });
            }
            // Memory safety check
            const MAX_CONCURRENT_ITEMS = 50; // Prevent memory exhaustion
            if (skuArray.length > MAX_CONCURRENT_ITEMS) {
                logger.warn("Large number of SKUs detected, processing in smaller batches", {
                    totalSKUs: skuArray.length,
                    maxConcurrent: MAX_CONCURRENT_ITEMS,
                    userId
                });
            }

            try {
                console.log(`Processing ${skuArray.length} SKUs for listing items...`);

                // Process in smaller batches to prevent memory issues
                const BATCH_SIZE = Math.min(MAX_CONCURRENT_ITEMS, skuArray.length);

                for (let batchStart = 0; batchStart < skuArray.length; batchStart += BATCH_SIZE) {
                    const batchEnd = Math.min(batchStart + BATCH_SIZE, skuArray.length);
                    const batchSKUs = skuArray.slice(batchStart, batchEnd);
                    const batchASINs = asinArray.slice(batchStart, batchEnd);

                    console.log(`Processing listing items batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(skuArray.length / BATCH_SIZE)} (items ${batchStart + 1}-${batchEnd})`);

                    const batchTasks = batchSKUs.map((sku, index) => {
                        return limit(async () => {
                            const delay = (index % 5) * 1000; // Stagger requests within batch
                            await new Promise(resolve => setTimeout(resolve, delay));

                            // Validate array bounds within batch
                            if (index >= batchASINs.length) {
                                logger.error("Index out of bounds in batch", {
                                    batchIndex: index,
                                    batchASINsLength: batchASINs.length,
                                    sku,
                                    globalIndex: batchStart + index
                                });
                                return null;
                            }

                            const asin = batchASINs[index];
                            if (!asin) {
                                logger.error("No ASIN found for SKU in batch", {
                                    batchIndex: index,
                                    sku,
                                    globalIndex: batchStart + index
                                });
                                return null;
                            }

                            try {
                                const ListingItem = await tokenManager.wrapDataToSendFunction(
                                    GetListingItem, userId, RefreshToken, AdsRefreshToken
                                )(dataToSend, sku, asin, userId, Base_URI, Country, Region);

                                if (ListingItem) {
                                    console.log(`✅ Listing item processed: SKU ${sku}`);
                                    return ListingItem;
                                } else {
                                    logger.debug("No listing item data returned", { sku, asin });
                                    return null;
                                }
                            } catch (listingError) {
                                logger.error("Error processing listing item", {
                                    error: listingError.message,
                                    sku,
                                    asin,
                                    globalIndex: batchStart + index
                                });
                                return null;
                            }
                        });
                    });

                    const batchResults = await Promise.all(batchTasks);
                    const validResults = batchResults.filter(result => result !== null);

                    if (validResults.length > 0) {
                        genericKeyWordArray.push(...validResults);
                        console.log(`✅ Batch processed: ${validResults.length}/${batchResults.length} items successful`);
                    }

                    // Add delay between batches to respect rate limits
                    if (batchEnd < skuArray.length) {
                        await delay(2000);
                    }
                }

                console.log(`✅ Listing items processing completed: ${genericKeyWordArray.length} total items`);
                if (loggingHelper) {
                    loggingHelper.logFunctionSuccess('listingItems_processing', genericKeyWordArray, {
                        recordsProcessed: skuArray.length,
                        recordsSuccessful: genericKeyWordArray.length,
                        totalBatches: Math.ceil(skuArray.length / BATCH_SIZE)
                    });
                }
            } catch (listingError) {
                logger.error("Error during listing items processing", {
                    error: listingError.message,
                    processedItems: genericKeyWordArray.length,
                    totalSKUs: skuArray.length,
                    userId
                });
                if (loggingHelper) {
                    loggingHelper.logFunctionError('listingItems_processing', listingError);
                }
                // Continue with whatever data we have
            }
        } else {
            if (!AccessToken) {
                console.log("ℹ️ Skipping listing items processing - AccessToken not available");
                if (loggingHelper) {
                    loggingHelper.logFunctionSkipped('listingItems_processing', 'AccessToken not available');
                }
            } else {
                console.log("ℹ️ No SKUs available for listing items processing");
                if (loggingHelper) {
                    loggingHelper.logFunctionSkipped('listingItems_processing', 'No SKUs available');
                }
            }
        }

        // Save generic keywords if any were found
        if (Array.isArray(genericKeyWordArray) && genericKeyWordArray.length > 0) {
            try {
                console.log(`💾 Saving ${genericKeyWordArray.length} generic keywords to database...`);

                const saveGenericKeyword = await ListingItemsModel.create({
                    User: userId,
                    region: Region,
                    country: Country,
                    GenericKeyword: genericKeyWordArray
                });

                if (saveGenericKeyword) {
                    console.log(`✅ Generic keywords saved successfully: ${genericKeyWordArray.length} records`);
                } else {
                    logger.warn("Generic keyword save returned null/false", { userId, dataLength: genericKeyWordArray.length });
                }
            } catch (dbError) {
                logger.error("Failed to save generic keywords to database", {
                    error: dbError.message,
                    dataLength: genericKeyWordArray.length,
                    userId
                });
                // Continue without saving rather than failing
            }
        } else {
            console.log("ℹ️ No generic keywords to save");
        }

        // ===== COMPREHENSIVE DATA VALIDATION AND FINAL PREPARATION =====
        console.log("🔄 Preparing final response data...");

        // Create the final result object
        const result = {
            MerchantlistingData: merchantListingsData || null,
            financeData: Array.isArray(financeData) ? financeData : [],
            feesData: feesResult.success ? feesResult.data : null,
            v2data: v2data.success ? v2data.data : null,
            v1data: v1data.success ? v1data.data : null,
            competitivePriceData: Array.isArray(competitivePriceData) ? competitivePriceData : [],
            RestockinventoryData: RestockinventoryData.success ? RestockinventoryData.data : null,
            productReview: productReview.success ? productReview.data : null,
            WeeklySales: WeeklySales.success ? WeeklySales.data : null,
            shipment: shipment.success ? shipment.data : null,
            brandData: brandData.success ? brandData.data : null,

            // Keywords-related data
            adsKeywords: adsKeywords.success ? adsKeywords.data : null,
            adsKeywordsPerformanceData: adsKeywordsPerformanceData.success ? adsKeywordsPerformanceData.data : null,
            negativeKeywords: negativeKeywords.success ? negativeKeywords.data : null,
            searchKeywords: searchKeywords.success ? searchKeywords.data : null,
            ppcSpendsDateWise: ppcSpendsDateWise.success ? ppcSpendsDateWise.data : null,
            ppcSpendsBySKU: ppcSpendsBySKU.success ? ppcSpendsBySKU.data : null,
            campaignData: campaignData.success ? campaignData.data : null,
            adGroupsData: adGroupsData.success ? adGroupsData.data : null,

            // Inventory and compliance data
            fbaInventoryPlanningData: fbaInventoryPlanningData.success ? fbaInventoryPlanningData.data : null,
            strandedInventoryData: strandedInventoryData.success ? strandedInventoryData.data : null,
            inboundNonComplianceData: inboundNonComplianceData.success ? inboundNonComplianceData.data : null
        };

        // ===== COMPREHENSIVE SUCCESS/FAILURE SUMMARY =====
        const serviceSummary = {
            successful: [],
            failed: [],
            warnings: []
        };

        // Track all services
        const services = [
            { name: "Merchant Listings", result: { success: !!merchantListingsData } },
            { name: "V2 Seller Performance", result: v2data },
            { name: "V1 Seller Performance", result: v1data },
            { name: "PPC Spends by SKU", result: ppcSpendsBySKU },
            { name: "Ads Keywords Performance", result: adsKeywordsPerformanceData },
            { name: "PPC Spends Date Wise", result: ppcSpendsDateWise },
            { name: "Restock Inventory Recommendations", result: RestockinventoryData },
            { name: "Product Reviews", result: productReview },
            { name: "Ads Keywords", result: adsKeywords },
            { name: "Campaign Data", result: campaignData },
            { name: "FBA Inventory Planning", result: fbaInventoryPlanningData },
            { name: "Stranded Inventory", result: strandedInventoryData },
            { name: "Inbound Non-Compliance", result: inboundNonComplianceData },
            { name: "Weekly Sales", result: WeeklySales },
            { name: "Shipment Data", result: shipment },
            { name: "Brand Data", result: brandData },
            { name: "Amazon Fees", result: feesResult },
            { name: "Financial Events", result: financeDataFromAPI },
            { name: "Ad Groups Data", result: adGroupsData },
            { name: "Negative Keywords", result: negativeKeywords },
            { name: "Search Keywords", result: searchKeywords }
        ];

        services.forEach(service => {
            if (service.result.success) {
                serviceSummary.successful.push(service.name);
            } else {
                serviceSummary.failed.push({
                    service: service.name,
                    error: service.result.error || "Unknown error"
                });
            }
        });

        // Add warnings for operational conditions
        if (asinArray.length === 0) {
            serviceSummary.warnings.push("No active products found for processing");
        }
        if (financeData.length === 0) {
            serviceSummary.warnings.push("No financial data available");
        }

        // ===== DETERMINE OVERALL SUCCESS STATUS =====
        const criticalServices = ["Merchant Listings", "Financial Events", "Amazon Fees", "V2 Seller Performance", "Campaign Data"];
        const criticalFailures = serviceSummary.failed.filter(failed =>
            criticalServices.includes(failed.service)
        );

        const overallSuccess = criticalFailures.length === 0;
        const successPercentage = Math.round((serviceSummary.successful.length / services.length) * 100);

        // ===== LOG COMPREHENSIVE SUMMARY =====
        console.log("📊 FINAL PROCESSING SUMMARY:");
        console.log(`✅ Successful services: ${serviceSummary.successful.length}/${services.length} (${successPercentage}%)`);
        console.log(`❌ Failed services: ${serviceSummary.failed.length}`);
        console.log(`⚠️ Warnings: ${serviceSummary.warnings.length}`);

        if (serviceSummary.failed.length > 0) {
            console.log("Failed services:", serviceSummary.failed.map(f => f.service).join(", "));
        }

        if (serviceSummary.warnings.length > 0) {
            console.log("Warnings:", serviceSummary.warnings.join(", "));
        }

        // ===== RETURN APPROPRIATE RESPONSE =====
        if (overallSuccess) {
            console.log("🎉 SP-API data processing completed successfully!");

            // Log successful completion
            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('getSpApiData', result, {
                    recordsProcessed: serviceSummary.successful.length + serviceSummary.failed.length,
                    recordsSuccessful: serviceSummary.successful.length,
                    recordsFailed: serviceSummary.failed.length
                });
                await loggingHelper.endSession('completed');
            }
            

            // ===== SEND ANALYSIS READY EMAIL =====
           try {
                console.log("📧 Sending analysis ready email...");
                const userInfo = await userModel.findById(userId).select("analyseAccountSuccess email firstName ");
                //const userInfo = await getUserById(userId);

                if(userInfo.analyseAccountSuccess==1){
                    if (userInfo && userInfo.email && userInfo.firstName) {
                        const dashboardUrl = process.env.DASHBOARD_URL || `${process.env.CLIENT_BASE_URL}/dashboard`;
                        const emailSent = await sendAnalysisReadyEmail(
                            userInfo.email,
                            userInfo.firstName,
                            dashboardUrl
                        );
    
                        if (emailSent) {
                            userInfo.analyseAccountSuccess=0;
                            await userInfo.save();
                            console.log(`✅ Analysis ready email sent successfully to ${userInfo.email}`);
                        } else {
                            logger.warn("Failed to send analysis ready email, but continuing with response", {
                                userId,
                                email: userInfo.email
                            });
                        }
                    } else {
                        logger.warn("User information not found for email notification", {
                            userId,
                            hasUserInfo: !!userInfo,
                            hasEmail: !!(userInfo && userInfo.email),
                            hasFirstName: !!(userInfo && userInfo.firstName)
                        });
                    }
                }

                
            } catch (emailError) {
                logger.error("Error sending analysis ready email", {
                    error: emailError.message,
                    userId
                });
                // Don't fail the entire response because of email error
            }

            try {
                const addAccountHistoryData = await addNewAccountHistory(userId,Country,Region);

                if(!addAccountHistoryData){
                    logger.error("Error adding account history", {
                        error: "Failed to add account history",
                        userId
                    });
                }
            } catch (error) {
                logger.error("Error adding account history", {
                    error: error.message,
                    userId
                });
                // Don't fail the entire response because of account history error
            }

            return res.status(200).json(new ApiResponse(200, {
                data: result,
                summary: {
                    success: true,
                    successRate: `${successPercentage}%`,
                    totalServices: services.length,
                    successfulServices: serviceSummary.successful.length,
                    failedServices: serviceSummary.failed.length,
                    warnings: serviceSummary.warnings,
                    processingTime: Date.now() - Date.parse(new Date().toISOString())
                }
            }, "SP-API data processing completed successfully"));
        } else {
            logger.error("Critical services failed", {
                criticalFailures: criticalFailures.map(f => f.service),
                userId
            });

            // Log partial success
            if (loggingHelper) {
                loggingHelper.logFunctionWarning('getSpApiData', 'Critical services failed', {
                    criticalFailures: criticalFailures.map(f => f.service),
                    successRate: successPercentage
                });
                await loggingHelper.endSession('partial');
            }

            try {
                const addAccountHistoryData = await addNewAccountHistory(userId,Country,Region);

                if(!addAccountHistoryData){
                    logger.error("Error adding account history", {
                        error: "Failed to add account history",
                        userId
                    });
                }
            } catch (error) {
                logger.error("Error adding account history", {
                    error: error.message,
                    userId
                });
                // Don't fail the entire response because of account history error
            }

            return res.status(207).json(new ApiResponse(207, {
                data: result,
                summary: {
                    success: false,
                    successRate: `${successPercentage}%`,
                    totalServices: services.length,
                    successfulServices: serviceSummary.successful.length,
                    failedServices: serviceSummary.failed.length,
                    criticalFailures: criticalFailures,
                    warnings: serviceSummary.warnings,
                    processingTime: Date.now() - Date.parse(new Date().toISOString())
                }
            }, "Partial success - some critical services failed"));
        }

    } catch (unexpectedError) {
        logger.error("Unexpected error in getSpApiData", {
            error: unexpectedError.message,
            stack: unexpectedError.stack,
            userId
        });

        // Log the unexpected error
        if (loggingHelper) {
            loggingHelper.logFunctionError('getSpApiData', unexpectedError);
            await loggingHelper.endSession('failed');
        }

        return res.status(500).json(new ApiError(500, `Unexpected error: ${unexpectedError.message}`));
    }

})

module.exports = { getSpApiData }
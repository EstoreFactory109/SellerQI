const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const V2_Model = require('../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const V1_Model = require('../../models/seller-performance/V1_Seller_Performance_Report_Model.js');
const numberofproductreviews = require('../../models/seller-performance/NumberOfProductReviewsModel.js');
// Use service layer for ListingItems (handles 16MB limit)
const { getListingItemsData } = require('../products/ListingItemsService.js');
const APlusContentModel = require('../../models/seller-performance/APlusContentModel.js');
// Deprecated: financeModel - replaced by EconomicsMetrics
// const financeModel = require('../../models/finance/listFinancialEventsModel.js');
const restockInventoryRecommendationsModel = require('../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
// Deprecated: TotalSalesModel - replaced by EconomicsMetrics
// const TotalSalesModel = require('../../models/products/TotalSalesModel.js');
const ShipmentModel = require('../../models/inventory/ShipmentModel.js');
const ProductWiseSalesModel = require('../../models/products/ProductWiseSalesModel.js');
// Economics (sales, fees, gross profit): fresh EconomicsMetrics, else live DailySkuFinance, else null
const { loadLiveEconomics } = require('../Finance/LiveEconomicsService.js');
const { convertEconomicsToFinanceFormat } = require('../Finance/EconomicsFinanceFormat.js');
// New: BuyBoxData model for buybox metrics
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
// New: DataFetchTracking for getting actual calendar dates from database
const DataFetchTracking = require('../../models/system/DataFetchTrackingModel.js');
const { 
    replenishmentQty,
    inventoryPlanningData: processInventoryPlanningData,
    inventoryStrandedData: processInventoryStrandedData,
    inboundNonComplianceData: processInboundNonComplianceData 
} = require('../Calculations/Inventory_.js');
const { calculateAccountHealthPercentage, checkAccountHealth } = require('../Calculations/AccountHealth.js');
const { loadV2History } = require('../Calculations/AccountHealthHistory.js');
const { getRankings, BackendKeyWordOrAttributesStatus } = require('../Calculations/Rankings.js');
const {
    checkNumberOfImages,
    checkIfVideoExists,
    checkStarRating,
    checkAPlus,
    checkProductWithOutBuyBox,
    checkBrandStory
} = require('../Calculations/Conversion.js');
// Use service layer for ProductWiseSponsoredAds (handles 16MB limit)
const { getProductWiseSponsoredAdsData } = require('../amazon-ads/ProductWiseSponsoredAdsService.js');
const NegetiveKeywords = require('../../models/amazon-ads/NegetiveKeywords.js');
const KeywordModel = require('../../models/amazon-ads/keywordModel.js');
const SearchTerms = require('../../models/amazon-ads/SearchTermsModel.js');
const Campaign = require('../../models/amazon-ads/CampaignModel.js');
const GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA_Model = require('../../models/inventory/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA.js');
// Use service layer for StrandedInventoryUIData (handles 16MB limit)
const { getStrandedInventoryUIData } = require('../inventory/StrandedInventoryUIDataService.js');
const GET_FBA_INVENTORY_PLANNING_DATA_Model = require('../../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js');
const LongTermStorageFeesModel = require('../../models/finance/LongTermStorageFeesModel.js');
const FbaInventoryApiDetailModel = require('../../models/inventory/FbaInventoryApiDetailModel.js');
const CogsService = require('../Finance/CogsService.js');
// Deprecated: FBAFeesModel - replaced by EconomicsMetrics (MCP)
// const FBAFeesModel = require('../../models/finance/FBAFees.js');
const adsKeywordsPerformanceModel = require('../../models/amazon-ads/adsKeywordsPerformanceModel.js');
const { loadLatestSnapshotDoc, loadKeywordSnapshot } = require('../../utils/ppcSnapshotLoader.js');
const { buildLtsfAmountMap, classifyBuyBoxLoss } = require('../Calculations/RecoverableAmountUtils.js');
const { freshInventoryReportOrNull, filterInboundIssuesToWindow } = require('../Calculations/InventoryReportFreshness.js');
const GetOrderDataModel = require('../../models/products/OrderAndRevenueModel.js');
const WeeklyFinanceModel = require('../../models/finance/WeekLyFinanceModel.js');
const userModel = require('../../models/user-auth/userModel.js');
const GetDateWisePPCspendModel = require('../../models/amazon-ads/GetDateWisePPCspendModel.js');
const AdsGroup = require('../../models/amazon-ads/adsgroupModel.js');
const differenceCalculation = require('../Calculations/DifferenceCalcualtion.js');
const KeywordTrackingModel = require('../../models/amazon-ads/KeywordTrackingModel.js');
// PPC Units Sold model for date-wise units sold data
const PPCUnitsSold = require('../../models/amazon-ads/PPCUnitsSoldModel.js');

class AnalyseService {
    /**
     * Main analysis function
     * @param {string} userId - User ID
     * @param {string} country - Country code
     * @param {string} region - Region code
     * @param {string|null} adminId - Admin ID for enterprise users
     * @returns {Object} Analysis result
     */
    static async Analyse(userId, country, region, adminId = null) {
        const analyseStartTime = Date.now();
        logger.info(`[PERF] Starting Analyse service for user ${userId}, country ${country}, region ${region}`);
        
        console.log("userId in the start: ", userId);
        if (!userId) {
            logger.error(new ApiError(400, "User id is missing"));
            return {
                status: 404,
                message: "User id is missing"
            }
        }

        console.log("userId: ", userId);
        if (!country || !region) {
            logger.error(new ApiError(400, "Country or Region is missing"));
            return {
                status: 404,
                message: "Country or Region is missing"
            }
        }

        let stepStart = Date.now();
        const createdAccountDate = await userModel.findOne({ _id: userId }).select('createdAt').sort({ createdAt: -1 });
        logger.info(`[PERF] Fetched createdAccountDate in ${Date.now() - stepStart}ms`);
        
        if (!createdAccountDate) {
            logger.error(new ApiError(404, "User not found"));
            return {
                status: 404,
                message: "User not found"
            }
        }

        // Get seller account data
        stepStart = Date.now();
        const sellerAccountData = await this.getSellerAccountData(userId, country, region, adminId);
        logger.info(`[PERF] getSellerAccountData completed in ${Date.now() - stepStart}ms`);
        
        if (!sellerAccountData.success) {
            return {
                status: sellerAccountData.status,
                message: sellerAccountData.message
            };
        }

        const { allSellerAccounts, SellerAccount, sellerCentral } = sellerAccountData;

        // Fetch all data models in parallel
        stepStart = Date.now();
        const allData = await this.fetchAllDataModels(userId, country, region);
        logger.info(`[PERF] fetchAllDataModels total time: ${Date.now() - stepStart}ms`);

        // Process sponsored ads data
        stepStart = Date.now();
        const sponsoredAdsData = this.processSponsoredAdsData(allData.ProductWiseSponsoredAds);
        logger.info(`[PERF] processSponsoredAdsData completed in ${Date.now() - stepStart}ms`);

        // Get difference calculation data
        stepStart = Date.now();
        const differenceData = await differenceCalculation(userId, country, region);
        logger.info(`[PERF] differenceCalculation completed in ${Date.now() - stepStart}ms`);

        // Create base result object
        stepStart = Date.now();
        const result = await this.createBaseResult({
            userId,
            region,
            createdAccountDate,
            sellerCentral,
            allSellerAccounts,
            country,
            SellerAccount,
            allData,
            sponsoredAdsData,
            differenceData
        });
        logger.info(`[PERF] createBaseResult completed in ${Date.now() - stepStart}ms`);

        // Process conversion and ranking data
        stepStart = Date.now();
        const conversionData = this.processConversionData(SellerAccount, allData);
        result.RankingsData = conversionData.rankingsData;
        result.ConversionData = conversionData.conversionData;
        result.Defaulters = conversionData.defaulters;
        logger.info(`[PERF] processConversionData completed in ${Date.now() - stepStart}ms`);

        // Process inventory analysis
        stepStart = Date.now();
        const inventoryAnalysis = this.processInventoryAnalysis(allData, { userId, country, region });
        result.InventoryAnalysis = inventoryAnalysis.analysis;
        logger.info(`[PERF] processInventoryAnalysis completed in ${Date.now() - stepStart}ms`);
        
        // Update Amazon ready products based on inventory errors
        this.updateAmazonReadyProducts(
            conversionData.conversionData.AmazonReadyproducts,
            inventoryAnalysis.errorsByAsin
        );

        // Calculate error summary
        result.ErrorSummary = this.calculateErrorSummary(conversionData, inventoryAnalysis);

        // Log summary
        logger.info(`Analysis Summary: Total Errors=${result.ErrorSummary.totalErrors}, ` +
                  `Inventory Analysis: Planning=${result.InventoryAnalysis.inventoryPlanning.length}, ` +
                  `Stranded=${result.InventoryAnalysis.strandedInventory.length}, ` +
                  `NonCompliance=${result.InventoryAnalysis.inboundNonCompliance.length}, ` +
                  `Amazon Ready Products=${result.ConversionData.AmazonReadyproducts.length}`);

        // Debug final result
        console.log('[DEBUG] Final result keywordTrackingData:', result.keywordTrackingData?.length || 0, 'keywords');
        console.log('[DEBUG] Final result sample keywordTrackingData:', JSON.stringify(result.keywordTrackingData?.[0] || {}, null, 2));

        const totalAnalyseTime = Date.now() - analyseStartTime;
        logger.info(`[PERF] Analyse service TOTAL time: ${totalAnalyseTime}ms`);

        return {
            status: 200,
            message: result
        };
    }

    /**
     * Get seller account data
     */
    static async getSellerAccountData(userId, country, region, adminId) {
        const allSellerAccounts = [];
        let SellerAccount = null;
        let sellerCentral = null;

        if (adminId !== null) {
            // Handle admin/enterprise user flow
            let getAllSellerAccounts = [];
            const getAdminStatus = await userModel.findOne({ _id: adminId }).select('accessType');

            if (getAdminStatus.accessType === 'enterpriseAdmin') {
                // Query by agencyId (new) OR adminId (legacy) for backward compatibility
                const getClientsSellerCentral = await userModel.find({
                    $or: [
                        { agencyId: adminId },
                        { adminId: adminId }
                    ]
                }).select('sellerCentral').sort({ createdAt: -1 });
                if (!getClientsSellerCentral) {
                    logger.error(new ApiError(404, "Client not found"));
                }

                for (const sellerId of getClientsSellerCentral) {
                    console.log("sellerId: ", sellerId.sellerCentral);
                    const getSellerCentral = await Seller.findOne({ _id: sellerId.sellerCentral });
                    console.log("getSellerCentral: ", getSellerCentral);
                    if (getSellerCentral) {
                        getAllSellerAccounts.push(getSellerCentral);
                    }
                }

                const getSelfSellerCentral = await Seller.findOne({ User: adminId });
                console.log("getSelfSellerCentral: ", getSelfSellerCentral);
                if (getSelfSellerCentral) {
                    getAllSellerAccounts.push(getSelfSellerCentral);
                }

            } else {
                getAllSellerAccounts = await Seller.find({});
            }

            if (!getAllSellerAccounts) {
                logger.error(new ApiError(404, "Seller central not found"));
                return {
                    success: false,
                    status: 404,
                    message: "Seller central not found"
                };
            }

            sellerCentral = getAllSellerAccounts.find(item => item.User.toString() === userId);

            if (!sellerCentral) {
                logger.error(new ApiError(404, "Seller central not found"));
                return {
                    success: false,
                    status: 404,
                    message: "Seller central not found"
                };
            }

            getAllSellerAccounts.forEach(item => {
                const userId = item.User;
                const sellerId = item.selling_partner_id;
                const brand = item.brand || "Brand Name";

                item.sellerAccount.forEach(Details => {
                    allSellerAccounts.push({
                        userId,
                        sellerId,
                        brand,
                        country: Details.country,
                        region: Details.region,
                        NoOfProducts: Details.products.length
                    });

                    if (Details.country === country && Details.region === region) {
                        SellerAccount = Details;
                    }
                });
            });
        } else {
            // Handle regular user flow
            sellerCentral = await Seller.findOne({ User: userId });
            if (!sellerCentral) {
                logger.error(new ApiError(404, "Seller central not found"));
                return {
                    success: false,
                    status: 404,
                    message: "Seller central not found"
                };
            }

            sellerCentral.sellerAccount.forEach(item => {
                console.log("item: ", item.country, item.region);
                if (item.country && item.region) {
                    console.log("item: ", item.country, item.region);

                    allSellerAccounts.push({
                        brand: sellerCentral.brand,
                        country: item.country,
                        region: item.region,
                        NoOfProducts: item.products.length,
                        SpAPIrefreshTokenStatus: item.spiRefreshToken ? true : false,
                        AdsAPIrefreshTokenStatus: item.adsRefreshToken ? true : false,
                    });
                }
                if (item.country === country && item.region === region) {
                    SellerAccount = item;
                }
            });

            console.log("SellerAccount: ", SellerAccount);

            if (!SellerAccount) {
                logger.error(new ApiError(404, "Seller account not found"));
                return {
                    success: false,
                    status: 404,
                    message: "Seller account not found"
                };
            }
        }

        return {
            success: true,
            allSellerAccounts,
            SellerAccount,
            sellerCentral
        };
    }

    /**
     * Fetch all data models in parallel
     * Note: financeData and TotalSales are now fetched from EconomicsMetrics model
     */
    static async fetchAllDataModels(userId, country, region) {
        const fetchStartTime = Date.now();
        logger.info(`[PERF] Starting fetchAllDataModels for user ${userId}, country ${country}, region ${region}`);
        
        const createdDate = new Date();
        const ThirtyDaysAgo = new Date(createdDate);
        ThirtyDaysAgo.setDate(ThirtyDaysAgo.getDate() - 30);

        // How many days of per-day ads rows the dashboard pulls. The UI offers Last 7 / 14 / 30
        // and anchors its calendar to the backend's own dataRange, so 30 covers every selectable
        // range; anything beyond it was being fetched, shipped to the browser, and never shown.
        // Env-overridable so this can be widened in production without a deploy.
        const dashboardLookbackDays = Math.max(
            1,
            parseInt(process.env.DASHBOARD_ADS_LOOKBACK_DAYS || '30', 10) || 30
        );

        // Create individual timed queries for performance measurement
        const timedQuery = async (name, queryFn) => {
            const start = Date.now();
            try {
                const result = await queryFn();
                const duration = Date.now() - start;
                if (duration > 100) { // Only log queries taking more than 100ms
                    logger.info(`[PERF] Query ${name}: ${duration}ms`);
                }
                return result;
            } catch (error) {
                logger.error(`[PERF] Query ${name} failed after ${Date.now() - start}ms: ${error.message}`);
                throw error;
            }
        };

        // Use .lean() for all queries to return plain JavaScript objects instead of Mongoose documents
        // This significantly reduces memory usage and improves query performance
        const [
            v2Data,
            v1Data,
            v2History,
            economicsMetricsData, // Replaces financeData and TotalSales
            buyBoxData, // BuyBox data from MCP
            restockInventoryRecommendationsData,
            numberOfProductReviews,
            GetlistingAllItems,
            aplusResponse,
            shipmentdata,
            saleByProduct,
            ProductWiseSponsoredAds,
            negetiveKeywords,
            keywords,
            searchTerms,
            campaignData,
            inventoryPlanningData,
            inventoryStrandedData,
            inboundNonComplianceData,
            FBAFeesData,
            adsKeywordsPerformanceData,
            GetOrderData,
            GetDateWisePPCspendData,
            AdsGroupData,
            keywordTrackingData,
            ppcUnitsSoldData,
            cogsData,
            ltsfData,
            fbaInventoryDetailData,
            campaignSpendSales
        ] = await Promise.all([
            timedQuery('v2Data', () => V2_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean()),
            timedQuery('v1Data', () => V1_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean()),
            // Last 7 days of reports, so a status Amazon flips day to day is judged
            // over the week rather than on whichever report came last.
            timedQuery('v2History', () => loadV2History(userId, country, region)),
            // Fresh EconomicsMetrics, else built from DailySkuFinance (30 days ending
            // yesterday), else null. Never the last stale doc.
            timedQuery('economicsMetrics', () => loadLiveEconomics(userId, region, country)),
            // Fetch BuyBox data: the last 7 non-empty data days, reduced to one
            // effective doc. Judging from the newest doc alone let an empty day wipe
            // every Buy Box issue and a one-day 0% blip create a week-long task
            // (see classifyBuyBoxLoss). null when there are no days = no Buy Box issues.
            timedQuery('buyBoxData', () => BuyBoxData.findRecentDays(userId, region, country, 7).then(classifyBuyBoxLoss)),
            timedQuery('restockInventory', () => restockInventoryRecommendationsModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean()),
            timedQuery('productReviews', () => numberofproductreviews.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean()),
            // Use service layer for ListingItems (handles both old and new formats)
            timedQuery('listingItems', () => getListingItemsData(userId, country, region)),
            timedQuery('aplusContent', () => APlusContentModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean()),
            timedQuery('shipmentData', () => ShipmentModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean()),
            timedQuery('productWiseSales', () => ProductWiseSalesModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean()),
            // Use service layer for ProductWiseSponsoredAds (handles both old and new formats)
            timedQuery('sponsoredAds', () => getProductWiseSponsoredAdsData(userId, country, region)),
            timedQuery('negativeKeywords', () => loadLatestSnapshotDoc(NegetiveKeywords, userId, country, region)),
            timedQuery('keywords', () => loadKeywordSnapshot(userId, country, region)),
            timedQuery('searchTerms', () =>
                SearchTerms.findMergedSearchTermData(userId, country, region, { lookbackDays: dashboardLookbackDays }).then((rows) =>
                    rows?.length ? { userId, country, region, searchTermData: rows } : null
                )
            ),
            timedQuery('campaignData', () => loadLatestSnapshotDoc(Campaign, userId, country, region)),
            timedQuery('inventoryPlanning', () => GET_FBA_INVENTORY_PLANNING_DATA_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean()),
            // Use service layer for StrandedInventoryUIData (handles both old and new formats)
            timedQuery('strandedInventory', () => getStrandedInventoryUIData(userId, country, region)),
            timedQuery('nonCompliance', () => GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA_Model.findOne({ userId: userId, country, region }).sort({ createdAt: -1 }).lean()),
            // Deprecated: FBAFeesModel - replaced by EconomicsMetrics (MCP provides ASIN-wise fees)
            Promise.resolve(null), // FBAFeesData - use EconomicsMetrics.asinWiseSales instead
            timedQuery('adsKeywords', () =>
                adsKeywordsPerformanceModel.findMergedKeywordsData(userId, country, region, { lookbackDays: dashboardLookbackDays }).then((rows) =>
                    rows?.length ? { userId, country, region, keywordsData: rows } : null
                )
            ),
            timedQuery('orderData', () => GetOrderDataModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean()),
            // Per-day merge with the same bounded window as its ads siblings above. The old
            // `findOne().sort({createdAt:-1})` loaded ONE document holding the whole report —
            // 13MB for the largest account — and, because a catch-up run writes a single-day
            // document, could collapse the entire chart to that one day.
            timedQuery('ppcSpend', () =>
                GetDateWisePPCspendModel.findMergedDateWiseSpends(userId, country, region, { lookbackDays: dashboardLookbackDays }).then((rows) =>
                    rows?.length ? { userId, country, region, dateWisePPCSpends: rows } : null
                )
            ),
            timedQuery('adsGroup', () => loadLatestSnapshotDoc(AdsGroup, userId, country, region)),
            timedQuery('keywordTracking', () => KeywordTrackingModel.findOne({ userId, country, region }).sort({ createdAt: -1 }).lean()),
            timedQuery('ppcUnitsSold', () => PPCUnitsSold.findLatestForUser(userId, country, region)),
            // For threading a dollar `amount` onto Inventory error records (unfulfillable/stranded/LTSF)
            timedQuery('cogsData', () => CogsService.getCogs(userId, country)),
            timedQuery('ltsfData', () => LongTermStorageFeesModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean()),
            timedQuery('fbaInventoryDetailData', () => FbaInventoryApiDetailModel.find({ User: userId, country, region }).lean()),
            // The PPC page's campaign totals, so high-ACOS tasks judge the same campaigns
            // over the same window as the page the seller checks them against.
            timedQuery('campaignSpendSales', () =>
                require('../Calculations/PPCCampaignAnalysisService.js').getCampaignSpendSales(userId, country, region)
                    .catch((error) => {
                        logger.warn('[Analyse] PPC campaign totals unavailable; high-ACOS tasks fall back to date-wise spend', { error: error.message });
                        return null;
                    }))
        ]);
        
        const fetchEndTime = Date.now();
        logger.info(`[PERF] fetchAllDataModels completed in ${fetchEndTime - fetchStartTime}ms`);
        
        // Convert single ProductWiseSponsoredAds result to array format for backward compatibility
        const ProductWiseSponsoredAdsArray = ProductWiseSponsoredAds ? [ProductWiseSponsoredAds] : [];

        // For big accounts (totalSales > 5000), asinWiseSales is stored in a separate collection
        // NOTE: We do NOT combine asinWiseSales here to avoid memory issues with large accounts
        // The asinWiseSales array can have 15,000+ records for big accounts, causing heap overflow
        // Instead, we pass the metrics as-is and handle big accounts in specific calculations that need it
        let processedEconomicsMetricsData = economicsMetricsData;
        if (economicsMetricsData && economicsMetricsData.toObject) {
            processedEconomicsMetricsData = economicsMetricsData.toObject();
        }
        
        // Debug: Log ASIN data availability
        if (processedEconomicsMetricsData) {
            logger.info('Analyse.js - EconomicsMetrics ASIN data check', {
                userId,
                country,
                region,
                isBig: processedEconomicsMetricsData.isBig,
                totalSales: processedEconomicsMetricsData.totalSales?.amount,
                asinWiseSalesLength: processedEconomicsMetricsData.asinWiseSales?.length || 0,
                hasAsinWiseSales: !!processedEconomicsMetricsData.asinWiseSales,
                isArray: Array.isArray(processedEconomicsMetricsData.asinWiseSales)
            });
        }

        console.log("v2Data: ", v2Data);
        console.log("economicsMetricsData: ", processedEconomicsMetricsData ? 'Found' : 'Not Found');
        
        // DEBUG: Log adsKeywordsPerformanceData query result
        logger.info('=== DEBUG: adsKeywordsPerformanceData in Analyse.js ===');
        logger.info('Query params:', { userId, country, region });
        logger.info('adsKeywordsPerformanceData found:', adsKeywordsPerformanceData ? 'Yes' : 'No');
        if (adsKeywordsPerformanceData) {
            logger.info('keywordsData length:', adsKeywordsPerformanceData.keywordsData?.length || 0);
            logger.info('Document userId:', adsKeywordsPerformanceData.userId?.toString());
            logger.info('Document country:', adsKeywordsPerformanceData.country);
            logger.info('Document region:', adsKeywordsPerformanceData.region);
        }
        console.log("buyBoxData: ", buyBoxData ? {
            found: true,
            totalProducts: buyBoxData.totalProducts,
            productsWithoutBuyBox: buyBoxData.productsWithoutBuyBox,
            asinBuyBoxDataCount: buyBoxData.asinBuyBoxData?.length || 0,
            hasAsinBuyBoxData: !!buyBoxData.asinBuyBoxData
        } : 'Not Found');

        // Calculate total PPC spend from Amazon Ads API (PRIMARY source)
        // Use the array format for backward compatibility
        const adsPPCSpend = this.calculateTotalPPCSpendFromAdsAPI(ProductWiseSponsoredAdsArray);
        logger.info('PPC Spend calculated from Amazon Ads API:', { adsPPCSpend });
        
        // Convert EconomicsMetrics to legacy financeData format for backward compatibility
        // Uses Ads API PPC spend as PRIMARY source (not MCP Economics ppcSpent)
        const financeData = this.convertEconomicsToFinanceFormat(processedEconomicsMetricsData, adsPPCSpend);
        
        // Convert EconomicsMetrics to legacy TotalSales format for backward compatibility
        const TotalSales = this.convertEconomicsToTotalSalesFormat(processedEconomicsMetricsData);

        // Log missing data warnings
        const missingDataWarnings = [];
        if (!v2Data) missingDataWarnings.push('v2Data');
        if (!v1Data) missingDataWarnings.push('v1Data');
        if (!processedEconomicsMetricsData) missingDataWarnings.push('economicsMetricsData');
        // ... add other checks as needed

        if (missingDataWarnings.length > 0) {
            logger.warn(`Missing data (using defaults): ${missingDataWarnings.join(', ')}`);
        }

        // Debug keyword tracking data
        console.log('[DEBUG] KeywordTrackingData found:', !!keywordTrackingData);
        if (keywordTrackingData) {
            console.log('[DEBUG] KeywordTrackingData keywords count:', keywordTrackingData.keywords?.length || 0);
            console.log('[DEBUG] KeywordTrackingData sample:', JSON.stringify(keywordTrackingData.keywords?.[0] || {}, null, 2));
        } else {
            console.log('[DEBUG] No KeywordTrackingData found for userId:', userId, 'country:', country, 'region:', region);
        }

        // Plain object: built by classifyBuyBoxLoss from lean docs
        const buyBoxDataPlain = buyBoxData || null;
        
        return {
            v2Data,
            v1Data,
            v2History,
            financeData,
            economicsMetricsData: processedEconomicsMetricsData, // Raw economics data with asinWiseSales combined for big accounts
            buyBoxData: buyBoxDataPlain, // Already a plain object from .lean()
            restockInventoryRecommendationsData,
            numberOfProductReviews,
            GetlistingAllItems,
            aplusResponse,
            TotalSales,
            shipmentdata,
            saleByProduct,
            ProductWiseSponsoredAds: ProductWiseSponsoredAdsArray, // Use the array format
            negetiveKeywords,
            keywords,
            searchTerms,
            campaignData,
            inventoryPlanningData,
            inventoryStrandedData,
            inboundNonComplianceData,
            FBAFeesData,
            adsKeywordsPerformanceData,
            GetOrderData,
            GetDateWisePPCspendData,
            AdsGroupData,
            keywordTrackingData,
            ppcUnitsSoldData,
            cogsData,
            ltsfData,
            fbaInventoryDetailData,
            campaignSpendSales
        };
    }

    /**
     * Calculate total PPC spend from ProductWiseSponsoredAds (Amazon Ads API)
     * @param {Array} ProductWiseSponsoredAds - Array of sponsored ads data from DB
     * @returns {number} Total PPC spend
     */
    static calculateTotalPPCSpendFromAdsAPI(ProductWiseSponsoredAds) {
        let totalPPCSpend = 0;
        
        if (!ProductWiseSponsoredAds || !Array.isArray(ProductWiseSponsoredAds) || ProductWiseSponsoredAds.length === 0) {
            return 0;
        }
        
        // Get the most recent sponsored ads data
        const mostRecentData = ProductWiseSponsoredAds[0]?.sponsoredAds || [];
        
        mostRecentData.forEach(item => {
            if (item && item.spend !== undefined && item.spend !== null) {
                totalPPCSpend += parseFloat(item.spend) || 0;
            }
        });
        
        return parseFloat(totalPPCSpend.toFixed(2));
    }

    /**
     * Convert EconomicsMetrics data to legacy financeData format.
     * The rule lives in Finance/EconomicsFinanceFormat.js so the lightweight
     * dashboard endpoints apply it without loading this module's graph.
     * @param {Object} economicsMetrics - EconomicsMetrics document
     * @param {number} adsPPCSpend - Total PPC spend from Amazon Ads API (primary source)
     * @returns {Object} Finance data in legacy format
     */
    static convertEconomicsToFinanceFormat(economicsMetrics, adsPPCSpend = 0) {
        return convertEconomicsToFinanceFormat(economicsMetrics, adsPPCSpend);
    }

    /**
     * Convert EconomicsMetrics data to legacy TotalSales format
     * @param {Object} economicsMetrics - EconomicsMetrics document
     * @returns {Object} TotalSales data in legacy format
     */
    static convertEconomicsToTotalSalesFormat(economicsMetrics) {
        if (!economicsMetrics) {
            return { totalSales: [] };
        }

        // Convert datewiseSales to the legacy totalSales format
        const totalSales = (economicsMetrics.datewiseSales || []).map(day => ({
            interval: day.date,
            TotalAmount: day.sales?.amount || 0,
            Profit: day.grossProfit?.amount || 0
        }));

        return { totalSales };
    }

    /**
     * Process sponsored ads data
     */
    static processSponsoredAdsData(ProductWiseSponsoredAds) {
        let mostRecentSponsoredAds = [];
        let sponsoredAdsGraphData = {};

        const safeProductWiseSponsoredAds = ProductWiseSponsoredAds || [];

        if (safeProductWiseSponsoredAds && safeProductWiseSponsoredAds.length > 0) {
            // Get the most recent data for display
            mostRecentSponsoredAds = safeProductWiseSponsoredAds[0].sponsoredAds || [];

            // Organize data by ASIN
            const asinDataMap = {};
            const createdDate = new Date();

            // First, collect all unique ASINs from all entries
            const allAsins = new Set();
            safeProductWiseSponsoredAds.forEach(entry => {
                if (entry.sponsoredAds && Array.isArray(entry.sponsoredAds)) {
                    entry.sponsoredAds.forEach(product => {
                        const asin = product.asin || product.ASIN;
                        if (asin) {
                            allAsins.add(asin);
                            // Initialize ASIN data structure if not exists
                            if (!asinDataMap[asin]) {
                                asinDataMap[asin] = {
                                    asin: asin,
                                    productName: product.productName || product.name || '',
                                    data: []
                                };
                            }
                        }
                    });
                }
            });

            // Create a map of dates to sponsored ads data for easier lookup
            const dateDataMap = {};
            safeProductWiseSponsoredAds.forEach(entry => {
                const dateKey = new Date(entry.createdAt).toDateString();
                dateDataMap[dateKey] = entry.sponsoredAds || [];
            });

            // Generate 30 days of data
            for (let i = 0; i < 30; i++) {
                const dateForData = new Date(createdDate);
                dateForData.setDate(dateForData.getDate() - i);
                const dateKey = dateForData.toDateString();

                // For each ASIN, add data for this date
                allAsins.forEach(asin => {
                    const dayData = dateDataMap[dateKey] || [];
                    const productData = dayData.find(p => (p.asin || p.ASIN) === asin);

                    if (productData) {
                        // Use actual data from that day
                        asinDataMap[asin].data.push({
                            date: dateForData.toISOString(),
                            formattedDate: this.formatDateDisplay(dateForData),
                            salesIn7Days: parseFloat(productData['7daySales'] || productData.salesIn7Days || 0),
                            salesIn14Days: parseFloat(productData['14daySales'] || productData.salesIn14Days || 0),
                            salesIn30Days: parseFloat(productData['30daySales'] || productData.salesIn30Days || 0),
                            purchasedIn7Days: parseFloat(productData['7dayPurchased'] || productData.purchasedIn7Days || productData['7dayOrders'] || 0),
                            purchasedIn14Days: parseFloat(productData['14dayPurchased'] || productData.purchasedIn14Days || productData['14dayOrders'] || 0),
                            purchasedIn30Days: parseFloat(productData['30dayPurchased'] || productData.purchasedIn30Days || productData['30dayOrders'] || 0),
                            spend: parseFloat(productData.spend || 0),
                            clicks: parseInt(productData.clicks || 0),
                            impressions: parseInt(productData.impressions || 0),
                            acos: parseFloat(productData.acos || 0),
                            cpc: parseFloat(productData.cpc || 0),
                            ctr: parseFloat(productData.ctr || 0)
                        });
                    } else {
                        // No data for this day, add zeros
                        asinDataMap[asin].data.push({
                            date: dateForData.toISOString(),
                            formattedDate: this.formatDateDisplay(dateForData),
                            salesIn7Days: 0,
                            salesIn14Days: 0,
                            salesIn30Days: 0,
                            purchasedIn7Days: 0,
                            purchasedIn14Days: 0,
                            purchasedIn30Days: 0,
                            spend: 0,
                            clicks: 0,
                            impressions: 0,
                            acos: 0,
                            cpc: 0,
                            ctr: 0
                        });
                    }
                });
            }

            // Sort data by date (newest first) for each ASIN
            Object.keys(asinDataMap).forEach(asin => {
                asinDataMap[asin].data.sort((a, b) => new Date(b.date) - new Date(a.date));
            });

            // Convert to final format
            sponsoredAdsGraphData = asinDataMap;
        }

        return {
            mostRecentSponsoredAds,
            sponsoredAdsGraphData
        };
    }

    /**
     * YYYY-MM-DD format — used for startDate/endDate in API responses.
     * Must stay machine-readable so the frontend can pass it back as query params.
     */
    /**
     * YYYY-MM-DD format — used for startDate/endDate in API responses.
     * Must stay machine-readable so the frontend can pass it back as query params.
     */
    static formatDate(date) {
        const dte = new Date(date);
        const year = dte.getFullYear();
        const month = String(dte.getMonth() + 1).padStart(2, '0');
        const day = String(dte.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /** Human-readable label for chart axes / tooltips (e.g. "06 Apr"). */
    static formatDateDisplay(date) {
        const dte = new Date(date);
        const day = String(dte.getDate()).padStart(2, '0');
        const month = dte.toLocaleString('default', { month: 'short' });
        return `${day} ${month}`;
    }

    /**
     * Create base result object
     */
    static async createBaseResult(params) {
        const {
            userId,
            region,
            createdAccountDate,
            sellerCentral,
            allSellerAccounts,
            country,
            SellerAccount,
            allData,
            sponsoredAdsData,
            differenceData
        } = params;

        const safeFinanceData = allData.financeData || {
            createdAt: new Date(),
            Gross_Profit: null,
            Total_Sales: null,
            ProductAdsPayment: 0,
            FBA_Fees: null,
            Storage: null,
            Amazon_Charges: null,
            Refunds: null
        };

        const financeCreatedDate = safeFinanceData.createdAt;
        const financeThirtyDaysAgo = new Date(financeCreatedDate);
        financeThirtyDaysAgo.setDate(financeThirtyDaysAgo.getDate() - 30);

        // Get economics metrics for ASIN-wise data (profitability, ACOS/TACOS calculations)
        const economicsMetrics = allData.economicsMetricsData;

        // Get calendar dates from DataFetchTracking (PRIMARY source - no calculation, just from database)
        // This tracks when calendar-affecting services actually ran
        // Uses findLatestUsable to include both 'completed' and 'partial' runs (both have valid data)
        let dataStartDate = null;
        let dataEndDate = null;
        let trackingInfo = null;
        
        try {
            const latestTracking = await DataFetchTracking.findLatestUsable(userId, country, region);
            if (latestTracking && latestTracking.dataRange) {
                dataStartDate = latestTracking.dataRange.startDate;
                dataEndDate = latestTracking.dataRange.endDate;
                trackingInfo = {
                    fetchedAt: latestTracking.fetchedAt,
                    dayName: latestTracking.dayName,
                    dateString: latestTracking.dateString,
                    timeString: latestTracking.timeString,
                    status: latestTracking.status
                };
                logger.info('Calendar dates from DataFetchTracking:', {
                    startDate: dataStartDate,
                    endDate: dataEndDate,
                    fetchedAt: latestTracking.fetchedAt,
                    dayName: latestTracking.dayName,
                    status: latestTracking.status
                });
            }
        } catch (trackingError) {
            logger.warn('Failed to get dates from DataFetchTracking:', { error: trackingError.message });
        }
        
        // Fallback to EconomicsMetrics dateRange if DataFetchTracking not found
        if (!dataStartDate || !dataEndDate) {
            // Helper to format date as YYYY-MM-DD for calendar compatibility
            const formatDateForCalendar = (date) => {
                const d = new Date(date);
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };
            
            dataStartDate = economicsMetrics?.dateRange?.startDate || formatDateForCalendar(financeThirtyDaysAgo);
            dataEndDate = economicsMetrics?.dateRange?.endDate || formatDateForCalendar(financeCreatedDate);
            logger.info('Calendar dates from EconomicsMetrics (fallback):', {
                startDate: dataStartDate,
                endDate: dataEndDate
            });
        }
        
        // Debug log to track date source
        logger.info('Final calendar date range:', {
            startDate: dataStartDate,
            endDate: dataEndDate,
            source: trackingInfo ? 'DataFetchTracking' : 'EconomicsMetrics/Fallback',
            trackingInfo
        });

        return {
            createdAccountDate: createdAccountDate,
            Brand: sellerCentral.brand,
            AllSellerAccounts: allSellerAccounts,
            startDate: dataStartDate,
            endDate: dataEndDate,
            Country: country,
            TotalProducts: SellerAccount.products,
            AccountData: {
                getAccountHealthPercentge: (!allData.v2Data || allData.v2Data === null || (typeof allData.v2Data === 'object' && Object.keys(allData.v2Data).length === 0) || (!allData.v2Data.ahrScore && allData.v2Data.ahrScore !== 0))
                    ? { status: "Data Not Found", Percentage: 0 }
                    : calculateAccountHealthPercentage(allData.v2Data),
                accountHealth: checkAccountHealth(allData.v2Data, allData.v1Data, allData.v2History)
            },
            FinanceData: safeFinanceData,
            TotalSales: (allData.TotalSales || { totalSales: [] }).totalSales,
            // New: EconomicsMetrics data for dashboard and profitability
            EconomicsMetrics: economicsMetrics ? {
                totalSales: economicsMetrics.totalSales,
                grossProfit: economicsMetrics.grossProfit,
                ppcSpent: economicsMetrics.ppcSpent,
                fbaFees: economicsMetrics.fbaFees,
                storageFees: economicsMetrics.storageFees,
                totalFees: economicsMetrics.totalFees,
                amazonFees: economicsMetrics.amazonFees,
                refunds: economicsMetrics.refunds,
                datewiseSales: economicsMetrics.datewiseSales,
                datewiseGrossProfit: economicsMetrics.datewiseGrossProfit,
                asinWiseSales: economicsMetrics.asinWiseSales,
                dateRange: economicsMetrics.dateRange,
                // Flag for big accounts (totalSales > 10000) - asinWiseSales stored in separate collection
                isBig: economicsMetrics.isBig || false,
                // 'daily_sku_finance' when built live; absent on a stored EconomicsMetrics doc
                source: economicsMetrics.source,
                // Readers judge freshness by it (isEconomicsFresh); without it every
                // doc, even a fresh one, read as stale downstream.
                createdAt: economicsMetrics.createdAt,
                // Metrics document ID needed for fetching ASIN data from separate collection
                _id: economicsMetrics._id,
                // When this data was fetched (from DataFetchTracking)
                fetchInfo: trackingInfo
            } : null,
            // New: BuyBox data for dashboard
            BuyBoxData: allData.buyBoxData ? {
                totalProducts: allData.buyBoxData.totalProducts,
                productsWithBuyBox: allData.buyBoxData.productsWithBuyBox,
                productsWithoutBuyBox: allData.buyBoxData.productsWithoutBuyBox,
                productsWithLowBuyBox: allData.buyBoxData.productsWithLowBuyBox,
                asinBuyBoxData: allData.buyBoxData.asinBuyBoxData,
                dateRange: allData.buyBoxData.dateRange,
                // How many days the Buy Box verdicts rest on (classifyBuyBoxLoss)
                observedDays: allData.buyBoxData.observedDays,
                observedDates: allData.buyBoxData.observedDates
            } : null,
            ProductWiseSponsoredAds: sponsoredAdsData.mostRecentSponsoredAds,
            ProductWiseSponsoredAdsGraphData: sponsoredAdsData.sponsoredAdsGraphData,
            negetiveKeywords: (allData.negetiveKeywords || { negativeKeywordsData: [] }).negativeKeywordsData,
            keywords: (allData.keywords || { keywordData: [] }).keywordData,
            searchTerms: (allData.searchTerms || { searchTermData: [] }).searchTermData,
            campaignData: (allData.campaignData || { campaignData: [] }).campaignData,
            // Deprecated: FBAFeesData - replaced by EconomicsMetrics.asinWiseSales (MCP provides ASIN-wise fees)
            FBAFeesData: [], // Use EconomicsMetrics.asinWiseSales for ASIN-wise fees data
            adsKeywordsPerformanceData: (allData.adsKeywordsPerformanceData || { keywordsData: [] }).keywordsData,
            GetOrderData: (allData.GetOrderData || { RevenueData: [] }).RevenueData,
            GetDateWisePPCspendData: (allData.GetDateWisePPCspendData || { dateWisePPCSpends: [] }).dateWisePPCSpends,
            campaignSpendSales: allData.campaignSpendSales || null,
            AdsGroupData: (allData.AdsGroupData || { adsGroupData: [] }).adsGroupData,
            keywordTrackingData: (allData.keywordTrackingData || { keywords: [] }).keywords || [],
            DifferenceData: differenceData.percentageDifference,
            SalesByProducts: (allData.saleByProduct || { productWiseSales: [] }).productWiseSales,
            // PPC Units Sold data for date-wise units sold metrics (1-day attribution)
            PPCUnitsSold: allData.ppcUnitsSoldData ? {
                dateRange: allData.ppcUnitsSoldData.dateRange,
                totalUnits: allData.ppcUnitsSoldData.totalUnits,
                summary: allData.ppcUnitsSoldData.summary,
                dateWiseUnits: allData.ppcUnitsSoldData.dateWiseUnits
            } : null
        };
    }

    /**
     * Process conversion and ranking data
     */
    static processConversionData(SellerAccount, allData) {
        const safeProductReviews = allData.numberOfProductReviews || { Products: [] };
        const safeListingItems = allData.GetlistingAllItems || { GenericKeyword: [] };
        const safeAplusResponse = allData.aplusResponse || { ApiContentDetails: [] };
        
        // Use BuyBox data from MCP instead of competitive pricing
        // Convert BuyBox data to format expected by checkProductWithOutBuyBox
        const buyBoxData = allData.buyBoxData || {};
        const asinBuyBoxData = buyBoxData.asinBuyBoxData || [];
        const buyBoxProducts = asinBuyBoxData.map(item => ({
            asin: item.childAsin || item.asin,
            // buyBoxLost is classifyBuyBoxLoss's verdict; an "unknown" (null %) row
            // is not a loss. Raw % only for rows without a verdict.
            belongsToRequester: typeof item.buyBoxLost === 'boolean'
                ? !item.buyBoxLost
                : (item.buyBoxPercentage || 0) > 0
        }));

        const asinSet = new Set(SellerAccount.products.map(p => p.asin));
        const presentBuyBoxAsins = new Set(checkProductWithOutBuyBox(buyBoxProducts).presentAsin);
        const productReviewsAsins = new Set(safeProductReviews.Products.map(p => p.asin));
        const listingAllAsins = new Set((safeListingItems.GenericKeyword || []).map(p => p.asin));

        const productReviewsDefaulters = [], listingAllItemsDefaulters = [], ProductwithoutBuyboxDefaulters = [];
        asinSet.forEach(asin => {
            if (!productReviewsAsins.has(asin)) productReviewsDefaulters.push(asin);
            if (!listingAllAsins.has(asin)) listingAllItemsDefaulters.push(asin);
            if (!presentBuyBoxAsins.has(asin)) ProductwithoutBuyboxDefaulters.push(asin);
        });

        const DefaulterList = {
            ProductReviews: productReviewsDefaulters,
            ListingAllItems: listingAllItemsDefaulters,
            ProductwithOutBuyBox: ProductwithoutBuyboxDefaulters
        };

        // "Amazon ready" = an Active ASIN with no Error in any listing check. Built as
        // an intersection: start from every Active ASIN and remove each one any check
        // flags. It used to be built by adding ASINs instead - from
        // rankings.TotalErrors, which does not exist (getRankings returns
        // { finalResult }), so that loop never added anything - and the keyword loop
        // then added or removed on backend keywords alone, so an ASIN with a clean
        // keyword string counted as ready whatever else was wrong with it.
        // Inventory errors are removed afterwards (updateAmazonReadyProducts).
        const notReady = new Set();
        // ASINs whose listing was actually scraped. An Active ASIN missing from the
        // scrape is "not known", not "ready" - missing data must not earn the badge.
        const scraped = new Set();
        const imageResultArray = [], videoResultArray = [],
              productStarRatingResultArray = [], RankingResultArray = [], BackendKeywordResultArray = [];

        safeProductReviews.Products.forEach(product => {
            if (!DefaulterList.ProductReviews.includes(product.asin)) {
                const imageResult = checkNumberOfImages(product.product_photos);
                const videoResult = checkIfVideoExists(product.video_url);
                const productStarRatingResult = checkStarRating(product.product_star_ratings, product.product_num_ratings);
                const rankings = getRankings(product);
                if (product.asin) scraped.add(product.asin);

                // "No data" (no reviews yet, no image data) must not cost a product its
                // Amazon-ready status: only a real problem does.
                if ((rankings.finalResult?.TotalErrors || 0) > 0 ||
                    [imageResult, videoResult, productStarRatingResult].some(r => r.status === "Error")) {
                    notReady.add(product.asin);
                }

                imageResultArray.push({ asin: product.asin, data: imageResult });
                videoResultArray.push({ asin: product.asin, data: videoResult });
                productStarRatingResultArray.push({ asin: product.asin, data: productStarRatingResult });
                RankingResultArray.push({ asin: product.asin, data: rankings.finalResult });
            }
        });

        safeListingItems.GenericKeyword.forEach(item => {
            const asin = item.asin;
            if (!DefaulterList.ListingAllItems.includes(asin)) {
                const keywordStatus = BackendKeyWordOrAttributesStatus(item.value);
                // Errors only (a short-keywords Warning is not counted in
                // NumberOfErrors), and never re-adds: one SKU's clean keywords
                // must not undo another check's verdict.
                if (keywordStatus.NumberOfErrors > 0) notReady.add(asin);
                BackendKeywordResultArray.push({ asin, data: keywordStatus });
            }
        });

        const aplusProducts = safeAplusResponse.ApiContentDetails;
        const aPlusArray = checkAPlus(aplusProducts);
        aPlusArray.forEach(item => {
            if (item?.data?.status === "Error") notReady.add(item.asin);
        });

        // buyboxResult is Error exactly where the effective Buy Box row says
        // buyBoxLost (raw % only for rows without a verdict) - the same rows that
        // become no_buybox tasks.
        const buyboxResult = checkProductWithOutBuyBox(buyBoxProducts).buyboxResult;
        buyboxResult.forEach(item => {
            if (item?.status === "Error") notReady.add(item.asin);
        });

        const AmazonReadyProducts = SellerAccount.products
            .filter(p => p && p.status === 'Active' && p.asin && scraped.has(p.asin) && !notReady.has(p.asin))
            .map(p => p.asin);
        
        // Check Brand Story status from NumberOfProductReviews data. Empty when no
        // product in this marketplace shows a Brand Story (see checkBrandStory).
        const brandStoryArray = checkBrandStory(safeProductReviews.Products);
        // Task reconcile's coverage for brand story is "the scrape arrived", not "the
        // result list is non-empty": in a gated marketplace the list is empty on
        // purpose, and the existing missing_brand_story tasks there must resolve.
        const brandStoryScrapePresent = Array.isArray(safeProductReviews.Products)
            && safeProductReviews.Products.length > 0;

        return {
            rankingsData: {
                RankingResultArray,
                BackendKeywordResultArray
            },
            conversionData: {
                imageResult: imageResultArray,
                videoResult: videoResultArray,
                productStarRatingResult: productStarRatingResultArray,
                aPlusResult: aPlusArray,
                brandStoryResult: brandStoryArray,
                brandStoryScrapePresent,
                ProductWithOutBuybox: buyboxResult,
                // Unique: an ASIN listed under several SKUs is one product.
                AmazonReadyproducts: [...new Set(AmazonReadyProducts)]
            },
            defaulters: DefaulterList
        };
    }

    /**
     * Process inventory analysis
     */
    static processInventoryAnalysis(allData, context = {}) {
        const inventoryAnalysis = {
            inventoryPlanning: [],
            strandedInventory: [],
            inboundNonCompliance: [],
            replenishment: []
        };

        // These three daily reports are read as "newest document wins", so a
        // document older than a week is treated as absent rather than shown as
        // today's position — see InventoryReportFreshness.js for how stale ones
        // arose. Stranded is dated by its batch's createdAt.
        const strandedDoc = freshInventoryReportOrNull(allData.inventoryStrandedData, 'Stranded inventory', context);
        const inboundDoc = freshInventoryReportOrNull(allData.inboundNonComplianceData, 'Inbound non-compliance', context);
        const restockDoc = freshInventoryReportOrNull(allData.restockInventoryRecommendationsData, 'Restock recommendations', context);

        // Create safe defaults for inventory data
        const safeInventoryPlanningData = allData.inventoryPlanningData || { data: [] };
        const safeInventoryStrandedData = strandedDoc || { strandedUIData: [] };
        // The writer keeps only issues reported in the last 30 days, but that
        // window was applied on the day it ran; re-apply it now so a document
        // from earlier in the week cannot surface issues that have aged out.
        const safeInboundNonComplianceData = {
            ErrorData: filterInboundIssuesToWindow(inboundDoc?.ErrorData)
        };
        const safeRestockData = restockDoc || { Products: [] };

        // Per-unit COGS, keyed by ASIN — used to turn unfulfillable/stranded
        // quantities into a dollar amount. Empty map (amount = 0) for accounts
        // that haven't entered COGS yet.
        const costMap = (allData.cogsData && allData.cogsData.success && allData.cogsData.data?.cogsValues) || {};

        // Real long-term storage fee $ per ASIN from the GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA
        // sync, summed across rows (multiple aging buckets can appear per ASIN per snapshot).
        // Empty map (amount = 0) when that sync hasn't run yet OR when the newest
        // snapshot is too old to describe the seller's position today — see
        // buildLtsfAmountMap for why the age guard is required.
        const ltsfAmountMap = buildLtsfAmountMap(allData.ltsfData);

        // Total FBA quantity per ASIN — used as a proxy for "stranded units"
        // since the Stranded Inventory report has no quantity field of its own.
        const qtyMap = {};
        if (Array.isArray(allData.fbaInventoryDetailData)) {
            allData.fbaInventoryDetailData.forEach(row => {
                if (row && row.asin) {
                    qtyMap[row.asin] = (qtyMap[row.asin] || 0) + (row.totalQuantity || 0);
                }
            });
        }

        // Process Inventory Planning Data for each ASIN
        if (safeInventoryPlanningData.data && Array.isArray(safeInventoryPlanningData.data)) {
            safeInventoryPlanningData.data.forEach(item => {
                if (item && item.asin) {
                    try {
                        const planningResult = processInventoryPlanningData(item, costMap, ltsfAmountMap);
                        inventoryAnalysis.inventoryPlanning.push(planningResult);
                    } catch (error) {
                        logger.error(`Error processing inventory planning data for ASIN ${item.asin}: ${error.message}`);
                    }
                }
            });
        }

        // Process Stranded Inventory Data for each ASIN
        if (safeInventoryStrandedData.strandedUIData && Array.isArray(safeInventoryStrandedData.strandedUIData)) {
            safeInventoryStrandedData.strandedUIData.forEach(strandedArray => {
                if (Array.isArray(strandedArray)) {
                    strandedArray.forEach(item => {
                        if (item && item.asin) {
                            try {
                                const strandedResult = processInventoryStrandedData(item, costMap, qtyMap);
                                inventoryAnalysis.strandedInventory.push(strandedResult);
                            } catch (error) {
                                logger.error(`Error processing stranded inventory data for ASIN ${item.asin}: ${error.message}`);
                            }
                        }
                    });
                }
            });
        }

        // Process Inbound Non-Compliance Data for each ASIN
        if (safeInboundNonComplianceData.ErrorData && Array.isArray(safeInboundNonComplianceData.ErrorData)) {
            safeInboundNonComplianceData.ErrorData.forEach(item => {
                if (item && item.asin) {
                    try {
                        const complianceResult = processInboundNonComplianceData(item);
                        inventoryAnalysis.inboundNonCompliance.push(complianceResult);
                    } catch (error) {
                        logger.error(`Error processing inbound non-compliance data for ASIN ${item.asin}: ${error.message}`);
                    }
                }
            });
        }

        // Process Replenishment/Restock Data for each ASIN
        if (safeRestockData.Products && Array.isArray(safeRestockData.Products)) {
            try {
                const replenishmentResults = replenishmentQty(safeRestockData.Products);
                inventoryAnalysis.replenishment = replenishmentResults || [];
            } catch (error) {
                logger.error(`Error processing replenishment data: ${error.message}`);
                inventoryAnalysis.replenishment = [];
            }
        } else {
            inventoryAnalysis.replenishment = [];
        }

        // Calculate total inventory errors per ASIN
        const inventoryErrorsByAsin = new Map();

        // Count errors from inventory planning data
        if (inventoryAnalysis.inventoryPlanning && Array.isArray(inventoryAnalysis.inventoryPlanning)) {
            inventoryAnalysis.inventoryPlanning.forEach(item => {
                if (item && item.asin) {
                    let errorCount = 0;
                    if (item.longTermStorageFees && item.longTermStorageFees.status === "Error") errorCount++;
                    if (item.unfulfillable && item.unfulfillable.status === "Error") errorCount++;

                    if (errorCount > 0) {
                        inventoryErrorsByAsin.set(item.asin, (inventoryErrorsByAsin.get(item.asin) || 0) + errorCount);
                    }
                }
            });
        }

        // Count errors from stranded inventory (always errors when present)
        if (inventoryAnalysis.strandedInventory && Array.isArray(inventoryAnalysis.strandedInventory)) {
            inventoryAnalysis.strandedInventory.forEach(item => {
                if (item && item.asin && item.status === "Error") {
                    inventoryErrorsByAsin.set(item.asin, (inventoryErrorsByAsin.get(item.asin) || 0) + 1);
                }
            });
        }

        // Count errors from inbound non-compliance (always errors when present)
        if (inventoryAnalysis.inboundNonCompliance && Array.isArray(inventoryAnalysis.inboundNonCompliance)) {
            inventoryAnalysis.inboundNonCompliance.forEach(item => {
                if (item && item.asin && item.status === "Error") {
                    inventoryErrorsByAsin.set(item.asin, (inventoryErrorsByAsin.get(item.asin) || 0) + 1);
                }
            });
        }

        // Count errors from replenishment/restock data (low inventory errors)
        if (inventoryAnalysis.replenishment && Array.isArray(inventoryAnalysis.replenishment)) {
            inventoryAnalysis.replenishment.forEach(item => {
                if (item && item.asin && item.status === "Error") {
                    inventoryErrorsByAsin.set(item.asin, (inventoryErrorsByAsin.get(item.asin) || 0) + 1);
                }
            });
        }

        return {
            analysis: inventoryAnalysis,
            errorsByAsin: inventoryErrorsByAsin
        };
    }

    /**
     * Update Amazon ready products based on inventory errors
     */
    static updateAmazonReadyProducts(amazonReadyProducts, inventoryErrorsByAsin) {
        const amazonReadyProductsSet = new Set(amazonReadyProducts);
        
        // Remove ASINs with inventory errors from AmazonReadyProductsSet
        inventoryErrorsByAsin.forEach((errorCount, asin) => {
            if (errorCount > 0) {
                amazonReadyProductsSet.delete(asin);
            }
        });

        // Update the array in place
        amazonReadyProducts.length = 0;
        amazonReadyProducts.push(...Array.from(amazonReadyProductsSet));
    }

    /**
     * Calculate error summary
     */
    static calculateErrorSummary(conversionData, inventoryAnalysis) {
        let totalErrorsAllCategories = 0;

        // Count conversion errors
        const conversionErrors = [
            ...conversionData.conversionData.imageResult.filter(item => item && item.data && item.data.status === "Error"),
            ...conversionData.conversionData.videoResult.filter(item => item && item.data && item.data.status === "Error"),
            ...conversionData.conversionData.productStarRatingResult.filter(item => item && item.data && item.data.status === "Error"),
            // checkAPlus returns { asin, data: { status } }; item.status never existed,
            // so missing A+ was never counted here.
            ...conversionData.conversionData.aPlusResult.filter(item => item && item.data && item.data.status === "Error")
        ];
        totalErrorsAllCategories += conversionErrors.length;

        // Count ranking errors
        const rankingErrors = conversionData.rankingsData.RankingResultArray.reduce((count, item) => {
            return count + ((item && item.data && item.data.TotalErrors) || 0);
        }, 0);
        totalErrorsAllCategories += rankingErrors;

        // Count backend keyword errors. Rows are per SKU, so an ASIN sold under
        // several SKUs arrives several times; count it once, keeping its worst row,
        // as DashboardCalculation does (tasks are one per ASIN and error type).
        const keywordErrorsByAsin = new Map();
        conversionData.rankingsData.BackendKeywordResultArray.forEach((item) => {
            if (!item || !item.asin || !item.data) return;
            const errors = item.data.NumberOfErrors || 0;
            keywordErrorsByAsin.set(item.asin, Math.max(keywordErrorsByAsin.get(item.asin) || 0, errors));
        });
        const keywordErrors = [...keywordErrorsByAsin.values()].reduce((count, errors) => count + errors, 0);
        totalErrorsAllCategories += keywordErrors;

        // Count buybox errors
        // checkProductWithOutBuyBox returns flat { asin, status }; item.data never
        // existed, so Buy Box losses were never counted here.
        const buyboxErrors = conversionData.conversionData.ProductWithOutBuybox.filter(item => item && item.status === "Error").length;
        totalErrorsAllCategories += buyboxErrors;

        // Count inventory errors
        const totalInventoryErrors = inventoryAnalysis.errorsByAsin && inventoryAnalysis.errorsByAsin.size > 0
            ? Array.from(inventoryAnalysis.errorsByAsin.values()).reduce((sum, count) => sum + (count || 0), 0)
            : 0;
        totalErrorsAllCategories += totalInventoryErrors;

        return {
            totalErrors: totalErrorsAllCategories,
            conversionErrors: conversionErrors.length,
            rankingErrors: rankingErrors,
            keywordErrors: keywordErrors,
            buyboxErrors: buyboxErrors,
            inventoryErrors: totalInventoryErrors,
            inventoryErrorsByAsin: inventoryAnalysis.errorsByAsin && inventoryAnalysis.errorsByAsin.size > 0
                ? Object.fromEntries(inventoryAnalysis.errorsByAsin)
                : {}
        };
    }

    /**
     * Get data from date range
     * @param {string} userId - User ID
     * @param {string} country - Country code
     * @param {string} region - Region code
     * @param {Date|string} startDate - Start date
     * @param {Date|string} endDate - End date
     * @param {string|null} periodType - Period type (custom, last7, thisMonth, lastMonth)
     * @returns {Object} Date range data
     */
    static async getDataFromDateRange(userId, country, region, startDate, endDate, periodType = null) {
        if (!userId) {
            logger.error(new ApiError(400, "User id is missing"));
            return {
                status: 404,
                message: "User id is missing"
            }
        }
        if (!country || !region) {
            logger.error(new ApiError(400, "Country or Region is missing"));
            return {
                status: 404,
                message: "Country or Region is missing"
            }
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        // Set time to beginning and end of day for accurate comparisons
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        // Calculate the number of days in the date range (inclusive)
        const daysDifference = Math.ceil((end - start + 1) / (1000 * 60 * 60 * 24));

        const sellerCentral = await Seller.findOne({ User: userId });
        if (!sellerCentral) {
            logger.error(new ApiError(404, "Seller central not found"));
            return {
                status: 404,
                message: "Seller central not found"
            }
        }

        const allSellerAccounts = []
        let SellerAccount = null;

        sellerCentral.sellerAccount.forEach(item => {
            allSellerAccounts.push({
                country: item.country,
                region: item.region,
                NoOfProducts: item.products.length
            })
            if (item.country === country && item.region === region) {
                SellerAccount = item;
            }
        })

        if (!SellerAccount) {
            logger.error(new ApiError(404, "Seller account not found"));
            return {
                status: 404,
                message: "Seller account not found"
            }
        }

        // For any explicit date range, use EconomicsMetrics datewise data to calculate totals
        if (periodType === 'custom' || periodType === 'last7' || periodType === 'last14' || periodType === 'last30' || periodType === 'thisMonth' || periodType === 'lastMonth') {
            return this.processCustomDateRange(userId, country, region, start, end, daysDifference);
        }

        // Default logic for other period types can go here if needed
        return {
            status: 200,
            message: {
                startDate: this.formatDate(start),
                endDate: this.formatDate(end),
                Country: country,
                FinanceData: {
                    Gross_Profit: 0,
                    ProductAdsPayment: 0,
                    FBA_Fees: 0,
                    Storage: 0,
                    Amazon_Charges: 0,
                    Refunds: 0
                },
                reimburstmentData: 0,
                TotalSales: {
                    totalSales: 0,
                    dateWiseSales: []
                }
            }
        };
    }

    /**
     * Process custom date range
     *
     * Totals come from the shared loader (loadLiveEconomics) for the picked range:
     * a fresh EconomicsMetrics doc that covers it, else live DailySkuFinance for
     * exactly that range. No data -> null totals; never an older doc's numbers and
     * never an estimate (the old order-data fallback guessed profit as 70% of sales).
     */
    static async processCustomDateRange(userId, country, region, start, end, daysDifference) {
        try {
            logger.info(`Processing custom date range: ${daysDifference} days from ${start.toISOString()} to ${end.toISOString()}`);

            const startStr = this.formatDate(start);
            const endStr = this.formatDate(end);

            const metrics = await loadLiveEconomics(userId, region, country, { startDate: startStr, endDate: endStr });

            if (!metrics) {
                logger.warn('No economics for custom date range (no fresh EconomicsMetrics, no DailySkuFinance rows)', {
                    userId, country, region, startDate: startStr, endDate: endStr
                });
                return {
                    status: 200,
                    message: {
                        startDate: startStr,
                        endDate: endStr,
                        Country: country,
                        FinanceData: {
                            Gross_Profit: null,
                            ProductAdsPayment: null,
                            FBA_Fees: null,
                            Storage: null,
                            Amazon_Charges: null,
                            Refunds: null
                        },
                        reimburstmentData: 0,
                        TotalSales: {
                            totalSales: null,
                            dateWiseSales: []
                        }
                    }
                };
            }

            // A built doc is exactly the range; a fresh stored doc covers it and is
            // filtered down to it. Dates are 'YYYY-MM-DD' strings, compared as such.
            const inRange = (date) => {
                const d = typeof date === 'string' ? date.slice(0, 10) : this.formatDate(date);
                return d >= startStr && d <= endStr;
            };

            const grossProfitByDate = new Map();
            let totalGrossProfit = 0;
            for (const item of metrics.datewiseGrossProfit || []) {
                if (!inRange(item.date)) continue;
                const amount = item.grossProfit?.amount || 0;
                grossProfitByDate.set(String(item.date).slice(0, 10), amount);
                totalGrossProfit += amount;
            }

            let totalSales = 0;
            const dateWiseSales = [];
            for (const item of metrics.datewiseSales || []) {
                if (!inRange(item.date)) continue;
                const dateKey = String(item.date).slice(0, 10);
                const salesAmount = item.sales?.amount || 0;
                totalSales += salesAmount;
                dateWiseSales.push({
                    interval: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    TotalAmount: salesAmount,
                    Profit: parseFloat((grossProfitByDate.get(dateKey) || 0).toFixed(2)),
                    date: item.date
                });
            }
            dateWiseSales.sort((a, b) => String(a.date).localeCompare(String(b.date)));

            const financialEvents = { ProductAdsPayment: 0, FBA_Fees: 0, Storage: 0, Refunds: 0 };
            for (const item of metrics.datewiseFeesAndRefunds || []) {
                if (!inRange(item.date)) continue;
                financialEvents.FBA_Fees += item.fbaFulfillmentFee?.amount || 0;
                financialEvents.Storage += item.storageFee?.amount || 0;
                financialEvents.Refunds += item.refunds?.amount || 0;
            }

            // ppcSpent is a window total; take the share of the doc window the range overlaps
            // (1 for a doc built for exactly this range).
            const docStart = metrics.dateRange?.startDate;
            const docEnd = metrics.dateRange?.endDate;
            if (docStart && docEnd) {
                const dayMs = 1000 * 60 * 60 * 24;
                const toUtc = (s) => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`);
                const overlapStart = Math.max(toUtc(startStr), toUtc(docStart));
                const overlapEnd = Math.min(toUtc(endStr), toUtc(docEnd));
                const docDays = Math.round((toUtc(docEnd) - toUtc(docStart)) / dayMs) + 1;
                const overlapDays = Math.round((overlapEnd - overlapStart) / dayMs) + 1;
                if (docDays > 0 && overlapDays > 0) {
                    financialEvents.ProductAdsPayment = (metrics.ppcSpent?.amount || 0) * Math.min(overlapDays / docDays, 1);
                }
            }

            // Amazon_Charges is the sum of FBA fees and storage fees
            const amazonCharges = financialEvents.FBA_Fees + financialEvents.Storage;

            logger.info(`Custom date range economics: source=${metrics.source || 'EconomicsMetrics'}, days=${dateWiseSales.length}, sales=${totalSales}, grossProfit=${totalGrossProfit}`);

            return {
                status: 200,
                message: {
                    startDate: startStr,
                    endDate: endStr,
                    Country: country,
                    FinanceData: {
                        Gross_Profit: parseFloat(totalGrossProfit.toFixed(2)),
                        ProductAdsPayment: parseFloat(financialEvents.ProductAdsPayment.toFixed(2)),
                        FBA_Fees: parseFloat(financialEvents.FBA_Fees.toFixed(2)),
                        Storage: parseFloat(financialEvents.Storage.toFixed(2)),
                        Amazon_Charges: parseFloat(amazonCharges.toFixed(2)),
                        Refunds: parseFloat(financialEvents.Refunds.toFixed(2))
                    },
                    reimburstmentData: 0, // Not calculated for custom periods
                    TotalSales: {
                        totalSales: parseFloat(totalSales.toFixed(2)),
                        dateWiseSales
                    }
                }
            };
        } catch (error) {
            logger.error(`Error in custom date range calculation: ${error.message}`);
            logger.error(error.stack);
            return {
                status: 500,
                message: "Error processing custom date range"
            };
        }
    }
}

module.exports = { AnalyseService };

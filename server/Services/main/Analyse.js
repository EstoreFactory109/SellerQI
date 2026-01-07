const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const V2_Model = require('../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const V1_Model = require('../../models/seller-performance/V1_Seller_Performance_Report_Model.js');
const numberofproductreviews = require('../../models/seller-performance/NumberOfProductReviewsModel.js');
const ListingAllItems = require('../../models/products/GetListingItemsModel.js');
const APlusContentModel = require('../../models/seller-performance/APlusContentModel.js');
// Deprecated: financeModel - replaced by EconomicsMetrics
// const financeModel = require('../../models/finance/listFinancialEventsModel.js');
const restockInventoryRecommendationsModel = require('../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
// Deprecated: TotalSalesModel - replaced by EconomicsMetrics
// const TotalSalesModel = require('../../models/products/TotalSalesModel.js');
const ShipmentModel = require('../../models/inventory/ShipmentModel.js');
const ProductWiseSalesModel = require('../../models/products/ProductWiseSalesModel.js');
// New: EconomicsMetrics model for sales, finance and profitability data
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
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
const { getRankings, BackendKeyWordOrAttributesStatus } = require('../Calculations/Rankings.js');
const {
    checkNumberOfImages,
    checkIfVideoExists,
    checkNumberOfProductReviews,
    checkStarRating,
    checkAPlus,
    checkProductWithOutBuyBox
} = require('../Calculations/Conversion.js');
const ProductWiseSponsoredAdsData = require('../../models/amazon-ads/ProductWiseSponseredAdsModel.js');
const NegetiveKeywords = require('../../models/amazon-ads/NegetiveKeywords.js');
const KeywordModel = require('../../models/amazon-ads/keywordModel.js');
const SearchTerms = require('../../models/amazon-ads/SearchTermsModel.js');
const Campaign = require('../../models/amazon-ads/CampaignModel.js');
const GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA_Model = require('../../models/inventory/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA.js');
const GET_STRANDED_INVENTORY_UI_DATA_Model = require('../../models/inventory/GET_STRANDED_INVENTORY_UI_DATA_MODEL.js');
const GET_FBA_INVENTORY_PLANNING_DATA_Model = require('../../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js');
// Deprecated: FBAFeesModel - replaced by EconomicsMetrics (MCP)
// const FBAFeesModel = require('../../models/finance/FBAFees.js');
const adsKeywordsPerformanceModel = require('../../models/amazon-ads/adsKeywordsPerformanceModel.js');
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

        const createdAccountDate = await userModel.findOne({ _id: userId }).select('createdAt').sort({ createdAt: -1 });
        if (!createdAccountDate) {
            logger.error(new ApiError(404, "User not found"));
            return {
                status: 404,
                message: "User not found"
            }
        }

        // Get seller account data
        const sellerAccountData = await this.getSellerAccountData(userId, country, region, adminId);
        if (!sellerAccountData.success) {
            return {
                status: sellerAccountData.status,
                message: sellerAccountData.message
            };
        }

        const { allSellerAccounts, SellerAccount, sellerCentral } = sellerAccountData;

        // Fetch all data models in parallel
        const allData = await this.fetchAllDataModels(userId, country, region);

        // Process sponsored ads data
        const sponsoredAdsData = this.processSponsoredAdsData(allData.ProductWiseSponsoredAds);

        // Get difference calculation data
        const differenceData = await differenceCalculation(userId, country, region);

        // Create base result object
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

        // Process conversion and ranking data
        const conversionData = this.processConversionData(SellerAccount, allData);
        result.RankingsData = conversionData.rankingsData;
        result.ConversionData = conversionData.conversionData;
        result.Defaulters = conversionData.defaulters;

        // Process inventory analysis
        const inventoryAnalysis = this.processInventoryAnalysis(allData);
        result.InventoryAnalysis = inventoryAnalysis.analysis;
        
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
                const getClientsSellerCentral = await userModel.find({ adminId: adminId }).select('sellerCentral').sort({ createdAt: -1 });
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
        const createdDate = new Date();
        const ThirtyDaysAgo = new Date(createdDate);
        ThirtyDaysAgo.setDate(ThirtyDaysAgo.getDate() - 30);

        // Use .lean() for all queries to return plain JavaScript objects instead of Mongoose documents
        // This significantly reduces memory usage and improves query performance
        const [
            v2Data,
            v1Data,
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
            ppcUnitsSoldData
        ] = await Promise.all([
            V2_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            V1_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            // Use EconomicsMetrics instead of financeModel and TotalSalesModel
            EconomicsMetrics.findLatest(userId, region, country),
            // Fetch BuyBox data
            BuyBoxData.findLatest(userId, region, country),
            restockInventoryRecommendationsModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            numberofproductreviews.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            ListingAllItems.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            APlusContentModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            ShipmentModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            ProductWiseSalesModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            // Optimized: Only fetch the most recent record (limit 1) instead of all 30-day records
            // The sponsoredAds array within the record already contains all the PPC data we need
            ProductWiseSponsoredAdsData.findOne({
                userId,
                country,
                region
            }).sort({ createdAt: -1 }).lean(),
            NegetiveKeywords.findOne({ userId, country, region }).sort({ createdAt: -1 }).lean(),
            KeywordModel.findOne({ userId, country, region }).sort({ createdAt: -1 }).lean(),
            SearchTerms.findOne({ userId, country, region }).sort({ createdAt: -1 }).lean(),
            Campaign.findOne({ userId, country, region }).sort({ createdAt: -1 }).lean(),
            GET_FBA_INVENTORY_PLANNING_DATA_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            GET_STRANDED_INVENTORY_UI_DATA_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            // Deprecated: FBAFeesModel - replaced by EconomicsMetrics (MCP provides ASIN-wise fees)
            Promise.resolve(null), // FBAFeesData - use EconomicsMetrics.asinWiseSales instead
            adsKeywordsPerformanceModel.findOne({ userId, country, region }).sort({ createdAt: -1 }).lean(),
            GetOrderDataModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
            GetDateWisePPCspendModel.findOne({ userId, country, region }).sort({ createdAt: -1 }).lean(),
            AdsGroup.findOne({ userId, country, region }).sort({ createdAt: -1 }).lean(),
            KeywordTrackingModel.findOne({ userId, country, region }).sort({ createdAt: -1 }).lean(),
            PPCUnitsSold.findLatestForUser(userId, country, region)
        ]);
        
        // Convert single ProductWiseSponsoredAds result to array format for backward compatibility
        const ProductWiseSponsoredAdsArray = ProductWiseSponsoredAds ? [ProductWiseSponsoredAds] : [];

        console.log("v2Data: ", v2Data);
        console.log("economicsMetricsData: ", economicsMetricsData ? 'Found' : 'Not Found');
        
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
        const financeData = this.convertEconomicsToFinanceFormat(economicsMetricsData, adsPPCSpend);
        
        // Convert EconomicsMetrics to legacy TotalSales format for backward compatibility
        const TotalSales = this.convertEconomicsToTotalSalesFormat(economicsMetricsData);

        // Log missing data warnings
        const missingDataWarnings = [];
        if (!v2Data) missingDataWarnings.push('v2Data');
        if (!v1Data) missingDataWarnings.push('v1Data');
        if (!economicsMetricsData) missingDataWarnings.push('economicsMetricsData');
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

        // With .lean(), buyBoxData is already a plain object, no need for toObject()
        const buyBoxDataPlain = buyBoxData || null;
        
        return {
            v2Data,
            v1Data,
            financeData,
            economicsMetricsData, // New: raw economics data for profitability calculations
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
            ppcUnitsSoldData
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
     * Convert EconomicsMetrics data to legacy financeData format
     * Uses EconomicsMetrics for sales, fees, refunds but Amazon Ads API for PPC spend
     * @param {Object} economicsMetrics - EconomicsMetrics document
     * @param {number} adsPPCSpend - Total PPC spend from Amazon Ads API (primary source)
     * @returns {Object} Finance data in legacy format
     */
    static convertEconomicsToFinanceFormat(economicsMetrics, adsPPCSpend = 0) {
        if (!economicsMetrics) {
            return {
                createdAt: new Date(),
                Gross_Profit: 0,
                Total_Sales: 0,
                ProductAdsPayment: adsPPCSpend, // Use Ads API PPC spend even if no economics data
                FBA_Fees: 0,
                Storage: 0,
                Amazon_Charges: 0,
                Amazon_Fees: 0,
                Other_Amazon_Fees: 0, // Amazon fees excluding FBA fees (for Total Sales component)
                Refunds: 0
            };
        }

        // Use Amazon Ads API PPC spend as PRIMARY source for ProductAdsPayment
        const ppcSpend = adsPPCSpend || 0;
        
        // CRITICAL: Calculate totalSales by summing datewiseSales for consistency
        // This ensures page load shows same value as custom filter for same dates
        let totalSales = 0;
        let totalGrossProfit = 0;
        let fbaFees = 0;
        let storageFees = 0;
        let refunds = 0;
        
        if (Array.isArray(economicsMetrics.datewiseSales) && economicsMetrics.datewiseSales.length > 0) {
            economicsMetrics.datewiseSales.forEach(item => {
                totalSales += item.sales?.amount || 0;
                totalGrossProfit += item.grossProfit?.amount || 0;
            });
            // Round to 2 decimal places for consistency
            totalSales = parseFloat(totalSales.toFixed(2));
            totalGrossProfit = parseFloat(totalGrossProfit.toFixed(2));
        } else {
            // Fallback to stored value if datewiseSales not available
            totalSales = economicsMetrics.totalSales?.amount || 0;
            totalGrossProfit = economicsMetrics.grossProfit?.amount || 0;
        }
        
        // Calculate fees from datewise data for consistency
        if (Array.isArray(economicsMetrics.datewiseFeesAndRefunds) && economicsMetrics.datewiseFeesAndRefunds.length > 0) {
            economicsMetrics.datewiseFeesAndRefunds.forEach(item => {
                fbaFees += item.fbaFulfillmentFee?.amount || 0;
                storageFees += item.storageFee?.amount || 0;
                refunds += item.refunds?.amount || 0;
            });
            fbaFees = parseFloat(fbaFees.toFixed(2));
            storageFees = parseFloat(storageFees.toFixed(2));
            refunds = parseFloat(refunds.toFixed(2));
        } else {
            // Fallback to stored values
            fbaFees = economicsMetrics.fbaFees?.amount || 0;
            storageFees = economicsMetrics.storageFees?.amount || 0;
            refunds = economicsMetrics.refunds?.amount || 0;
        }
        
        // Get Amazon fees - calculate from datewiseAmazonFees for consistency
        let amazonFees = 0;
        if (Array.isArray(economicsMetrics.datewiseAmazonFees) && economicsMetrics.datewiseAmazonFees.length > 0) {
            // PRIMARY: Calculate from datewiseAmazonFees (most accurate)
            economicsMetrics.datewiseAmazonFees.forEach(item => {
                amazonFees += item.totalAmount?.amount || 0;
            });
            amazonFees = parseFloat(amazonFees.toFixed(2));
            logger.info('Calculated amazonFees from datewiseAmazonFees', {
                amazonFees,
                dateCount: economicsMetrics.datewiseAmazonFees.length
            });
        } else {
            // Fallback 1: Get from summary level
            amazonFees = economicsMetrics.amazonFees?.amount || 0;
            
            // Fallback 2: Calculate from ASIN-wise data if still 0
            if (amazonFees === 0 && Array.isArray(economicsMetrics.asinWiseSales) && economicsMetrics.asinWiseSales.length > 0) {
                economicsMetrics.asinWiseSales.forEach(item => {
                    amazonFees += item.amazonFees?.amount || item.totalFees?.amount || 0;
                });
                amazonFees = parseFloat(amazonFees.toFixed(2));
                logger.info('Calculated amazonFees from ASIN-wise data', {
                    amazonFees,
                    asinCount: economicsMetrics.asinWiseSales.length
                });
            }
            
            // Final fallback: use fbaFees + storageFees if still 0
            if (amazonFees === 0) {
                amazonFees = fbaFees + storageFees;
            }
        }
        
        // Calculate gross profit: Sales - Amazon Fees - Refunds
        // Note: PPC is subtracted in frontend for display, not in backend calculation
        const grossProfit = totalSales - amazonFees - refunds;
        
        // Calculate Other Amazon Fees = Total Amazon Fees - FBA Fees (for Total Sales component)
        const otherAmazonFees = Math.max(0, amazonFees - fbaFees);

        return {
            createdAt: economicsMetrics.createdAt || new Date(),
            Gross_Profit: parseFloat(grossProfit.toFixed(2)),
            Total_Sales: totalSales,
            ProductAdsPayment: ppcSpend, // PRIMARY: Amazon Ads API PPC spend
            FBA_Fees: fbaFees,
            Storage: storageFees,
            Amazon_Charges: amazonFees, // Total Amazon fees (for Profitability page)
            Amazon_Fees: amazonFees, // Total Amazon fees (FBA, storage, referral, etc.)
            Other_Amazon_Fees: parseFloat(otherAmazonFees.toFixed(2)), // Amazon fees excluding FBA (for Total Sales component)
            Refunds: refunds
        };
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
                            formattedDate: this.formatDate(dateForData),
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
                            formattedDate: this.formatDate(dateForData),
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
     * Format date helper
     */
    static formatDate(date) {
        const dte = new Date(date);
        const Day = String(dte.getDate()).padStart(2, '0');
        const Month = dte.toLocaleString('default', { month: 'short' });
        return `${Day} ${Month}`;
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
            Gross_Profit: 0,
            Total_Sales: 0,
            ProductAdsPayment: 0,
            FBA_Fees: 0,
            Storage: 0,
            Amazon_Charges: 0,
            Refunds: 0
        };

        const financeCreatedDate = safeFinanceData.createdAt;
        const financeThirtyDaysAgo = new Date(financeCreatedDate);
        financeThirtyDaysAgo.setDate(financeThirtyDaysAgo.getDate() - 30);

        // Get economics metrics for ASIN-wise data (profitability, ACOS/TACOS calculations)
        const economicsMetrics = allData.economicsMetricsData;

        // Get calendar dates from DataFetchTracking (PRIMARY source - no calculation, just from database)
        // This tracks when calendar-affecting services actually ran
        let dataStartDate = null;
        let dataEndDate = null;
        let trackingInfo = null;
        
        try {
            const latestTracking = await DataFetchTracking.findLatest(userId, country, region);
            if (latestTracking && latestTracking.dataRange) {
                dataStartDate = latestTracking.dataRange.startDate;
                dataEndDate = latestTracking.dataRange.endDate;
                trackingInfo = {
                    fetchedAt: latestTracking.fetchedAt,
                    dayName: latestTracking.dayName,
                    dateString: latestTracking.dateString,
                    timeString: latestTracking.timeString
                };
                logger.info('Calendar dates from DataFetchTracking:', {
                    startDate: dataStartDate,
                    endDate: dataEndDate,
                    fetchedAt: latestTracking.fetchedAt,
                    dayName: latestTracking.dayName
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
                accountHealth: checkAccountHealth(allData.v2Data, allData.v1Data)
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
                dateRange: allData.buyBoxData.dateRange
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
            belongsToRequester: (item.buyBoxPercentage || 0) > 0
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

        const AmazonReadyProductsSet = new Set();
        const imageResultArray = [], videoResultArray = [], productReviewResultArray = [], 
              productStarRatingResultArray = [], RankingResultArray = [], BackendKeywordResultArray = [];

        safeProductReviews.Products.forEach(product => {
            if (!DefaulterList.ProductReviews.includes(product.asin)) {
                const imageResult = checkNumberOfImages(product.product_photos);
                const videoResult = checkIfVideoExists(product.video_url);
                const productReviewResult = checkNumberOfProductReviews(product.product_num_ratings);
                const productStarRatingResult = checkStarRating(product.product_star_ratings);
                const rankings = getRankings(product);

                if (rankings.TotalErrors === 0 && 
                    [imageResult, videoResult, productReviewResult, productStarRatingResult].every(r => r.status === "Success")) {
                    AmazonReadyProductsSet.add(product.asin);
                }

                imageResultArray.push({ asin: product.asin, data: imageResult });
                videoResultArray.push({ asin: product.asin, data: videoResult });
                productReviewResultArray.push({ asin: product.asin, data: productReviewResult });
                productStarRatingResultArray.push({ asin: product.asin, data: productStarRatingResult });
                RankingResultArray.push({ asin: product.asin, data: rankings.finalResult });
            }
        });

        safeListingItems.GenericKeyword.forEach(item => {
            const asin = item.asin;
            if (!DefaulterList.ListingAllItems.includes(asin)) {
                const keywordStatus = BackendKeyWordOrAttributesStatus(item.value);
                if (keywordStatus.NumberOfErrors === 0) AmazonReadyProductsSet.add(asin);
                else AmazonReadyProductsSet.delete(asin);
                BackendKeywordResultArray.push({ asin, data: keywordStatus });
            }
        });

        const aplusProducts = safeAplusResponse.ApiContentDetails;
        const aPlusArray = checkAPlus(aplusProducts);

        return {
            rankingsData: {
                RankingResultArray,
                BackendKeywordResultArray
            },
            conversionData: {
                imageResult: imageResultArray,
                videoResult: videoResultArray,
                productReviewResult: productReviewResultArray,
                productStarRatingResult: productStarRatingResultArray,
                aPlusResult: aPlusArray,
                ProductWithOutBuybox: checkProductWithOutBuyBox(buyBoxProducts).buyboxResult,
                AmazonReadyproducts: Array.from(AmazonReadyProductsSet)
            },
            defaulters: DefaulterList
        };
    }

    /**
     * Process inventory analysis
     */
    static processInventoryAnalysis(allData) {
        const inventoryAnalysis = {
            inventoryPlanning: [],
            strandedInventory: [],
            inboundNonCompliance: [],
            replenishment: []
        };

        // Create safe defaults for inventory data
        const safeInventoryPlanningData = allData.inventoryPlanningData || { data: [] };
        const safeInventoryStrandedData = allData.inventoryStrandedData || { strandedUIData: [] };
        const safeInboundNonComplianceData = allData.inboundNonComplianceData || { ErrorData: [] };
        const safeRestockData = allData.restockInventoryRecommendationsData || { Products: [] };

        // Process Inventory Planning Data for each ASIN
        if (safeInventoryPlanningData.data && Array.isArray(safeInventoryPlanningData.data)) {
            safeInventoryPlanningData.data.forEach(item => {
                if (item && item.asin) {
                    try {
                        const planningResult = processInventoryPlanningData(item);
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
                                const strandedResult = processInventoryStrandedData(item);
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
            ...conversionData.conversionData.productReviewResult.filter(item => item && item.data && item.data.status === "Error"),
            ...conversionData.conversionData.productStarRatingResult.filter(item => item && item.data && item.data.status === "Error"),
            ...conversionData.conversionData.aPlusResult.filter(item => item && item.status === "Error")
        ];
        totalErrorsAllCategories += conversionErrors.length;

        // Count ranking errors
        const rankingErrors = conversionData.rankingsData.RankingResultArray.reduce((count, item) => {
            return count + ((item && item.data && item.data.TotalErrors) || 0);
        }, 0);
        totalErrorsAllCategories += rankingErrors;

        // Count backend keyword errors
        const keywordErrors = conversionData.rankingsData.BackendKeywordResultArray.reduce((count, item) => {
            return count + ((item && item.data && item.data.NumberOfErrors) || 0);
        }, 0);
        totalErrorsAllCategories += keywordErrors;

        // Count buybox errors
        const buyboxErrors = conversionData.conversionData.ProductWithOutBuybox.filter(item => item && item.data && item.data.status === "Error").length;
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

        // For custom date ranges, use OrderAndRevenue model to calculate gross sales
        if (periodType === 'custom' || periodType === 'last7' || periodType === 'thisMonth' || periodType === 'lastMonth') {
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
     * Uses EconomicsMetrics for accurate fee and gross profit data
     * 
     * IMPORTANT: If the custom date range exactly matches the stored date range in the latest document,
     * we return the pre-aggregated totals to ensure consistency with the default "Last 30 Days" view.
     * This prevents discrepancies between default and custom views for the same date range.
     */
    static async processCustomDateRange(userId, country, region, start, end, daysDifference) {
        try {
            logger.info(`Processing custom date range: ${daysDifference} days from ${start.toISOString()} to ${end.toISOString()}`);

            // Format dates for comparison with EconomicsMetrics data
            const formatDateStr = (date) => {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };

            // Get EconomicsMetrics data (primary source for fees and gross profit)
            const allMetrics = await EconomicsMetrics.find({
                User: userId,
                country: country,
                region: region
            }).sort({ createdAt: -1 });

            // If no metrics found, return empty result early
            if (!allMetrics || allMetrics.length === 0) {
                logger.warn('No EconomicsMetrics found for custom date range', { userId, country, region });
                return {
                    status: 200,
                    message: {
                        startDate: formatDateStr(start),
                        endDate: formatDateStr(end),
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

            // Get the latest metrics document
            const latestMetrics = allMetrics[0];
            
            // Check if the custom date range exactly matches the stored date range in the latest document
            // If it does, return the pre-aggregated totals for consistency with default view
            const storedStartDate = latestMetrics.dateRange?.startDate;
            const storedEndDate = latestMetrics.dateRange?.endDate;
            
            if (storedStartDate && storedEndDate) {
                const storedStart = new Date(storedStartDate);
                storedStart.setHours(0, 0, 0, 0);
                const storedEnd = new Date(storedEndDate);
                storedEnd.setHours(0, 0, 0, 0);
                
                const requestedStart = new Date(start);
                requestedStart.setHours(0, 0, 0, 0);
                const requestedEnd = new Date(end);
                requestedEnd.setHours(0, 0, 0, 0);
                
                // Compare dates (ignoring time)
                const datesMatch = storedStart.getTime() === requestedStart.getTime() && 
                                  storedEnd.getTime() === requestedEnd.getTime();
                
                if (datesMatch) {
                    logger.info('Custom date range matches stored date range - using pre-aggregated totals for consistency', {
                        userId,
                        country,
                        region,
                        requestedRange: { startDate: formatDateStr(start), endDate: formatDateStr(end) },
                        storedRange: { startDate: storedStartDate, endDate: storedEndDate }
                    });
                    
                    // Get currency code
                    const currencyCode = latestMetrics.totalSales?.currencyCode || 'USD';
                    
                    // Build dateWiseSales from datewiseSales array for chart display
                    const datewiseSalesArr = latestMetrics.datewiseSales || [];
                    const dateWiseSales = datewiseSalesArr.map(item => {
                        const itemDate = new Date(item.date);
                        return {
                            interval: itemDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                            TotalAmount: item.sales?.amount || 0,
                            Profit: parseFloat((item.grossProfit?.amount || 0).toFixed(2)),
                            date: item.date
                        };
                    }).sort((a, b) => new Date(a.date) - new Date(b.date));
                    
                    // Return pre-aggregated totals from the latest document (same as default view)
                    return {
                        status: 200,
                        message: {
                            startDate: storedStartDate,
                            endDate: storedEndDate,
                            Country: country,
                            FinanceData: {
                                Gross_Profit: parseFloat((latestMetrics.grossProfit?.amount || 0).toFixed(2)),
                                ProductAdsPayment: parseFloat((latestMetrics.ppcSpent?.amount || 0).toFixed(2)),
                                FBA_Fees: parseFloat((latestMetrics.fbaFees?.amount || 0).toFixed(2)),
                                Storage: parseFloat((latestMetrics.storageFees?.amount || 0).toFixed(2)),
                                Amazon_Charges: parseFloat(((latestMetrics.fbaFees?.amount || 0) + (latestMetrics.storageFees?.amount || 0)).toFixed(2)),
                                Refunds: parseFloat((latestMetrics.refunds?.amount || 0).toFixed(2))
                            },
                            reimburstmentData: 0, // Not calculated for custom periods
                            TotalSales: {
                                totalSales: parseFloat((latestMetrics.totalSales?.amount || 0).toFixed(2)),
                                dateWiseSales: dateWiseSales
                            },
                            GetOrderData: [] // Will be populated separately if needed
                        }
                    };
                }
            }
            
            // Date range doesn't match - proceed with datewise aggregation
            logger.info('Custom date range differs from stored range - calculating from datewise data', {
                userId,
                country,
                region,
                requestedRange: { startDate: formatDateStr(start), endDate: formatDateStr(end) },
                storedRange: { startDate: storedStartDate, endDate: storedEndDate }
            });

            // Initialize financial data
            let financialEvents = {
                ProductAdsPayment: 0,
                FBA_Fees: 0,
                Amazon_Charges: 0,
                Refunds: 0,
                Storage: 0
            };

            let totalSales = 0;
            let totalGrossProfit = 0;
            let currencyCode = latestMetrics.totalSales?.currencyCode || 'USD';
            const processedDates = new Set();
            const dateWiseSales = [];

            // Process EconomicsMetrics data - build a map of date -> grossProfit from datewiseGrossProfit array
            const grossProfitByDate = new Map();
            const processedGrossProfitDates = new Set();

            for (const metrics of allMetrics) {
                    // Get currency code
                    if (metrics.totalSales?.currencyCode) {
                        currencyCode = metrics.totalSales.currencyCode;
                    }

                    // First, build gross profit map from datewiseGrossProfit (the dedicated array)
                    const datewiseGrossProfitArr = metrics.datewiseGrossProfit || [];
                    datewiseGrossProfitArr.forEach(item => {
                        const itemDate = new Date(item.date);
                        const dateKey = itemDate.toISOString().split('T')[0];

                        // Only process if within range and not already processed
                        if (itemDate >= start && itemDate <= end && !processedGrossProfitDates.has(dateKey)) {
                            const profitAmount = item.grossProfit?.amount || 0;
                            grossProfitByDate.set(dateKey, profitAmount);
                            totalGrossProfit += profitAmount;
                            processedGrossProfitDates.add(dateKey);
                        }
                    });

                    // Process datewise sales (for sales amounts)
                    const datewiseSalesArr = metrics.datewiseSales || [];
                    datewiseSalesArr.forEach(item => {
                        const itemDate = new Date(item.date);
                        const dateKey = itemDate.toISOString().split('T')[0];

                        // Only process if within range and not already processed
                        if (itemDate >= start && itemDate <= end && !processedDates.has(dateKey)) {
                            const salesAmount = item.sales?.amount || 0;
                            totalSales += salesAmount;
                            processedDates.add(dateKey);

                            // Get gross profit from the dedicated datewiseGrossProfit map
                            const grossProfitAmount = grossProfitByDate.get(dateKey) || 0;

                            // Add to dateWiseSales array for chart
                            dateWiseSales.push({
                                date: itemDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                                totalSales: salesAmount,
                                grossProfit: grossProfitAmount,
                                originalDate: item.date
                            });
                        }
                    });

                    // Process datewise fees and refunds
                    const datewiseFeesAndRefunds = metrics.datewiseFeesAndRefunds || [];
                    const processedFeeDates = new Set();
                    datewiseFeesAndRefunds.forEach(item => {
                        const itemDate = new Date(item.date);
                        const dateKey = itemDate.toISOString().split('T')[0];

                        // Only process if within range and not already processed for fees
                        if (itemDate >= start && itemDate <= end && !processedFeeDates.has(dateKey)) {
                            financialEvents.FBA_Fees += item.fbaFulfillmentFee?.amount || 0;
                            financialEvents.Storage += item.storageFee?.amount || 0;
                            financialEvents.Refunds += item.refunds?.amount || 0;
                            processedFeeDates.add(dateKey);
                        }
                    });

                    // Calculate proportional PPC spent based on date range overlap
                    if (metrics.dateRange?.startDate && metrics.dateRange?.endDate) {
                        const docStartDate = new Date(metrics.dateRange.startDate);
                        const docEndDate = new Date(metrics.dateRange.endDate);
                        docStartDate.setHours(0, 0, 0, 0);
                        docEndDate.setHours(23, 59, 59, 999);

                        // Check for overlap
                        if (start <= docEndDate && end >= docStartDate) {
                            const overlapStart = new Date(Math.max(start.getTime(), docStartDate.getTime()));
                            const overlapEnd = new Date(Math.min(end.getTime(), docEndDate.getTime()));
                            const overlapDays = Math.ceil((overlapEnd - overlapStart + 1) / (1000 * 60 * 60 * 24));
                            const docTotalDays = Math.ceil((docEndDate - docStartDate + 1) / (1000 * 60 * 60 * 24));
                            
                            if (docTotalDays > 0) {
                                const proportion = Math.min(overlapDays / docTotalDays, 1);
                                financialEvents.ProductAdsPayment += (metrics.ppcSpent?.amount || 0) * proportion;
                            }
                        }
                    }
            }

            // Amazon_Charges is the sum of FBA fees and storage fees
            financialEvents.Amazon_Charges = financialEvents.FBA_Fees + financialEvents.Storage;

            logger.info(`Processed EconomicsMetrics: Sales dates: ${processedDates.size}, GrossProfit dates: ${processedGrossProfitDates.size}`);

            // Sort dateWiseSales by date
            dateWiseSales.sort((a, b) => new Date(a.originalDate) - new Date(b.originalDate));

            // If we don't have EconomicsMetrics data, fall back to order data
            if (processedDates.size === 0) {
                logger.info('No EconomicsMetrics data found, falling back to order data');
                
                // Get all order data documents from OrderAndRevenue model
                const orderDataDocuments = await GetOrderDataModel.find({
                    User: userId,
                    country,
                    region
                }).sort({ createdAt: -1 });

                if (orderDataDocuments && orderDataDocuments.length > 0) {
                    const validOrderStatuses = ["Shipped", "Unshipped", "Pending"];
                    let allOrders = [];

                    orderDataDocuments.forEach(orderData => {
                        if (orderData && orderData.RevenueData && Array.isArray(orderData.RevenueData)) {
                            allOrders = allOrders.concat(orderData.RevenueData);
                        }
                    });

                    const filteredOrders = allOrders.filter(order => {
                        const orderDate = new Date(order.orderDate);
                        orderDate.setHours(0, 0, 0, 0);
                        const hasValidStatus = validOrderStatuses.includes(order.orderStatus);
                        const isInDateRange = orderDate >= start && orderDate <= end;
                        return hasValidStatus && isInDateRange;
                    });

                    logger.info(`Found ${filteredOrders.length} valid orders in the date range (fallback)`);

                    let grossSales = 0;
                    let totalDiscounts = 0;
                    const processedOrderIds = new Set();
                    const dateToSales = new Map();

                    filteredOrders.forEach((order) => {
                        if (processedOrderIds.has(order.amazonOrderId)) return;
                        processedOrderIds.add(order.amazonOrderId);

                        const itemPrice = Number(order.itemPrice || 0);
                        const itemDiscount = Number(order.itemPromotionDiscount || 0);
                        const shippingDiscount = Number(order.shippingPromotionDiscount || 0);

                        grossSales += itemPrice;
                        totalDiscounts += (itemDiscount + shippingDiscount);

                        // Group by date
                        const orderDate = new Date(order.orderDate);
                        orderDate.setHours(0, 0, 0, 0);
                        const dateKey = orderDate.toDateString();

                        if (!dateToSales.has(dateKey)) {
                            dateToSales.set(dateKey, { total: 0, discounts: 0 });
                        }
                        const dayData = dateToSales.get(dateKey);
                        dayData.total += itemPrice;
                        dayData.discounts += (itemDiscount + shippingDiscount);
                    });

                    totalSales = grossSales - totalDiscounts;
                    // For fallback, we can't calculate accurate gross profit without fee data
                    // Set a warning that this is estimated
                    totalGrossProfit = totalSales * 0.7; // Rough estimate: 70% of sales as profit

                    // Create dateWiseSales from order data
                    dateToSales.forEach((dayData, dateKey) => {
                        const date = new Date(dateKey);
                        const dailySales = dayData.total - dayData.discounts;
                        dateWiseSales.push({
                            date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                            totalSales: dailySales,
                            grossProfit: dailySales * 0.7, // Estimated
                            originalDate: date.toISOString().split('T')[0]
                        });
                    });

                    dateWiseSales.sort((a, b) => new Date(a.originalDate) - new Date(b.originalDate));
                }
            }

            logger.info(`Final Total Sales: ${totalSales}, Gross Profit: ${totalGrossProfit}, FBA Fees: ${financialEvents.FBA_Fees}, Storage: ${financialEvents.Storage}, Refunds: ${financialEvents.Refunds}`);

            // Convert dateWiseSales to expected format with interval, TotalAmount, Profit
            const formattedDateWiseSales = dateWiseSales.map(item => ({
                interval: item.date,
                TotalAmount: item.totalSales,
                Profit: parseFloat(item.grossProfit.toFixed(2)),
                date: item.originalDate
            }));

            const result = {
                startDate: this.formatDate(start),
                endDate: this.formatDate(end),
                Country: country,
                FinanceData: {
                    Gross_Profit: parseFloat(totalGrossProfit.toFixed(2)),
                    ProductAdsPayment: parseFloat(financialEvents.ProductAdsPayment.toFixed(2)),
                    FBA_Fees: parseFloat(financialEvents.FBA_Fees.toFixed(2)),
                    Storage: parseFloat(financialEvents.Storage.toFixed(2)),
                    Amazon_Charges: parseFloat(financialEvents.Amazon_Charges.toFixed(2)),
                    Refunds: parseFloat(financialEvents.Refunds.toFixed(2))
                },
                reimburstmentData: 0, // Not calculated for custom periods
                TotalSales: {
                    totalSales: parseFloat(totalSales.toFixed(2)),
                    dateWiseSales: formattedDateWiseSales
                }
            };

            logger.info(`Custom date range calculation completed successfully`);
            return {
                status: 200,
                message: result
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

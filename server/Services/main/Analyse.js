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
        const result = this.createBaseResult({
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
            keywordTrackingData
        ] = await Promise.all([
            V2_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            V1_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            // Use EconomicsMetrics instead of financeModel and TotalSalesModel
            EconomicsMetrics.findLatest(userId, region, country),
            // Fetch BuyBox data
            BuyBoxData.findLatest(userId, region, country),
            restockInventoryRecommendationsModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            numberofproductreviews.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            ListingAllItems.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            APlusContentModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            ShipmentModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            ProductWiseSalesModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            ProductWiseSponsoredAdsData.find({
                userId,
                country,
                region,
                createdAt: {
                    $gte: ThirtyDaysAgo,
                    $lte: createdDate
                }
            }).sort({ createdAt: -1 }),
            NegetiveKeywords.findOne({ userId, country, region }).sort({ createdAt: -1 }),
            KeywordModel.findOne({ userId, country, region }).sort({ createdAt: -1 }),
            SearchTerms.findOne({ userId, country, region }).sort({ createdAt: -1 }),
            Campaign.findOne({ userId, country, region }).sort({ createdAt: -1 }),
            GET_FBA_INVENTORY_PLANNING_DATA_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            GET_STRANDED_INVENTORY_UI_DATA_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            // Deprecated: FBAFeesModel - replaced by EconomicsMetrics (MCP provides ASIN-wise fees)
            Promise.resolve(null), // FBAFeesData - use EconomicsMetrics.asinWiseSales instead
            adsKeywordsPerformanceModel.findOne({ userId, country, region }).sort({ createdAt: -1 }),
            GetOrderDataModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
            GetDateWisePPCspendModel.findOne({ userId, country, region }).sort({ createdAt: -1 }),
            AdsGroup.findOne({ userId, country, region }).sort({ createdAt: -1 }),
            KeywordTrackingModel.findOne({ userId, country, region }).sort({ createdAt: -1 })
        ]);

        console.log("v2Data: ", v2Data);
        console.log("economicsMetricsData: ", economicsMetricsData ? 'Found' : 'Not Found');
        console.log("buyBoxData: ", buyBoxData ? {
            found: true,
            totalProducts: buyBoxData.totalProducts,
            productsWithoutBuyBox: buyBoxData.productsWithoutBuyBox,
            asinBuyBoxDataCount: buyBoxData.asinBuyBoxData?.length || 0,
            hasAsinBuyBoxData: !!buyBoxData.asinBuyBoxData
        } : 'Not Found');

        // Calculate total PPC spend from Amazon Ads API (PRIMARY source)
        const adsPPCSpend = this.calculateTotalPPCSpendFromAdsAPI(ProductWiseSponsoredAds);
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

        // Convert Mongoose documents to plain objects if needed
        const buyBoxDataPlain = buyBoxData ? (buyBoxData.toObject ? buyBoxData.toObject() : buyBoxData) : null;
        
        return {
            v2Data,
            v1Data,
            financeData,
            economicsMetricsData, // New: raw economics data for profitability calculations
            buyBoxData: buyBoxDataPlain, // Convert to plain object for easier access
            restockInventoryRecommendationsData,
            numberOfProductReviews,
            GetlistingAllItems,
            aplusResponse,
            TotalSales,
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
            keywordTrackingData
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
                Refunds: 0
            };
        }

        // Use Amazon Ads API PPC spend as PRIMARY source for ProductAdsPayment
        const ppcSpend = adsPPCSpend || 0;
        
        // Calculate gross profit using: Sales - FBA Fees - Storage Fees - PPC Spend (from Ads API) - Refunds
        const totalSales = economicsMetrics.totalSales?.amount || 0;
        const fbaFees = economicsMetrics.fbaFees?.amount || 0;
        const storageFees = economicsMetrics.storageFees?.amount || 0;
        const refunds = economicsMetrics.refunds?.amount || 0;
        
        // Recalculate gross profit with Ads API PPC spend
        const grossProfit = totalSales - fbaFees - storageFees - ppcSpend - refunds;

        return {
            createdAt: economicsMetrics.createdAt || new Date(),
            Gross_Profit: parseFloat(grossProfit.toFixed(2)),
            Total_Sales: totalSales,
            ProductAdsPayment: ppcSpend, // PRIMARY: Amazon Ads API PPC spend
            FBA_Fees: fbaFees,
            Storage: storageFees,
            Amazon_Charges: fbaFees + storageFees,
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
    static createBaseResult(params) {
        const {
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

        return {
            createdAccountDate: createdAccountDate,
            Brand: sellerCentral.brand,
            AllSellerAccounts: allSellerAccounts,
            startDate: this.formatDate(financeThirtyDaysAgo),
            endDate: this.formatDate(financeCreatedDate),
            Country: country,
            TotalProducts: SellerAccount.products,
            AccountData: {
                getAccountHealthPercentge: allData.v2Data === null
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
                refunds: economicsMetrics.refunds,
                datewiseSales: economicsMetrics.datewiseSales,
                datewiseGrossProfit: economicsMetrics.datewiseGrossProfit,
                asinWiseSales: economicsMetrics.asinWiseSales,
                dateRange: economicsMetrics.dateRange
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
            SalesByProducts: (allData.saleByProduct || { productWiseSales: [] }).productWiseSales
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
     */
    static async processCustomDateRange(userId, country, region, start, end, daysDifference) {
        try {
            logger.info(`Processing custom date range: ${daysDifference} days from ${start.toISOString()} to ${end.toISOString()}`);

            // Get all order data documents from OrderAndRevenue model
            const orderDataDocuments = await GetOrderDataModel.find({
                User: userId,
                country,
                region
            }).sort({ createdAt: -1 });

            if (!orderDataDocuments || orderDataDocuments.length === 0) {
                logger.warn("No order data found for custom date range calculation");
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

            // Collect all orders from all documents and filter based on date range and valid statuses
            const validOrderStatuses = ["Shipped", "Unshipped", "Pending"];
            let allOrders = [];

            // Iterate through all order data documents
            orderDataDocuments.forEach(orderData => {
                if (orderData && orderData.RevenueData && Array.isArray(orderData.RevenueData)) {
                    allOrders = allOrders.concat(orderData.RevenueData);
                }
            });

            // Filter orders based on date range and valid statuses
            const filteredOrders = allOrders.filter(order => {
                const orderDate = new Date(order.orderDate);
                orderDate.setHours(0, 0, 0, 0); // Normalize to start of day
                const hasValidStatus = validOrderStatuses.includes(order.orderStatus);
                const isInDateRange = orderDate >= start && orderDate <= end;

                return hasValidStatus && isInDateRange;
            });

            logger.info(`Found ${filteredOrders.length} valid orders in the date range`);

            // Calculate gross sales from filtered orders
            let grossSales = 0;
            let totalDiscounts = 0;
            let itemPromotionDiscountsTotal = 0;
            let shippingPromotionDiscountsTotal = 0;
            const processedOrderIds = new Set();

            filteredOrders.forEach((order, index) => {
                // Skip duplicate orders
                if (processedOrderIds.has(order.amazonOrderId)) return;
                processedOrderIds.add(order.amazonOrderId);

                // Calculate gross sales - simplified logic
                // Assume itemPrice is the total price for the quantity ordered
                grossSales += Number(order.itemPrice || 0);

                // Calculate discounts
                const itemPromotionDiscount = Number(order.itemPromotionDiscount || 0);
                const shippingPromotionDiscount = Number(order.shippingPromotionDiscount || 0);

                itemPromotionDiscountsTotal += itemPromotionDiscount;
                shippingPromotionDiscountsTotal += shippingPromotionDiscount;
                totalDiscounts += (itemPromotionDiscount + shippingPromotionDiscount);
            });

            // Apply discount subtraction from gross sales
            const salesAfterDiscounts = grossSales - totalDiscounts;

            logger.info(`Gross Sales: ${grossSales}, Total Discounts: ${totalDiscounts}, Sales After Discounts: ${salesAfterDiscounts}`);

            // Get financial data from WeeklyFinanceModel based on custom date range
            const weeklyFinanceData = await WeeklyFinanceModel.findOne({
                User: userId,
                country,
                region
            }).sort({ createdAt: -1 });

            let financialEvents = {
                ProductAdsPayment: 0,
                FBA_Fees: 0,
                Amazon_Charges: 0,
                Refunds: 0,
                Storage: 0
            };

            if (weeklyFinanceData && weeklyFinanceData.weeklyFinanceData) {
                const sections = [
                    { name: 'FirstSevenDays', data: weeklyFinanceData.weeklyFinanceData.FirstSevenDays },
                    { name: 'SecondSevenDays', data: weeklyFinanceData.weeklyFinanceData.SecondSevenDays },
                    { name: 'ThirdSevenDays', data: weeklyFinanceData.weeklyFinanceData.ThirdSevenDays },
                    { name: 'FourthNineDays', data: weeklyFinanceData.weeklyFinanceData.FourthNineDays }
                ];

                // Calculate financial data based on overlapping periods
                sections.forEach((section, index) => {
                    if (section.data && section.data.startDate && section.data.endDate) {
                        const sectionStartDate = new Date(section.data.startDate);
                        const sectionEndDate = new Date(section.data.endDate);

                        // Set times for accurate comparison
                        sectionStartDate.setHours(0, 0, 0, 0);
                        sectionEndDate.setHours(23, 59, 59, 999);

                        // Check if there's any overlap between the custom date range and the section date range
                        const hasOverlap = (start <= sectionEndDate && end >= sectionStartDate);

                        if (hasOverlap) {
                            const sectionData = section.data;

                            // Calculate the proportion of overlap
                            const overlapStart = new Date(Math.max(start.getTime(), sectionStartDate.getTime()));
                            const overlapEnd = new Date(Math.min(end.getTime(), sectionEndDate.getTime()));

                            // Add 1 to include both start and end dates
                            const overlapDays = Math.ceil((overlapEnd - overlapStart + 1) / (1000 * 60 * 60 * 24));
                            const sectionDays = Math.ceil((sectionEndDate - sectionStartDate + 1) / (1000 * 60 * 60 * 24));
                            const proportion = Math.min(overlapDays / sectionDays, 1);

                            // Apply proportional values
                            financialEvents.ProductAdsPayment += Number(sectionData.ProductAdsPayment || 0) * proportion;
                            financialEvents.FBA_Fees += Number(sectionData.FBA_Fees || 0) * proportion;
                            financialEvents.Amazon_Charges += Number(sectionData.Amazon_Charges || 0) * proportion;
                            financialEvents.Refunds += Number(sectionData.Refunds || 0) * proportion;
                            financialEvents.Storage += Number(sectionData.Storage || 0) * proportion;

                            logger.info(`Section ${section.name}: Overlap ${overlapDays}/${sectionDays} days (${(proportion * 100).toFixed(1)}%)`);
                        }
                    }
                });
            }

            // Calculate final total sales after subtracting refunds
            const finalTotalSales = salesAfterDiscounts;

            // Calculate gross profit
            const grossProfit = finalTotalSales - (
                financialEvents.ProductAdsPayment +
                financialEvents.FBA_Fees +
                financialEvents.Amazon_Charges +
                financialEvents.Storage +
                financialEvents.Refunds
            );

            logger.info(`Final Total Sales: ${finalTotalSales}, Gross Profit: ${grossProfit}`);

            // Create date-wise sales array for the custom date range
            const dateWiseSales = [];
            const dateToSales = new Map(); // Use Map to aggregate sales by date

            // Group orders by date
            filteredOrders.forEach(order => {
                const orderDate = new Date(order.orderDate);
                orderDate.setHours(0, 0, 0, 0);
                const dateKey = orderDate.toDateString();

                if (!dateToSales.has(dateKey)) {
                    dateToSales.set(dateKey, {
                        total: 0,
                        discounts: 0,
                        orders: []
                    });
                }

                const dayData = dateToSales.get(dateKey);
                dayData.total += Number(order.itemPrice || 0);
                dayData.discounts += Number(order.itemPromotionDiscount || 0) + Number(order.shippingPromotionDiscount || 0);
                dayData.orders.push(order);
            });

            // Calculate total fees for proportional distribution
            const totalFees = financialEvents.ProductAdsPayment +
                            financialEvents.FBA_Fees +
                            financialEvents.Amazon_Charges +
                            financialEvents.Storage +
                            financialEvents.Refunds;

            // Calculate total sales for proportional fee distribution
            let totalSalesForDistribution = 0;
            dateToSales.forEach((dayData) => {
                totalSalesForDistribution += (dayData.total - dayData.discounts);
            });

            // If no sales, distribute fees evenly across all days
            const distributeEvenly = totalSalesForDistribution === 0;

            // Create entries for all dates in range
            for (let i = 0; i < daysDifference; i++) {
                const currentDate = new Date(start);
                currentDate.setDate(currentDate.getDate() + i);
                currentDate.setHours(0, 0, 0, 0);

                const dateKey = currentDate.toDateString();
                const dayData = dateToSales.get(dateKey) || { total: 0, discounts: 0 };

                const daySales = dayData.total - dayData.discounts;
                
                // Calculate fees for this day (proportional to sales or evenly distributed)
                let dayFees = 0;
                if (distributeEvenly) {
                    dayFees = totalFees / daysDifference;
                } else if (totalSalesForDistribution > 0) {
                    const salesProportion = daySales / totalSalesForDistribution;
                    dayFees = totalFees * salesProportion;
                }

                // Calculate profit for this day
                const dayProfit = daySales - dayFees;

                const dayEntry = {
                    interval: this.formatDate(currentDate),
                    TotalAmount: daySales,
                    Profit: parseFloat(dayProfit.toFixed(2)),
                    Fees: parseFloat(dayFees.toFixed(2)),
                    date: currentDate.toISOString().split('T')[0] // Add ISO date for easier parsing
                };

                dateWiseSales.push(dayEntry);
            }

            const result = {
                startDate: this.formatDate(start),
                endDate: this.formatDate(end),
                Country: country,
                FinanceData: {
                    ...financialEvents,
                    Gross_Profit: grossProfit
                },
                reimburstmentData: 0, // Not calculated for custom periods
                TotalSales: {
                    totalSales: finalTotalSales,
                    dateWiseSales: dateWiseSales
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

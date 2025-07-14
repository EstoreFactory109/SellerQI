const asyncHandler = require('../utils/AsyncHandler');
const logger = require('../utils/Logger.js');
const { ApiError } = require('../utils/ApiError.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const Seller = require('../models/sellerCentralModel.js');
const V2_Model = require('../models/V2_Seller_Performance_ReportModel.js');
const V1_Model = require('../models/V1_Seller_Performance_Report_Model.js');
const numberofproductreviews = require('../models/NumberOfProductReviewsModel.js');
const ListingAllItems = require('../models/GetListingItemsModel.js');
const APlusContentModel = require('../models/APlusContentModel.js');
const financeModel = require('../models/listFinancialEventsModel.js');
const competitivePricingModel = require('../models/CompetitivePricingModel.js');
const restockInventoryRecommendationsModel = require('../models/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
const TotalSalesModel = require('../models/TotalSalesModel.js');
const ShipmentModel = require('../models/ShipmentModel.js');
const ProductWiseSalesModel = require('../models/ProductWiseSalesModel.js');
const { 
    replenishmentQty,
    inventoryPlanningData: processInventoryPlanningData,
    inventoryStrandedData: processInventoryStrandedData,
    inboundNonComplianceData: processInboundNonComplianceData 
} = require('../Services/Calculations/Inventory_.js');
const { calculateAccountHealthPercentage, checkAccountHealth } = require('../Services/Calculations/AccountHealth.js');
const { getRankings, BackendKeyWordOrAttributesStatus } = require('../Services/Calculations/Rankings.js');
const {
    checkNumberOfImages,
    checkIfVideoExists,
    checkNumberOfProductReviews,
    checkStarRating,
    checkAPlus,
    checkProductWithOutBuyBox
} = require('../Services/Calculations/Conversion.js');
const calculateTotalReimbursement = require('../Services/Calculations/Reimburstment.js');
const ProductWiseSponsoredAdsData = require('../models/ProductWiseSponseredAdsModel.js');
const NegetiveKeywords = require('../models/NegetiveKeywords.js');
const KeywordModel = require('../models/keywordModel.js');
const SearchTerms = require('../models/SearchTermsModel.js');
const Campaign = require('../models/CampaignModel.js');
const GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA_Model = require('../models/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA.js');
const GET_STRANDED_INVENTORY_UI_DATA_Model = require('../models/GET_STRANDED_INVENTORY_UI_DATA_MODEL.js');
const GET_FBA_INVENTORY_PLANNING_DATA_Model = require('../models/GET_FBA_INVENTORY_PLANNING_DATA_Model.js');
const FBAFeesModel = require('../models/FBAFees.js');
const adsKeywordsPerformanceModel = require('../models/adsKeywordsPerformanceModel.js');
const GetOrderDataModel = require('../models/OrderAndRevenueModel.js');
const WeeklyFinanceModel = require('../models/WeekLyFinanceModel.js');
const userModel = require('../models/userModel.js');
const GetDateWisePPCspendModel = require('../models/GetDateWisePPCspendModel.js');
const AdsGroup = require('../models/adsgroupModel.js');

const Analyse = async (userId, country, region, adminId = null) => {
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

    const createdAccountDate = await userModel.findOne({ _id: userId }).select('createdAt').sort({ createdAt: -1 });
    if (!createdAccountDate) {
        logger.error(new ApiError(404, "User not found"));
        return {
            status: 404,
            message: "User not found"
        }
    }
    const allSellerAccounts = []
    let SellerAccount = null;
    let sellerCentral = null


    if (adminId !== null) {
        const getAllSellerAccounts = await Seller.find({})
        if (!getAllSellerAccounts) {
            logger.error(new ApiError(404, "Seller central not found"));
            return {
                status: 404,
                message: "Seller central not found"
            }
        }

        sellerCentral = getAllSellerAccounts.find(item => item.User.toString() === userId)

        if (!sellerCentral) {
            logger.error(new ApiError(404, "Seller central not found"));
            return {
                status: 404,
                message: "Seller central not found"
            }
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
                })

                if (Details.country === country && Details.region === region) {
                    SellerAccount = Details;
                }
            })
        })
    } else {

        sellerCentral = await Seller.findOne({ User: userId });
        if (!sellerCentral) {
            logger.error(new ApiError(404, "Seller central not found"));
            return {
                status: 404,
                message: "Seller central not found"
            }
        }

        sellerCentral.sellerAccount.forEach(item => {
            allSellerAccounts.push({
                brand: sellerCentral.brand,
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
    }

    const createdDate = new Date();
    const ThirtyDaysAgo = new Date(createdDate);
    ThirtyDaysAgo.setDate(ThirtyDaysAgo.getDate() - 30);

    console.log("SellerAccount: ", SellerAccount);

    const [
        v2Data,
        v1Data,
        financeData,
        restockInventoryRecommendationsData,
        numberOfProductReviews,
        GetlistingAllItems,
        getCompetitiveData,
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
        AdsGroupData
    ] = await Promise.all([
        V2_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        V1_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        financeModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        restockInventoryRecommendationsModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        numberofproductreviews.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        ListingAllItems.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        // NOTE: Competitive pricing feature is disabled, using empty default data
        // competitivePricingModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        Promise.resolve({ Products: [] }), // Default empty competitive pricing data
        APlusContentModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        TotalSalesModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
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
        FBAFeesModel.findOne({ userId, country, region }).sort({ createdAt: -1 }),
        adsKeywordsPerformanceModel.findOne({ userId, country, region }).sort({ createdAt: -1 }),
        GetOrderDataModel.findOne({ User:userId, country, region }).sort({ createdAt: -1 }),
        GetDateWisePPCspendModel.findOne({ userId, country, region }).sort({ createdAt: -1 }),
        AdsGroup.findOne({ userId, country, region }).sort({ createdAt: -1 })
    ]);

    // console.log("userId: ", userId);
    // console.log("inventoryPlanningData: ", inventoryPlanningData);
    // console.log("inventoryStrandedData: ", inventoryStrandedData);
    // console.log("inboundNonComplianceData: ", inboundNonComplianceData);
 
    // Create default values for missing data instead of returning error
    const safeV2Data = v2Data || { Performance: [], AccountHealth: [] };
    const safeV1Data = v1Data || { V1Reports: [] };
    const safeFinanceData = financeData || { 
        createdAt: createdDate,
        Gross_Profit: 0,
        ProductAdsPayment: 0,
        FBA_Fees: 0,
        Storage: 0,
        Amazon_Charges: 0,
        Refunds: 0
    };
    const safeRestockData = restockInventoryRecommendationsData || { Products: [] };
    const safeProductReviews = numberOfProductReviews || { Products: [] };
    const safeListingItems = GetlistingAllItems || { GenericKeyword: [] };
    const safeCompetitiveData = getCompetitiveData || { Products: [] };
    const safeAplusResponse = aplusResponse || { ApiContentDetails: [] };
    const safeTotalSales = TotalSales || { totalSales: [] };
    const safeShipmentData = shipmentdata || { shipmentData: [] };
    const safeSaleByProduct = saleByProduct || { productWiseSales: [] };
    const safeProductWiseSponsoredAds = ProductWiseSponsoredAds || [];
    const safeNegetiveKeywords = negetiveKeywords || { negativeKeywordsData: [] };
    const safeKeywords = keywords || { keywordData: [] };
    const safeSearchTerms = searchTerms || { searchTermData: [] };
    const safeCampaignData = campaignData || { campaignData: [] };
    const safeAdsKeywordsPerformanceData = adsKeywordsPerformanceData || { keywordsData: [] };
    const safeFBAFeesData = FBAFeesData || { FbaData: [] };
    const safeGetOrderData = GetOrderData || { orderData: [] };
    const safeGetDateWisePPCspendData = GetDateWisePPCspendData || { dateWisePPCSpends: [] };
    const safeAdsGroupData = AdsGroupData || { adsGroupData: [] };
    // Log warnings for missing data instead of failing
    const missingDataWarnings = [];
    if (!v2Data) missingDataWarnings.push('v2Data');
    if (!v1Data) missingDataWarnings.push('v1Data');
    if (!financeData) missingDataWarnings.push('financeData');
    if (!restockInventoryRecommendationsData) missingDataWarnings.push('restockInventoryRecommendationsData');
    if (!numberOfProductReviews) missingDataWarnings.push('numberOfProductReviews');
    if (!GetlistingAllItems) missingDataWarnings.push('GetlistingAllItems');
    if (!aplusResponse) missingDataWarnings.push('aplusResponse');
    if (!TotalSales) missingDataWarnings.push('TotalSales');
    if (!shipmentdata) missingDataWarnings.push('shipmentdata');
    if (!saleByProduct) missingDataWarnings.push('saleByProduct');
    if (!ProductWiseSponsoredAds || ProductWiseSponsoredAds.length === 0) missingDataWarnings.push('ProductWiseSponsoredAds');
    if (!negetiveKeywords) missingDataWarnings.push('negetiveKeywords');
    if (!keywords) missingDataWarnings.push('keywords');
    if (!searchTerms) missingDataWarnings.push('searchTerms');
    if (!campaignData) missingDataWarnings.push('campaignData');
    if (!inventoryPlanningData) missingDataWarnings.push('inventoryPlanningData');
    if (!inventoryStrandedData) missingDataWarnings.push('inventoryStrandedData');
    if (!inboundNonComplianceData) missingDataWarnings.push('inboundNonComplianceData');
    if (!FBAFeesData) missingDataWarnings.push('FBAFeesData');
    if (!adsKeywordsPerformanceData) missingDataWarnings.push('adsKeywordsPerformanceData');
    if (!GetOrderData) missingDataWarnings.push('GetOrderData');
    if (!GetDateWisePPCspendData) missingDataWarnings.push('GetDateWisePPCspendData');
    if (!AdsGroupData) missingDataWarnings.push('AdsGroupData');
    // Log missing data warnings
    if (missingDataWarnings.length > 0) {
        logger.warn(`Missing data (using defaults): ${missingDataWarnings.join(', ')}`);
    }

    const financeCreatedDate = safeFinanceData.createdAt;
    const financeThirtyDaysAgo = new Date(financeCreatedDate);
    financeThirtyDaysAgo.setDate(financeThirtyDaysAgo.getDate() - 30);

    function formatDate(date) {
        const dte = new Date(date);
        const Day = String(dte.getDate()).padStart(2, '0');
        const Month = dte.toLocaleString('default', { month: 'short' })
        return `${Day} ${Month}`
    }

    // Process ProductWiseSponsoredAds data with safe defaults
    let mostRecentSponsoredAds = [];
    let sponsoredAdsGraphData = {};
    
    if (safeProductWiseSponsoredAds && safeProductWiseSponsoredAds.length > 0) {
        // Get the most recent data for display
        mostRecentSponsoredAds = safeProductWiseSponsoredAds[0].sponsoredAds || [];
        
        // Organize data by ASIN
        const asinDataMap = {};
        
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
                        formattedDate: formatDate(dateForData),
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
                        formattedDate: formatDate(dateForData),
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

    // console.log("negetiveKeywords: ", safeNegetiveKeywords.negativeKeywordsData);
    // console.log("FBAFeesData: ", FBAFeesData);

    const result = {
        createdAccountDate: createdAccountDate,
        Brand: sellerCentral.brand,
        AllSellerAccounts: allSellerAccounts,
        startDate: formatDate(financeThirtyDaysAgo),
        endDate: formatDate(financeCreatedDate),
        Country: country,
        TotalProducts: SellerAccount.products,
        AccountData: {
            getAccountHealthPercentge: calculateAccountHealthPercentage(safeV2Data),
            accountHealth: checkAccountHealth(safeV2Data, safeV1Data)
        },
        FinanceData: safeFinanceData,
        TotalSales: safeTotalSales.totalSales,
        ProductWiseSponsoredAds: mostRecentSponsoredAds,
        ProductWiseSponsoredAdsGraphData: sponsoredAdsGraphData,
        negetiveKeywords: safeNegetiveKeywords.negativeKeywordsData,
        keywords: safeKeywords.keywordData,
        searchTerms: safeSearchTerms.searchTermData,
        campaignData: safeCampaignData.campaignData,
        FBAFeesData: safeFBAFeesData.FbaData,
        adsKeywordsPerformanceData: safeAdsKeywordsPerformanceData.keywordsData,
        GetOrderData: safeGetOrderData.RevenueData,
        GetDateWisePPCspendData: safeGetDateWisePPCspendData.dateWisePPCSpends,
        AdsGroupData: safeAdsGroupData.adsGroupData 
    };

    const asinSet = new Set(SellerAccount.products.map(p => p.asin));
    const presentBuyBoxAsins = new Set(checkProductWithOutBuyBox(safeCompetitiveData.Products).presentAsin);
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
    const imageResultArray = [], videoResultArray = [], productReviewResultArray = [], productStarRatingResultArray = [], RankingResultArray = [], BackendKeywordResultArray = [];

    safeProductReviews.Products.forEach(product => {
        if (!DefaulterList.ProductReviews.includes(product.asin)) {
            const imageResult = checkNumberOfImages(product.product_photos);
            const videoResult = checkIfVideoExists(product.video_url);
            const productReviewResult = checkNumberOfProductReviews(product.product_num_ratings);
            const productStarRatingResult = checkStarRating(product.product_star_ratings);
            const rankings = getRankings(product);

            if (rankings.TotalErrors === 0 && [imageResult, videoResult, productReviewResult, productStarRatingResult].every(r => r.status === "Success")) {
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

   // const approvedAsins = [...new Set(aplusResponse.ApiContentDetails.filter(el => el.status === "APPROVED").flatMap(el => el.Asins))];
   const aplusProducts = safeAplusResponse.ApiContentDetails;
    const aPlusArray = checkAPlus(aplusProducts);

  /*  aplusProducts.forEach(asin => {
        const aplusResult = checkAPlus(aplusProducts);
        if (aplusResult.status === "Success") AmazonReadyProductsSet.add(asin);
        if (aplusResult.status === "ERROR") AmazonReadyProductsSet.delete(asin);
        aPlusArray.push({ asin, data: aplusResult });
    });*/

    result.RankingsData = {
        RankingResultArray,
        BackendKeywordResultArray
    };

    // Process inventory analysis data for each ASIN first
    const inventoryAnalysis = {
        inventoryPlanning: [],
        strandedInventory: [],
        inboundNonCompliance: [],
        replenishment: []
    };

    // Create safe defaults for inventory data
    const safeInventoryPlanningData = inventoryPlanningData || { data: [] };
    const safeInventoryStrandedData = inventoryStrandedData || { strandedUIData: [] };
    const safeInboundNonComplianceData = inboundNonComplianceData || { ErrorData: [] };

    // Process Inventory Planning Data for each ASIN
    if (safeInventoryPlanningData.data && Array.isArray(safeInventoryPlanningData.data)) {
        safeInventoryPlanningData.data.forEach(item => {
            if (item && item.asin) {
                try {
                    const planningResult = processInventoryPlanningData(item);
                    inventoryAnalysis.inventoryPlanning.push(planningResult);
                } catch (error) {
                    // console.error(`Error processing inventory planning data for ASIN ${item.asin}:`, error);
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
                            // console.error(`Error processing stranded inventory data for ASIN ${item.asin}:`, error);
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
                    // console.error(`Error processing inbound non-compliance data for ASIN ${item.asin}:`, error);
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
            // console.error(`Error processing replenishment data:`, error);
            logger.error(`Error processing replenishment data: ${error.message}`);
            inventoryAnalysis.replenishment = [];
        }
    } else {
        inventoryAnalysis.replenishment = [];
    }

    // Calculate total inventory errors per ASIN for AmazonReadyProducts determination
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

    // Remove ASINs with inventory errors from AmazonReadyProductsSet
    inventoryErrorsByAsin.forEach((errorCount, asin) => {
        if (errorCount > 0) {
            AmazonReadyProductsSet.delete(asin);
        }
    });

    result.ConversionData = {
        imageResult: imageResultArray,
        videoResult: videoResultArray,
        productReviewResult: productReviewResultArray,
        productStarRatingResult: productStarRatingResultArray,
        aPlusResult: aPlusArray,
        ProductWithOutBuybox: checkProductWithOutBuyBox(safeCompetitiveData.Products).buyboxResult,
        AmazonReadyproducts: Array.from(AmazonReadyProductsSet)
    };




    result.Defaulters = DefaulterList;

    // Validate shipment data and products before calculating reimbursement
    let reimburstmentData = null;
    if (safeShipmentData && safeShipmentData.shipmentData && SellerAccount && SellerAccount.products) {
        reimburstmentData = calculateTotalReimbursement(safeShipmentData.shipmentData, SellerAccount.products);
    } else {
        // console.log('No shipment data available or products data missing for reimbursement calculation - using defaults');
        reimburstmentData = {
            productWiseReimburstment: [],
            totalReimbursement: 0
        };
    }

    if (!reimburstmentData) {
        logger.warn("Failed to calculate reimbursement data - using defaults");
        reimburstmentData = {
            productWiseReimburstment: [],
            totalReimbursement: 0
        };
    }


    result.Reimburstment = reimburstmentData
    result.SalesByProducts = safeSaleByProduct.productWiseSales

    // Calculate total errors across all categories
    let totalErrorsAllCategories = 0;
    
    // Count conversion errors
    const conversionErrors = [
        ...imageResultArray.filter(item => item && item.data && item.data.status === "Error"),
        ...videoResultArray.filter(item => item && item.data && item.data.status === "Error"),
        ...productReviewResultArray.filter(item => item && item.data && item.data.status === "Error"),
        ...productStarRatingResultArray.filter(item => item && item.data && item.data.status === "Error"),
        ...aPlusArray.filter(item => item && item.status === "Error")
    ];
    totalErrorsAllCategories += conversionErrors.length;
    
    // Count ranking errors
    const rankingErrors = RankingResultArray.reduce((count, item) => {
        return count + ((item && item.data && item.data.TotalErrors) || 0);
    }, 0);
    totalErrorsAllCategories += rankingErrors;
    
    // Count backend keyword errors
    const keywordErrors = BackendKeywordResultArray.reduce((count, item) => {
        return count + ((item && item.data && item.data.NumberOfErrors) || 0);
    }, 0);
    totalErrorsAllCategories += keywordErrors;
    
    // Count buybox errors
    const buyboxErrors = checkProductWithOutBuyBox(safeCompetitiveData.Products).buyboxResult.filter(item => item && item.data && item.data.status === "Error").length;
    totalErrorsAllCategories += buyboxErrors;
    
    // Count inventory errors
    const totalInventoryErrors = inventoryErrorsByAsin && inventoryErrorsByAsin.size > 0 
        ? Array.from(inventoryErrorsByAsin.values()).reduce((sum, count) => sum + (count || 0), 0)
        : 0;
    totalErrorsAllCategories += totalInventoryErrors;

    // Add inventory analysis and error summary to result
    result.InventoryAnalysis = inventoryAnalysis;
    result.ErrorSummary = {
        totalErrors: totalErrorsAllCategories,
        conversionErrors: conversionErrors.length,
        rankingErrors: rankingErrors,
        keywordErrors: keywordErrors,
        buyboxErrors: buyboxErrors,
        inventoryErrors: totalInventoryErrors,
        inventoryErrorsByAsin: inventoryErrorsByAsin && inventoryErrorsByAsin.size > 0 
            ? Object.fromEntries(inventoryErrorsByAsin) 
            : {}
    };

    // Log comprehensive summary
    logger.info(`Analysis Summary: Total Errors=${totalErrorsAllCategories}, Inventory Analysis: Planning=${inventoryAnalysis.inventoryPlanning.length}, Stranded=${inventoryAnalysis.strandedInventory.length}, NonCompliance=${inventoryAnalysis.inboundNonCompliance.length}, Amazon Ready Products=${AmazonReadyProductsSet.size}`);

    return {
        status: 200,
        message: result
    };
}

const getDataFromDateRange = async (userId, country, region, startDate, endDate, periodType = null) => {
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
                        startDate: formatDate(start), // Fixed: was using end
                        endDate: formatDate(end),     // Fixed: was using start
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

            function formatDate(date) {
                const dte = new Date(date);
                const Day = String(dte.getDate()).padStart(2, '0');
                const Month = dte.toLocaleString('default', { month: 'short' });
                return `${Day} ${Month}`;
            }

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
            
            // Create entries for all dates in range
            for (let i = 0; i < daysDifference; i++) {
                const currentDate = new Date(start);
                currentDate.setDate(currentDate.getDate() + i);
                currentDate.setHours(0, 0, 0, 0);
                
                const dateKey = currentDate.toDateString();
                const dayData = dateToSales.get(dateKey) || { total: 0, discounts: 0 };
                
                const dayEntry = {
                    interval: formatDate(currentDate),
                    TotalAmount: dayData.total - dayData.discounts
                };

                dateWiseSales.push(dayEntry);
            }

            const result = {
                startDate: formatDate(start), // Fixed: correct order
                endDate: formatDate(end),     // Fixed: correct order
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

    // ... rest of the original logic for default 30-day periods ...
};



const analysingController = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const adminId = req.adminId;
    
    const result = await Analyse(userId, country, region, adminId);
   
    res.status(result.status).json(new ApiResponse(result.status, result.message, "Data is fetched successfully"));
});

const getDataFromDate = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const startDate = req.query?.startDate;
    const endDate = req.query?.endDate;
    const periodType = req.query?.periodType; // Add periodType parameter
    const result = await getDataFromDateRange(userId, country, region, startDate, endDate, periodType);
    res.status(result.status).json(new ApiResponse(result.status, result.message, "Data is fetched successfully"));
})

module.exports = { analysingController, getDataFromDate, Analyse };

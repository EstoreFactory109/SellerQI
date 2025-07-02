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
        inboundNonComplianceData
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
    ]);

    console.log("userId: ", userId);
    console.log("inventoryPlanningData: ", inventoryPlanningData);
    console.log("inventoryStrandedData: ", inventoryStrandedData);
    console.log("inboundNonComplianceData: ", inboundNonComplianceData);

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

    console.log("negetiveKeywords: ", safeNegetiveKeywords.negativeKeywordsData);

    const result = {
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
        missingDataWarnings: missingDataWarnings // Include warnings in response
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
                    console.error(`Error processing inventory planning data for ASIN ${item.asin}:`, error);
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
                            console.error(`Error processing stranded inventory data for ASIN ${item.asin}:`, error);
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
                    console.error(`Error processing inbound non-compliance data for ASIN ${item.asin}:`, error);
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
            console.error(`Error processing replenishment data:`, error);
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
        console.log('No shipment data available or products data missing for reimbursement calculation - using defaults');
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

const getDataFromDateRange = async (userId, country, region, startDate, endDate) => {
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


    const [
        financeData,
        restockInventoryRecommendationsData,
        getCompetitiveData,
        TotalSales,
        shipmentdata,
    ] = await Promise.all([
        financeModel.find({ User: userId, country, region, createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 }),
        restockInventoryRecommendationsModel.find({ User: userId, country, region, createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 }),
        competitivePricingModel.find({ User: userId, country, region, createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 }),
        TotalSalesModel.find({ User: userId, country, region, createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 }),
        ShipmentModel.find({ User: userId, country, region, createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 }),

    ]);

    // Create safe defaults for missing data instead of returning error
    const safeFinanceData = financeData || [];
    const safeRestockData = restockInventoryRecommendationsData || [];
    const safeCompetitiveData = getCompetitiveData || [];
    const safeTotalSales = TotalSales || [];
    const safeShipmentData = shipmentdata || [];

    // Log warnings for missing data instead of failing
    const missingDataWarnings = [];
    if (!financeData || financeData.length === 0) missingDataWarnings.push('financeData');
    if (!restockInventoryRecommendationsData || restockInventoryRecommendationsData.length === 0) missingDataWarnings.push('restockInventoryRecommendationsData');
    if (!getCompetitiveData || getCompetitiveData.length === 0) missingDataWarnings.push('getCompetitiveData');
    if (!TotalSales || TotalSales.length === 0) missingDataWarnings.push('TotalSales');
    if (!shipmentdata || shipmentdata.length === 0) missingDataWarnings.push('shipmentdata');
    
    if (missingDataWarnings.length > 0) {
        logger.warn(`Missing data for date range (using defaults): ${missingDataWarnings.join(', ')}`);
    }

    function formatDate(date) {
        const dte = new Date(date);
        const Day = String(dte.getDate()).padStart(2, '0');
        const Month = dte.toLocaleString('default', { month: 'short' })
        return `${Day} ${Month}`
    }



    const result = {
        startDate: formatDate(end),
        endDate: formatDate(start),
        Country: country,
        missingDataWarnings: missingDataWarnings // Include warnings in response
    };

    function getTotalFinancialData(data) {
        let Gross_Profit = 0
        let ProductAdsPayment = 0
        let FBA_Fees = 0
        let Storage = 0
        let Amazon_Charges = 0
        let Refunds = 0
        
        if (data && data.length > 0) {
            data.forEach(item => {
                Gross_Profit += Number(item.Gross_Profit || 0)
                ProductAdsPayment += Number(item.ProductAdsPayment || 0)
                FBA_Fees += Number(item.FBA_Fees || 0)
                Storage += Number(item.Storage || 0)
                Amazon_Charges += Number(item.Amazon_Charges || 0)
                Refunds += Number(item.Refunds || 0)
            })
        }

        return {
            Gross_Profit,
            ProductAdsPayment,
            FBA_Fees,
            Storage,
            Amazon_Charges,
            Refunds
        }
    }

    function getTotalReimbursement(data) {
        let totalReimburstment = 0;
        
        // Validate that SellerAccount and products exist
        if (!SellerAccount || !SellerAccount.products) {
            console.log('Invalid SellerAccount or products data for getTotalReimbursement - using defaults');
            return totalReimburstment;
        }
        
        if (data && data.length > 0) {
            data.forEach(item => {
                if (item && item.shipmentData) {
                    const reimbursementResult = calculateTotalReimbursement(item.shipmentData, SellerAccount.products);
                    totalReimburstment += reimbursementResult.totalReimbursement;
                } else {
                    console.log('Invalid shipment data item in getTotalReimbursement - skipping');
                }
            })
        }

        return totalReimburstment
    }

    function calculateTotalSales(data) {
        let totalSales = 0;
        let dateWiseSales = [];
        
        if (data && data.length > 0) {
            data.forEach((item) => {
                if (item.totalSales && Array.isArray(item.totalSales)) {
                    item.totalSales.forEach((sale) => {
                        if (dateWiseSales.length === 0) {
                            dateWiseSales.push(sale);
                            totalSales += sale.TotalAmount || 0
                        } else {
                            let containsInterval = dateWiseSales.find(dte => dte.interval === sale.interval);
                            if (!containsInterval) {
                                dateWiseSales.push(sale);
                                totalSales += sale.TotalAmount || 0;
                            }
                        }
                    })
                }
            })
        }

        return {
            totalSales,
            dateWiseSales
        }
    }

    result.FinanceData = getTotalFinancialData(safeFinanceData)
    result.reimburstmentData = getTotalReimbursement(safeShipmentData)
    result.TotalSales = calculateTotalSales(safeTotalSales)



    return {
        status: 200,
        message: result
    };
}



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
    const result = await getDataFromDateRange(userId, country, region, startDate, endDate);
    res.status(result.status).json(new ApiResponse(result.status, result.message, "Data is fetched successfully"));
})

module.exports = { analysingController, getDataFromDate, Analyse };

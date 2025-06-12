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
const { replenishmentQty } = require('../Services/Calculations/Inventory_.js');
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
const ProductWiseFBAData = require('../models/ProductWiseFBADataModel.js');
const NegetiveKeywords = require('../models/NegetiveKeywords.js');
const KeywordModel = require('../models/keywordModel.js');
const SearchTerms = require('../models/SearchTermsModel.js');
const Campaign = require('../models/CampaignModel.js');

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

       // console.log(userId)
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
        //console.log(allSellerAccounts)
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

    console.log("SellerAccount: ",SellerAccount)

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
        ProductWiseFBA,
        negetiveKeywords,
        keywords,
        searchTerms,
        campaignData,
    ] = await Promise.all([
        V2_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        V1_Model.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        financeModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        restockInventoryRecommendationsModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        numberofproductreviews.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        ListingAllItems.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
        competitivePricingModel.findOne({ User: userId, country, region }).sort({ createdAt: -1 }),
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
        ProductWiseFBAData.findOne({ userId, country, region }).sort({ createdAt: -1 }),
        NegetiveKeywords.findOne({ userId, country, region }).sort({ createdAt: -1 }),
        KeywordModel.findOne({ userId, country, region }).sort({ createdAt: -1 }),
        SearchTerms.findOne({ userId, country, region }).sort({ createdAt: -1 }),
        Campaign.findOne({ userId, country, region }).sort({ createdAt: -1 }),
    ]);


    //console.log("ProductWiseSponsoredAds: ",ProductWiseSponsoredAds)
   


    if (![v2Data, v1Data, financeData, restockInventoryRecommendationsData, numberOfProductReviews, GetlistingAllItems, getCompetitiveData, aplusResponse, TotalSales, saleByProduct,ProductWiseSponsoredAds && ProductWiseSponsoredAds.length > 0,ProductWiseFBA,negetiveKeywords,keywords,searchTerms,campaignData].every(Boolean)) {
        logger.error(new ApiError(404, "Required data not found"));
        return {
            status: 404,
            message: "Required data not found"
        }
    }

    const financeCreatedDate = financeData.createdAt;
    const financeThirtyDaysAgo = new Date(financeCreatedDate);
    financeThirtyDaysAgo.setDate(financeThirtyDaysAgo.getDate() - 30);

    function formatDate(date) {
        const dte = new Date(date);
        const Day = String(dte.getDate()).padStart(2, '0');
        const Month = dte.toLocaleString('default', { month: 'short' })
        return `${Day} ${Month}`
    }

    // Process ProductWiseSponsoredAds data
    let mostRecentSponsoredAds = null;
    let sponsoredAdsGraphData = {};
    
    if (ProductWiseSponsoredAds && ProductWiseSponsoredAds.length > 0) {
        // Get the most recent data for display
        mostRecentSponsoredAds = ProductWiseSponsoredAds[0].sponsoredAds;
        
        // Organize data by ASIN
        const asinDataMap = {};
        
        // First, collect all unique ASINs from all entries
        const allAsins = new Set();
        ProductWiseSponsoredAds.forEach(entry => {
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
        ProductWiseSponsoredAds.forEach(entry => {
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

    

    const result = {
        Brand:sellerCentral.brand,
        AllSellerAccounts: allSellerAccounts,
        startDate: formatDate(financeThirtyDaysAgo),
        endDate: formatDate(financeCreatedDate),
        Country: country,
        TotalProducts: SellerAccount.products,
        AccountData: {
            getAccountHealthPercentge: calculateAccountHealthPercentage(v2Data),
            accountHealth: checkAccountHealth(v2Data, v1Data)
        },
        FinanceData: financeData,
        replenishmentQty: replenishmentQty(restockInventoryRecommendationsData.Products),
        TotalSales: TotalSales.totalSales,
        ProductWiseSponsoredAds: mostRecentSponsoredAds,
        ProductWiseSponsoredAdsGraphData: sponsoredAdsGraphData,
        ProductWiseFBAData: ProductWiseFBA.fbaData,
        negetiveKeywords: negetiveKeywords.negetiveKeywordsData,
        keywords: keywords.keywordData,
        searchTerms: searchTerms.searchTermData,
        campaignData: campaignData.campaignData
    };


    const asinSet = new Set(SellerAccount.products.map(p => p.asin));
    const presentBuyBoxAsins = new Set(checkProductWithOutBuyBox(getCompetitiveData.Products).presentAsin);
    const productReviewsAsins = new Set(numberOfProductReviews.Products.map(p => p.asin));
    const listingAllAsins = new Set((GetlistingAllItems.GenericKeyword || []).map(p => p.asin));
    //console.log("setof Listing asins: ", ListingAllItems)

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

    numberOfProductReviews.Products.forEach(product => {
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


    GetlistingAllItems.GenericKeyword.forEach(item => {
        const asin = item.asin;
        if (!DefaulterList.ListingAllItems.includes(asin)) {
            const keywordStatus = BackendKeyWordOrAttributesStatus(item.value);
            if (keywordStatus.NumberOfErrors === 0) AmazonReadyProductsSet.add(asin);
            else AmazonReadyProductsSet.delete(asin);
            BackendKeywordResultArray.push({ asin, data: keywordStatus });
        }
    });

    const approvedAsins = [...new Set(aplusResponse.ApiContentDetails.filter(el => el.status === "APPROVED").flatMap(el => el.Asins))];
    const aPlusArray = [];

    asinSet.forEach(asin => {
        const aplusResult = checkAPlus(approvedAsins, asin);
        if (aplusResult.status === "Success") AmazonReadyProductsSet.add(asin);
        if (aplusResult.status === "ERROR") AmazonReadyProductsSet.delete(asin);
        aPlusArray.push({ asin, data: aplusResult });
    });

    result.RankingsData = {
        RankingResultArray,
        BackendKeywordResultArray
    };


    result.ConversionData = {
        imageResult: imageResultArray,
        videoResult: videoResultArray,
        productReviewResult: productReviewResultArray,
        productStarRatingResult: productStarRatingResultArray,
        aPlusResult: aPlusArray,
        ProductWithOutBuybox: checkProductWithOutBuyBox(getCompetitiveData.Products).buyboxResult,
        AmazonReadyproducts: Array.from(AmazonReadyProductsSet)
    };




    result.Defaulters = DefaulterList;

    const reimburstmentData = calculateTotalReimbursement(shipmentdata.shipmentData, sellerCentral.products)

    if (!reimburstmentData) {
        logger.error(new ApiError(500, "Failed to fetch reimburstment data"));
        return {
            status: 500,
            message: "Failed to fetch reimburstment data",
        }
    }


    result.Reimburstment = reimburstmentData
    result.SalesByProducts = saleByProduct.productWiseSales

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




    if (![financeData, restockInventoryRecommendationsData, getCompetitiveData, TotalSales].every(Boolean)) {
        logger.error(new ApiError(404, "Required data not found"));
        return {
            status: 404,
            message: "Required data not found"
        }
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
    };

    function getTotalFinancialData(data) {
        Gross_Profit = 0
        ProductAdsPayment = 0
        FBA_Fees = 0
        Storage = 0
        Amazon_Charges = 0
        Refunds = 0
        data.forEach(item => {
            Gross_Profit += Number(item.Gross_Profit)
            ProductAdsPayment += Number(item.ProductAdsPayment)
            FBA_Fees += Number(item.FBA_Fees)
            Storage += Number(item.Storage)
            Amazon_Charges += Number(item.Amazon_Charges)
            Refunds += Number(item.Refunds)
        })

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
        data.forEach(item => {
            totalReimburstment += calculateTotalReimbursement(item.shipmentData, sellerCentral.products).totalReimbursement
        })

        //console.log(totalReimburstment)
        return totalReimburstment
    }

    function calculateTotalSales(data) {
        let totalSales = 0;
        let dateWiseSales = [];
        data.forEach((item) => {
            item.totalSales.forEach((sale) => {
                if (dateWiseSales.length === 0) {
                    dateWiseSales.push(sale);
                    totalSales += sale.TotalAmount
                } else {
                    let containsInterval = dateWiseSales.find(dte => dte.interval === sale.interval);
                    if (!containsInterval) {
                        dateWiseSales.push(sale);
                        totalSales += sale.TotalAmount;
                    }
                }
            })
        })

        return {
            totalSales,
            dateWiseSales
        }
    }

    result.FinanceData = getTotalFinancialData(financeData)
    result.reimburstmentData = getTotalReimbursement(shipmentdata)
    result.TotalSales = calculateTotalSales(TotalSales)



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

module.exports = { analysingController, getDataFromDate };

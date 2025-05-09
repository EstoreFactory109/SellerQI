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
const ShipmentModel=require('../models/ShipmentModel.js');
const ProductWiseSalesModel=require('../models/ProductWiseSalesModel.js');
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
const calculateTotalReimbursement=require('../Services/Calculations/Reimburstment.js');



const Analyse= async(userId,country,region)=>{
    if (!userId){
        logger.error(new ApiError(400, "User id is missing"));
        return {
            status:404,
            message:"User id is missing"
        }
    }
    if(!country || !region) {
        logger.error(new ApiError(400, "Country or Region is missing"));
        return {
            status:404,
            message:"Country or Region is missing"
        }
    }

    const sellerCentral = await Seller.findOne({ User: userId });
    if (!sellerCentral){
        logger.error(new ApiError(404, "Seller central not found"));
        return {
            status:404,
            message:"Seller central not found"
        }
    }

    console.log(sellerCentral.sellerAccount);
    const allSellerAccounts=[]
    let SellerAccount=null;

    sellerCentral.sellerAccount.forEach(item=>{
        allSellerAccounts.push({
            country:item.country,
            region:item.region,
            NoOfProducts:item.products.length
        })
        if(item.country === country && item.region === region){
            SellerAccount=item;
        }
    })

    if (!SellerAccount) {
        logger.error(new ApiError(404, "Seller account not found"));
        return {
            status:404,
            message:"Seller account not found"
        }
    }


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
        saleByProduct
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
    ]);
    
    


    if (![v2Data, v1Data, financeData, restockInventoryRecommendationsData, numberOfProductReviews, GetlistingAllItems, getCompetitiveData, aplusResponse,TotalSales,saleByProduct].every(Boolean)) {
        logger.error(new ApiError(404, "Required data not found"));
        return {
            status:404,
            message:"Required data not found"
        }
    }

    const createdDate=financeData.createdAt;
    const ThirtyDaysAgo=new Date(createdDate);
    ThirtyDaysAgo.setDate(ThirtyDaysAgo.getDate()-30);
    
    function formatDate(date){
        const dte=new Date(date);
        const Day=String(dte.getDate()).padStart(2,'0');
        const Month=dte.toLocaleString('default', { month: 'short' })
        return `${Day} ${Month}`
    }

    const result = {
        AllSellerAccounts:allSellerAccounts,
        startDate:formatDate(ThirtyDaysAgo),
        endDate:formatDate(createdDate),
        Country: country,
        TotalProducts: SellerAccount.products,
        AccountData: {
            getAccountHealthPercentge: calculateAccountHealthPercentage(v2Data),
            accountHealth: checkAccountHealth(v2Data, v1Data)
        },
        FinanceData: financeData,
        replenishmentQty: replenishmentQty(restockInventoryRecommendationsData.Products),
        TotalSales:TotalSales.totalSales
    };


    const asinSet = new Set(SellerAccount.products.map(p => p.asin));
    const presentBuyBoxAsins = new Set(checkProductWithOutBuyBox(getCompetitiveData.Products).presentAsin);
    const productReviewsAsins = new Set(numberOfProductReviews.Products.map(p => p.asin));
    const listingAllAsins = new Set((GetlistingAllItems.GenericKeyword || []).map(p => p.asin));
    console.log("setof Listing asins: ",ListingAllItems)

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

    const reimburstmentData=calculateTotalReimbursement(shipmentdata.shipmentData,sellerCentral.products)

    if(!reimburstmentData){
        logger.error(new ApiError(500, "Failed to fetch reimburstment data"));
        return {
            status: 500,
            message: "Failed to fetch reimburstment data",
        }
    }


     result.Reimburstment=reimburstmentData
    result.SalesByProducts=saleByProduct.productWiseSales

    return {
        status: 200,
        message:result
    };
}





const analysingController = asyncHandler(async (req, res) => {
    const  userId=req.userId;
    const country=req.country;
    const region  = req.region;
    const result=await Analyse(userId,country,region);
    res.status(result.status).json(new ApiResponse(result.status, result.message, "Data is fetched successfully"));
});

module.exports = { analysingController };

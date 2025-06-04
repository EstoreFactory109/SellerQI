const limit = require('promise-limit')(3); // Limit to 3 concurrent promises
const { ApiError } = require('../utils/ApiError.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const asyncHandler = require('../utils/AsyncHandler.js');
const { generateAccessToken } = require('../Services/Sp_API/GenerateTokens.js');
const getTemporaryCredentials = require('../utils/GenerateTemporaryCredentials.js');
const logger = require('../utils/Logger.js');
const UserModel = require('../models/userModel.js');
const Seller = require('../models/sellerCentralModel.js')
const { URIs, marketplaceConfig, spapiRegions } = require('./config/config.js')

const ListingItemsModel = require('../models/GetListingItemsModel.js');

const GET_MERCHANT_LISTINGS_ALL_DATA = require('../Services/Sp_API/GET_MERCHANT_LISTINGS_ALL_DATA.js');
const GET_V2_SELLER_PERFORMANCE_REPORT = require('../Services/Sp_API/V2_Seller_Performance_Report.js');
const GET_V1_SELLER_PERFORMANCE_REPORT = require('../Services/Sp_API/GET_V1_SELLER_PERFORMANCE_REPORT.js');
const { listFinancialEventsMethod } = require('../Services/Sp_API/Finance.js');
const { getCompetitivePricing } = require('../Services/Sp_API/CompetitivePrices.js');
const GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT = require('../Services/Sp_API/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT.js');
const { addReviewDataTODatabase } = require('../Services/Sp_API/NumberOfProductReviews.js');
const { GetListingItem } = require('../Services/Sp_API/GetListingItemsIssues.js');
const { getContentDocument } = require('../Services/Sp_API/APlusContent.js');
const TotalSales = require('../Services/Sp_API/WeeklySales.js');
const getshipment = require('../Services/Sp_API/shipment.js');
const CompetitivePricing= require('../models/CompetitivePricingModel.js');





const getSpApiData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    //Getting all the required credentials

    const getSellerData = await Seller.findOne({ User: userId, })

    if (!getSellerData) {
        logger.error(new ApiError(500, "Internal server error in getting the seller data"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in getting the seller data"));
    }

    const Region = req.region;
    const Country = req.country;

    if (!Region || !Country) {
        logger.error(new ApiError(400, "Region and country is missing"));
        return res.status(400).json(new ApiResponse(400, "", "Region and country is missing"));
    }


    const Base_URI = URIs[Region];
    const Marketplace_Id = marketplaceConfig[Country];




    const credentials = await getTemporaryCredentials(spapiRegions[Region]);



    if (!credentials) {
        logger.error(new ApiError(500, "Internal server error in generation the temporary credentials"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in generation the temporary credentials"));
    }
    

    const User = await UserModel.findById(userId).select("spiRefreshToken");


    const RefreshToken = User.spiRefreshToken;

    if (!RefreshToken) {
        logger.error(new ApiError(500, "Internal server error in getting the refresh token"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in getting the refresh token"));
    }

    const AccessToken = await generateAccessToken(userId, RefreshToken);

    if (!AccessToken) {
        logger.error(new ApiError(500, "Internal server error in generating the access token"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in generating the access token"));
    }


    const sellerId = getSellerData.selling_partner_id;




    const merchantListingsData = await GET_MERCHANT_LISTINGS_ALL_DATA(AccessToken, [Marketplace_Id], userId, Country, Region, Base_URI);

    if (!merchantListingsData) {
        logger.error(new ApiError(500, "Internal server error in getting the merchant listing data"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in getting the merchant listing data"));
    }


    const asinArray = [];
    const skuArray = [];

    const SellerAccount = merchantListingsData.sellerAccount.find(item => item.country === Country && item.region === Region);

    if (!SellerAccount) {
        logger.error(new ApiError(500, "Internal server error in getting the merchant listing data"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in getting the merchant listing data"));
    }


    asinArray.push(...SellerAccount.products.map(e => e.status==="Active" && e.asin));
    skuArray.push(...SellerAccount.products.map(e => e.status==="Active" && e.sku));








    const dataToSend = {
        before: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 minutes before now
        after: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 7 days before now
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






    const [v2data,
        v1data
    ] = await Promise.all([
       GET_V2_SELLER_PERFORMANCE_REPORT(AccessToken, [Marketplace_Id], userId, Base_URI, Country, Region),
        GET_V1_SELLER_PERFORMANCE_REPORT(AccessToken, Marketplace_Id, userId, Base_URI, Country, Region),

    ]);



        let competitivePriceData=[]

        if (asinArray.length > 0) {
            let start = 0;
            let end = 20;
        
            while (start < asinArray.length) {
                const asinArrayChunk = asinArray.slice(start, end);
        
                const competitiveResponseData = await getCompetitivePricing(
                    asinArrayChunk, dataToSend, userId, Base_URI, Country, Region
                );
        
                if (competitiveResponseData) {
                    competitivePriceData.push(...competitiveResponseData);
                }
        
                start = end;
                end = Math.min(end + 20, asinArray.length);
                console.log(`Processed indices ${start} to ${end}`);
            }
        }else{
            const competitiveResponseData = await getCompetitivePricing(
                asinArray, dataToSend, userId, Base_URI, Country, Region
            );
    
            if (competitiveResponseData) {
                competitivePriceData.push(...competitiveResponseData);
            }
        }
        const CreateCompetitivePricing= await CompetitivePricing.create({User:userId,region:Region,country:Country,Products:competitivePriceData});
        





    const [RestockinventoryData,
        productReview
    ] = await Promise.all([
       GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT(AccessToken, [Marketplace_Id], userId, Base_URI, Country, Region),
       addReviewDataTODatabase(asinArray, Country, userId, Region)

    ])

    const [
       WeeklySales, 
        shipment,
        financeData] = await Promise.all([
        TotalSales(dataToSend, userId, Base_URI, Country, Region),
        getshipment(dataToSend, userId, Base_URI, Country, Region),
        listFinancialEventsMethod(dataToSend, userId, Base_URI, Country, Region)
    ])



    const contentDocumentData = await getContentDocument(dataToSend, userId, Base_URI, Country, Region);


    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }



    let genericKeyWordArray = [];
    const tasks = skuArray.map((sku, index) => {

        return limit(async () => {
            try {
                await delay(1000); // Delay each request a bit more than the previous (200ms gap)

                const ListingItem = await GetListingItem(dataToSend, sku, asinArray[index], userId, Base_URI, Country, Region);

                
                if (!ListingItem) {
                    logger.error(new ApiError(500, `❌ No data for SKU: ${sku}`));
                } else {
                    genericKeyWordArray.push(ListingItem)
                }
            } catch (err) {
                logger.error(new ApiError(500, `❌ Error for SKU: ${sku} - ${err.message}`));
            }
        });
    });
    await Promise.all(tasks);

   

    (async () => {
        if (genericKeyWordArray.length > 0) {
            const saveGenericKeyword = await ListingItemsModel.create({
                User: userId,
                region: Region,
                country: Country,
                GenericKeyword: genericKeyWordArray
            })

            console.log("Data saved in db",saveGenericKeyword)
            if (!saveGenericKeyword) {
                logger.error(new ApiError(500, "Failed to save generic keyword"));
                return res.status(500).json(new ApiResponse(500, "", "Failed to save generic keyword"));
            }
        }
    })()


   if (!v2data) {
        logger.error(new ApiError(500, "Failed to fetch V2 seller performance report"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to fetch V2 seller performance report"));
    }

   if (!v1data) {
        logger.error(new ApiError(500, "Failed to fetch V1 seller performance report"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to fetch V1 seller performance report"));
    }

    if (!financeData) {
        logger.error(new ApiError(500, "Failed to fetch financial event data"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to fetch financial event data"));
    }

    if (!CreateCompetitivePricing) {
        logger.error(new ApiError(500, "Failed to fetch competitive pricing data"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to fetch competitive pricing data"));
    }

    if (!WeeklySales) {
        logger.error(new ApiError(500, "Failed to fetch sales data"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to fetch sales data"));
    }

    if (!RestockinventoryData) {
        logger.error(new ApiError(500, "Failed to fetch restock inventory recommendations"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to fetch restock inventory recommendations"));
    }

    if (!productReview) {
        console.log("productReview", productReview);
        logger.error(new ApiError(500, "Failed to fetch product review data"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to fetch product review data"));
    }

    if (!shipment) {
        logger.error(new ApiError(500, "Failed to fetch shipment data"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to fetch shipment data"));
    }


    if (!contentDocumentData) {
        logger.error(new ApiError(500, "Failed to fetch A+ content document data"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to fetch A+ content document data"));
    }


    const result = {
        MerchantlistingData: merchantListingsData,
        v2data: v2data,
        v1data: v1data,
        financeData: financeData,
        competitivePriceData: competitivePriceData,
        RestockinventoryData: RestockinventoryData,
        productReview: productReview,
        contentDocumentData: contentDocumentData,
        WeeklySales: WeeklySales,
        shipment: shipment
    }





    console.log("financeData: ",financeData)

    if(financeData.length === 0){
        logger.error(new ApiError(500, "No data found"));
        return res.status(500).json(new ApiResponse(500, "", "No data found"));
    }

    return res.status(200).json(new ApiResponse(200, result, "Data has been fetched successfully"));




})

module.exports = { getSpApiData }
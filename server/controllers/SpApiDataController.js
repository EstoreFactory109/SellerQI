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

const ListingItemsModel = require('../models/GetListingItemsModel.js');

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
const CompetitivePricing= require('../models/CompetitivePricingModel.js');
const {generateAdsAccessToken} = require('../Services/AmazonAds/GenerateToken.js');
const {getPPCSpendsBySKU} = require('../Services/AmazonAds/GetPPCProductWise.js');
const {getKeywords} = require('../Services/AmazonAds/Keywords.js');
const {getNegativeKeywords} = require('../Services/AmazonAds/NegetiveKeywords.js');
const {getSearchKeywords} = require('../Services/AmazonAds/GetSearchKeywords.js');
const {getCampaign} = require('../Services/AmazonAds/GetCampaigns.js');
const {getBrand} = require('../Services/Sp_API/GetBrand.js');
const GET_FBA_INVENTORY_PLANNING_DATA = require('../Services/Sp_API/GET_FBA_INVENTORY_PLANNING_DATA.js');
const GET_STRANDED_INVENTORY_UI_DATA = require('../Services/Sp_API/GET_STRANDED_INVENTORY_UI_DATA.js');
const GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA = require('../Services/Sp_API/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA.js');
const getAmazonFees = require('../Services/Finance/AmazonFees.js');
const ProductWiseSponsoredAdsData = require('../models/ProductWiseSponseredAdsModel.js');
const { getKeywordPerformanceReport } = require('../Services/AmazonAds/GetWastedSpendKeywords.js');
const {getPPCSpendsDateWise} = require('../Services/AmazonAds/GetDateWiseSpendKeywords.js');
const {getAdGroups}= require('../Services/AmazonAds/AdGroups.js');
const {getProfileById} = require('../Services/AmazonAds/GenerateProfileId.js');

const getSpApiData = asyncHandler(async (req, res) => {
    const userId = req.userId;

    // console.log("userId: ",userId)
  
    if (!userId) {
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    //Getting all the required credentials

    const getSellerData = await Seller.findOne({ User: userId, }).sort({createdAt: -1})
    // console.log(getSellerData);

    if (!getSellerData) {
        logger.error(new ApiError(500, "Internal server error in getting the seller data"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in getting the seller data"));
    }

    const Region = req.region;
    const Country = req.country;

    console.log("region: ",Region);
    console.log("country: ",Country);

    if (!Region || !Country) {
        logger.error(new ApiError(400, "Region and country is missing"));
        return res.status(400).json(new ApiResponse(400, "", "Region and country is missing"));
    }

    // Safer access to configuration objects
    const Base_URI = URIs && URIs[Region] ? URIs[Region] : null;
    const Marketplace_Id = marketplaceConfig && marketplaceConfig[Country] ? marketplaceConfig[Country] : null;

    if (!Base_URI || !Marketplace_Id) {
        logger.error(new ApiError(400, "Invalid region or country configuration"));
        return res.status(400).json(new ApiResponse(400, "", "Invalid region or country configuration"));
    }

    // Safer access to spapiRegions
    const regionConfig = spapiRegions && spapiRegions[Region] ? spapiRegions[Region] : null;
    if (!regionConfig) {
        logger.error(new ApiError(400, "Invalid region configuration for credentials"));
        return res.status(400).json(new ApiResponse(400, "", "Invalid region configuration for credentials"));
    }

    const credentials = await getTemporaryCredentials(regionConfig);

    if (!credentials || !credentials.AccessKey || !credentials.SecretKey || !credentials.SessionToken) {
        logger.error(new ApiError(500, "Internal server error in generation the temporary credentials"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in generation the temporary credentials"));
    }
    
    // Safer array access
    const sellerAccounts = Array.isArray(getSellerData.sellerAccount) ? getSellerData.sellerAccount : [];
    const getSellerAccount = sellerAccounts.find(item => item && item.country === Country && item.region === Region);
    
    if (!getSellerAccount) {
        logger.error(new ApiError(400, "No seller account found for the specified region and country"));
        return res.status(400).json(new ApiResponse(400, "", "No seller account found for the specified region and country"));
    }
    
    const RefreshToken = getSellerAccount.spiRefreshToken;
    const AdsRefreshToken = getSellerAccount.adsRefreshToken;
    
    console.log("refresh token: ",RefreshToken);
    console.log("ads refresh token: ",AdsRefreshToken);
    

    if (!RefreshToken || !AdsRefreshToken) {
        logger.error(new ApiError(500, "Internal server error in getting the refresh tokens or profile id"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in getting the refresh tokens or profile id"));
    }

    const [AccessToken, AdsAccessToken] = await Promise.all([generateAccessToken(userId, RefreshToken), generateAdsAccessToken(AdsRefreshToken)]);

    if (!AccessToken || !AdsAccessToken) {
        logger.error(new ApiError(500, "Internal server error in generating the access token"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in generating the access token"));
    }

    const ProfileId = await getProfileById(AdsAccessToken, Region, Country, userId);

    if(!ProfileId){
        logger.error(new ApiError(500, "Internal server error in getting the profile id"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in getting the profile id"));
    }

    // Initialize tokens in TokenManager for automatic refresh
    tokenManager.setTokens(userId, AccessToken, AdsAccessToken, RefreshToken, AdsRefreshToken);

    const sellerId = getSellerData.selling_partner_id;
    
    if (!sellerId) {
        logger.error(new ApiError(400, "Seller ID not found"));
        return res.status(400).json(new ApiResponse(400, "", "Seller ID not found"));
    }

    const merchantListingsData = await tokenManager.wrapSpApiFunction(
        GET_MERCHANT_LISTINGS_ALL_DATA, userId, RefreshToken, AdsRefreshToken
    )(AccessToken, [Marketplace_Id], userId, Country, Region, Base_URI).catch(err => {
        logger.error(`Merchant Listings Error: ${err.message}`);
        return null;
    });

    if (!merchantListingsData) {
        logger.error(new ApiError(500, "Internal server error in getting the merchant listing data"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in getting the merchant listing data"));
    }

    const asinArray = [];
    const skuArray = [];
    const ProductDetails = [];

    // Safer access to merchant listings data
    const merchantSellerAccounts = Array.isArray(merchantListingsData.sellerAccount) ? merchantListingsData.sellerAccount : [];
    const SellerAccount = merchantSellerAccounts.find(item => item && item.country === Country && item.region === Region);

    if (!SellerAccount || !Array.isArray(SellerAccount.products)) {
        logger.error(new ApiError(500, "Internal server error in getting the merchant listing data"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in getting the merchant listing data"));
    }

    // Filter products and extract ASINs and SKUs safely
    const activeProducts = SellerAccount.products.filter(e => e && e.status === "Active" && e.asin && e.sku);
    if (activeProducts.length > 0) {
        asinArray.push(...activeProducts.map(e => e.asin).filter(Boolean));
        skuArray.push(...activeProducts.map(e => e.sku).filter(Boolean));
        ProductDetails.push(...activeProducts.map(e=>{return {asin:e.asin,price:e.price}}));
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

    const [v2data,
        v1data,
        ppcSpendsBySKU,
        adsKeywordsPerformanceData,
        ppcSpendsDateWise
    ] = await Promise.all([
       tokenManager.wrapSpApiFunction(
           GET_V2_SELLER_PERFORMANCE_REPORT, userId, RefreshToken, AdsRefreshToken
       )(AccessToken, [Marketplace_Id], userId, Base_URI, Country, Region).catch(err => {
           logger.error(`V2 Report Error: ${err.message}`);
           return null;
       }),
       tokenManager.wrapSpApiFunction(
           GET_V1_SELLER_PERFORMANCE_REPORT, userId, RefreshToken, AdsRefreshToken
       )(AccessToken, Marketplace_Id, userId, Base_URI, Country, Region).catch(err => {
           logger.error(`V1 Report Error: ${err.message}`);
           return null;
       }),
       tokenManager.wrapAdsFunction(
           getPPCSpendsBySKU, userId, RefreshToken, AdsRefreshToken
       )(AdsAccessToken, ProfileId, userId, Country, Region).catch(err => {
           logger.error(`PPC Spends Error: ${err.message}`);
           return { sponsoredAds: [] };
       }),
       tokenManager.wrapAdsFunction(
           getKeywordPerformanceReport, userId, RefreshToken, AdsRefreshToken
       )(AdsAccessToken, ProfileId, userId, Country, Region).catch(err => {
           logger.error(`Ads Keywords Performance Data Error: ${err.message}`);
           return null;
       }),
       tokenManager.wrapAdsFunction(
           getPPCSpendsDateWise, userId, RefreshToken, AdsRefreshToken
       )(AdsAccessToken, ProfileId, userId, Country, Region).catch(err => {
           logger.error(`PPC Spends Date Wise Error: ${err.message}`);
           return null;
       })
    ]);

    // Validate ppcSpendsBySKU and extract sponsored ads data safely
    const sponsoredAdsData = (ppcSpendsBySKU && Array.isArray(ppcSpendsBySKU.sponsoredAds)) ? ppcSpendsBySKU.sponsoredAds : [];

    // SAFER APPROACH: Get campaign and ad group IDs from ProductWiseSponsoredAdsData model
    // console.log("=== FETCHING CAMPAIGN & AD GROUP IDs FROM DATABASE ===");
    const storedSponsoredAdsData = await ProductWiseSponsoredAdsData.findOne({ 
        userId: userId, 
        region: Region, 
        country: Country 
    }).catch(err => {
        logger.error(`Error fetching stored sponsored ads data: ${err.message}`);
        return null;
    });

    let campaignIdArray = [];
    let adGroupIdArray = [];

    if (storedSponsoredAdsData && Array.isArray(storedSponsoredAdsData.sponsoredAds)) {
        // Extract unique campaign and ad group IDs from stored data
        const campaignIds = new Set();
        const adGroupIds = new Set();
        
        storedSponsoredAdsData.sponsoredAds.forEach(ad => {
            if (ad.campaignId) campaignIds.add(ad.campaignId);
            if (ad.adGroupId) adGroupIds.add(ad.adGroupId);
        });
        
        campaignIdArray = Array.from(campaignIds);
        adGroupIdArray = Array.from(adGroupIds);
        
        logger.info(`Successfully fetched from database: ${campaignIdArray.length} unique campaign IDs and ${adGroupIdArray.length} unique ad group IDs`);
            // console.log("Database data summary:");
    // console.log("- Total sponsored ads records:", storedSponsoredAdsData.sponsoredAds.length);
    // console.log("- Unique campaign IDs:", campaignIdArray.length);
    // console.log("- Unique ad group IDs:", adGroupIdArray.length);
    // console.log("- Campaign IDs:", campaignIdArray);
    // console.log("- Ad Group IDs:", adGroupIdArray);
    } else {
        // Fallback to live PPC data if no stored data found
        logger.warn("No stored sponsored ads data found in database, falling back to live PPC data");
        campaignIdArray = Array.isArray(sponsoredAdsData) 
            ? sponsoredAdsData.map(item => item && item.campaignId).filter(Boolean)
            : [];
        adGroupIdArray = Array.isArray(sponsoredAdsData) 
            ? sponsoredAdsData.map(item => item && item.adGroupId).filter(Boolean) 
            : [];
            
        logger.info(`Fallback: Using ${campaignIdArray.length} campaign IDs and ${adGroupIdArray.length} ad group IDs from live PPC data`);
    }
    
    // console.log("=== FINAL IDs TO USE FOR getNegativeKeywords ===");
    // console.log("Campaign IDs count:", campaignIdArray.length);
    // console.log("Ad Group IDs count:", adGroupIdArray.length);
    // console.log("========================================================");

    let competitivePriceData = [];

    if (Array.isArray(asinArray) && asinArray.length > 0) {
        let start = 0;
        let end = 20;
    
        while (start < asinArray.length) {
            const asinArrayChunk = asinArray.slice(start, end);
    
            try {
                const competitiveResponseData = await tokenManager.wrapDataToSendFunction(
                    getCompetitivePricing, userId, RefreshToken, AdsRefreshToken
                )(asinArrayChunk, dataToSend, userId, Base_URI, Country, Region);
        
                if (competitiveResponseData && Array.isArray(competitiveResponseData)) {
                    competitivePriceData.push(...competitiveResponseData);
                }
            } catch (error) {
                logger.error(`Competitive Pricing Error for chunk ${start}-${end}: ${error.message}`);
            }
    
            start = end;
            end = Math.min(end + 20, asinArray.length);
            // console.log(`Processed indices ${start} to ${end}`);
        }
    } else {
        // Skip competitive pricing if no ASINs available
        // console.log("No ASINs available for competitive pricing");
    }
    
    let CreateCompetitivePricing;
    try {
        CreateCompetitivePricing = await CompetitivePricing.create({
            User: userId,
            region: Region,
            country: Country,
            Products: Array.isArray(competitivePriceData) ? competitivePriceData : []
        });
    } catch (error) {
        logger.error(`Competitive Pricing DB Error: ${error.message}`);
        CreateCompetitivePricing = null;
    }

    const [
        RestockinventoryData,
        productReview,
        adsKeywords,
        campaignData,
        fbaInventoryPlanningData,
        strandedInventoryData,
        inboundNonComplianceData
    ] = await Promise.all([
       tokenManager.wrapSpApiFunction(
          GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT, userId, RefreshToken, AdsRefreshToken
       )(AccessToken, [Marketplace_Id], userId, Base_URI, Country, Region).catch(err => {
          logger.error(`Restock Inventory Error: ${err.message}`);
           return null;
       }),
       addReviewDataTODatabase(
            Array.isArray(asinArray) ? asinArray : [], Country, userId, Region
       ).catch(err => {
            logger.error(`Product Review Error: ${err.message}`);
            return null;
       }),
       tokenManager.wrapAdsFunction(
            getKeywords, userId, RefreshToken, AdsRefreshToken
       )(AdsAccessToken, ProfileId, userId, Country, Region).catch(err => {
            logger.error(`Keywords Error: ${err.message}`);
            return { campaignIdArray: [] };
       }),
       tokenManager.wrapAdsFunction(
            getCampaign, userId, RefreshToken, AdsRefreshToken
       )(AdsAccessToken, ProfileId, Region, userId, Country).catch(err => {
            logger.error(`Campaign Error: ${err.message}`);
            return null;
       }),
       tokenManager.wrapSpApiFunction(
            GET_FBA_INVENTORY_PLANNING_DATA, userId, RefreshToken, AdsRefreshToken
       )(AccessToken, [Marketplace_Id], userId, Base_URI, Country, Region).catch(err => {
            logger.error(`FBA Inventory Planning Error: ${err.message}`);
            return null;
       }),
       tokenManager.wrapSpApiFunction(
            GET_STRANDED_INVENTORY_UI_DATA, userId, RefreshToken, AdsRefreshToken
       )(AccessToken, [Marketplace_Id], userId, Base_URI, Country, Region).catch(err => {
            logger.error(`Stranded Inventory Error: ${err.message}`);
            return null;
       }),
       tokenManager.wrapSpApiFunction(
            GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA, userId, RefreshToken, AdsRefreshToken
       )(AccessToken, [Marketplace_Id], userId, Base_URI, Country, Region).catch(err => {
            logger.error(`Inbound Non-Compliance Error: ${err.message}`);
            return null;
       })
    ])

    const campaignDbData = campaignData?.campaignData;
    const campaignids= campaignDbData.map(item=>item.campaignId);



    let [
       WeeklySales, 
    shipment,
       brandData,
       feesResult,
       financeDataFromAPI,
       adGroupsData
       ] = await Promise.all([
       tokenManager.wrapDataToSendFunction(
           TotalSales, userId, RefreshToken, AdsRefreshToken
       )(dataToSend, userId, Base_URI, Country, Region).catch(err => {
           logger.error(`Weekly Sales Error: ${err.message}`);
           return null;
       }),
       tokenManager.wrapDataToSendFunction(
           getshipment, userId, RefreshToken, AdsRefreshToken
       )(dataToSend, userId, Base_URI, Country, Region).catch(err => {
           logger.error(`Shipment Error: ${err.message}`);
           return null;
       }),
       tokenManager.wrapDataToSendFunction(
           getBrand, userId, RefreshToken, AdsRefreshToken
       )(dataToSend, userId, Base_URI).catch(err => {
           logger.error(`Brand Data Error: ${err.message}`);
           return null;
       }),
       tokenManager.wrapDataToSendFunction(
           getAmazonFees, userId, RefreshToken, AdsRefreshToken
       )(dataToSend, userId, Base_URI, Country, Region, ProductDetails).catch(err => {
           logger.error(`Fees Result Error: ${err.message}`);
           return null;
       }),
       tokenManager.wrapDataToSendFunction(
           listFinancialEventsMethod, userId, RefreshToken, AdsRefreshToken
       )(dataToSend, userId, Base_URI, Country, Region).catch(err => {
           logger.error(`Finance Data Error: ${err.message}`);
           return [];
       }),
       tokenManager.wrapAdsFunction(
           getAdGroups, userId, RefreshToken, AdsRefreshToken
       )(AdsAccessToken, ProfileId, Region, userId, Country, campaignids).catch(err => {
           logger.error(`Ad Groups Data Error: ${err.message}`);
           return null;
       })
    ])

    // Combine finance data from both sources
    let financeData = financeDataFromAPI || [];
    
    // If the Promise.all didn't work, try the individual call
    if (!financeData || (Array.isArray(financeData) && financeData.length === 0)) {
        financeData = await tokenManager.wrapDataToSendFunction(
            listFinancialEventsMethod, userId, RefreshToken, AdsRefreshToken
        )(dataToSend, userId, Base_URI, Country, Region).catch(err => {
            logger.error(`Finance Data Error: ${err.message}`);
            return [];
        });
    }

    const [
        negativeKeywords,
        searchKeywords
    ] = await Promise.all([
            tokenManager.wrapAdsFunction(
                getNegativeKeywords, userId, RefreshToken, AdsRefreshToken
            )(AdsAccessToken, ProfileId, userId, Country, Region, 
                Array.isArray(campaignIdArray) ? campaignIdArray : [], 
                Array.isArray(adGroupIdArray) ? adGroupIdArray : []
            ).catch(err => {
                logger.error(`Negative Keywords Error: ${err.message}`);
                return null;
            }),
            tokenManager.wrapAdsFunction(
                getSearchKeywords, userId, RefreshToken, AdsRefreshToken
            )(AdsAccessToken, ProfileId, userId, Country, Region).catch(err => {
                logger.error(`Search Keywords Error: ${err.message}`);
                return null;
            })
       ]);

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    let genericKeyWordArray = [];
    
    // Ensure both arrays exist and are actually arrays before processing
    if (Array.isArray(skuArray) && Array.isArray(asinArray) && skuArray.length > 0) {
        // console.log("skuArray: ", skuArray);
        const tasks = skuArray.map((sku, index) => {
            return limit(async () => {
                await delay(1000); // Delay each request a bit more than the previous (200ms gap)

                // Ensure asinArray has corresponding ASIN for this SKU and check bounds
                if (index >= asinArray.length) {
                    logger.error(new ApiError(500, `❌ No corresponding ASIN found for SKU at index ${index}: ${sku}`));
                    return;
                }
                
                const asin = asinArray[index];
                if (!asin) {
                    logger.error(new ApiError(500, `❌ No ASIN found for SKU: ${sku}`));
                    return;
                }

                const ListingItem = await tokenManager.wrapDataToSendFunction(
                    GetListingItem, userId, RefreshToken, AdsRefreshToken
                )(dataToSend, sku, asin, userId, Base_URI, Country, Region).catch(err => {
                    logger.error(new ApiError(500, `❌ Error for SKU: ${sku} - ${err.message}`));
                    return null;
                });

                // console.log("ListingItem: ", ListingItem);

                if (!ListingItem) {
                    logger.error(new ApiError(500, `❌ No data for SKU: ${sku}`));
                } else {
                    genericKeyWordArray.push(ListingItem)
                }
            });
        });
        await Promise.all(tasks);
    } else {
        // console.log("No SKUs or ASINs available for processing listing items");
    }

    // console.log("genericKeyWordArray: ", genericKeyWordArray);

    // Save generic keywords if any were found
    if (Array.isArray(genericKeyWordArray) && genericKeyWordArray.length > 0) {
        try {
            const saveGenericKeyword = await ListingItemsModel.create({
                User: userId,
                region: Region,
                country: Country,
                GenericKeyword: genericKeyWordArray
            });

            // console.log("Data saved in db", saveGenericKeyword);
            if (!saveGenericKeyword) {
                logger.error("Failed to save generic keyword - continuing without saving");
            }
        } catch (error) {
            logger.error(`Error saving generic keywords: ${error.message} - continuing without saving`);
        }
    }

    // COMMENTED OUT: Data validation for other functions
    if (!v2data) {
        logger.error("Failed to fetch V2 seller performance report - continuing with null data");
    }

    if (!v1data) {
        logger.error("Failed to fetch V1 seller performance report - continuing with null data");
    }

    // Finance data validation - ensure it's an array
    if (!Array.isArray(financeData)) {
        if (financeData && typeof financeData === 'object') {
            // Try to extract array from common object structures
            if (Array.isArray(financeData.financialEvents)) {
                financeData = financeData.financialEvents;
                logger.info("Extracted financial events array from object");
            } else if (Array.isArray(financeData.events)) {
                financeData = financeData.events;
                logger.info("Extracted events array from object");
            } else if (Array.isArray(financeData.data)) {
                financeData = financeData.data;
                logger.info("Extracted data array from object");
            } else if (Array.isArray(financeData.items)) {
                financeData = financeData.items;
                logger.info("Extracted items array from object");
            } else {
                logger.warn(`Finance data is an object but no recognizable array property found. Object keys: ${Object.keys(financeData)}`);
                financeData = [];
            }
        } else {
            logger.warn(`Finance data is not an array, received: ${typeof financeData}, converting to empty array`);
            financeData = [];
        }
    }

    // COMMENTED OUT: Other data validation
    if (!CreateCompetitivePricing) {
        logger.warn("Competitive pricing data not available - continuing without it");
    }

    if (!WeeklySales) {
        logger.warn("Weekly sales data not available - continuing without it");
    }

    if (!RestockinventoryData) {
        logger.warn("Restock inventory data not available - continuing without it");
    }

    if (!productReview) {
        // console.log("productReview", productReview);
        logger.warn("Product review data not available - continuing without it");
    }

    if (!shipment) {
        logger.warn("Shipment data not available - continuing without it");
    }

    if (!brandData) {
        logger.warn("Brand data not available - continuing without it");
    }

    if (!negativeKeywords) {
        logger.warn("Negative keywords data not available - continuing without it");
    }

    if (!searchKeywords) {
        logger.warn("Search keywords data not available - continuing without it");
    }

    if (!fbaInventoryPlanningData) {
        logger.warn("FBA Inventory Planning data not available - continuing without it");
    }

    if (!strandedInventoryData) {
        logger.warn("Stranded Inventory data not available - continuing without it");
    }

    if (!inboundNonComplianceData) {
        logger.warn("Inbound Non-Compliance data not available - continuing without it");
    }

    // Return all data from all functions
    const result = {
        MerchantlistingData: merchantListingsData,
        financeData: financeData,
        v2data: v2data,
        v1data: v1data,
        competitivePriceData: Array.isArray(competitivePriceData) ? competitivePriceData : [],
        RestockinventoryData: RestockinventoryData,
        productReview: productReview,
        WeeklySales: WeeklySales,
        shipment: shipment,
        brandData: brandData,
        negativeKeywords: negativeKeywords,
        searchKeywords: searchKeywords,
        fbaInventoryPlanningData: fbaInventoryPlanningData,
        strandedInventoryData: strandedInventoryData,
        inboundNonComplianceData: inboundNonComplianceData,
        adGroupsData: adGroupsData
    }

    // Final validation - log warnings for missing data but continue
    if (financeData.length === 0) {
        logger.warn("No financial data found - continuing with empty finance data");
    }

    return res.status(200).json(new ApiResponse(200, result, "All SP-API and Amazon Ads data has been fetched successfully"));

})

module.exports = { getSpApiData }
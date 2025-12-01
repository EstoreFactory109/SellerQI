const axios = require('axios');
const aws4 = require('aws4');
const logger = require('../../utils/Logger');
const CompetitivePricing= require('../../models/seller-performance/CompetitivePricingModel.js');
const UserModel= require('../../models/user-auth/userModel.js');

const getCompetitivePricing= async (asinArray,dataToReceive,UserId,baseuri,country,region) => {
    logger.info("CompetitivePrices starting");
    
    const host = baseuri;
    
    if (!dataToReceive.marketplaceId) {
        logger.error("Missing marketplaceId in dataToReceive");
        return false;
    }
    
    if (!asinArray || asinArray.length === 0) {
        logger.error("Missing or empty asinArray");
        return false;
    }

    const queryParams = new URLSearchParams({
        MarketplaceId: dataToReceive.marketplaceId,
        Asins: asinArray,   // Provide ASINs as a list
        ItemType: "Asin" // REQUIRED! Must be "Asin" or "Sku"
    }).toString();
  

    const path = `/products/pricing/v0/competitivePrice?${queryParams}`;

    // ✅ Construct Request
    let request = {
        host: host,
        path: path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",  // Recommended
            "content-type": "application/json",
            "x-amz-access-token": dataToReceive.AccessToken
        }
    };

    // ✅ Proper AWS Signing
    aws4.sign(request, {
        accessKeyId: dataToReceive.AccessKey,
        secretAccessKey: dataToReceive.SecretKey,
        sessionToken: dataToReceive.SessionToken // Include only if using temporary credentials
    });

    // ✅ Make Request with Correct Headers
    try {
        const response = await axios.get(`https://${request.host}${request.path}`, { headers: request.headers });
        
        if (!response || !response.data || !response.data.payload) {
            logger.error("Missing payload in competitive pricing response");
            return [];
        }

        const payload = response.data.payload;
        const competitivePriceData = [];

        Object.keys(payload).forEach(asin => {
            const productData = payload[asin];
            
            if (productData.status === "Success" && productData.Product) {
                const competitiveData = productData.Product.CompetitivePricing;
                if (competitiveData && competitiveData.CompetitivePrices) {
                    competitiveData.CompetitivePrices.forEach(price => {
                        competitivePriceData.push({
                            ASIN: asin,
                            Price: price.Price.ListingPrice.Amount,
                            Currency: price.Price.ListingPrice.CurrencyCode,
                            Condition: price.condition,
                            Subcondition: price.subcondition,
                            BelongsToRequester: price.belongsToRequester
                        });
                    });
                }
            }
        });

        logger.info("CompetitivePrices ended");
        return competitivePriceData;

    } catch (error) {
        logger.error(`Error fetching competitive pricing:`, error.response?.data || error.message);
        
        if (error.response) {
            const responseData = error.response.data;
            let isUnauthorizedError = false;
            
            if (Array.isArray(responseData?.errors)) {
                isUnauthorizedError = responseData.errors.some(err => 
                    err && (
                        (err.code || '').toLowerCase() === 'unauthorized' ||
                        (err.message || '').toLowerCase().includes('access to requested resource is denied') ||
                        (err.message || '').toLowerCase().includes('unauthorized')
                    )
                );
            }
            
            if (!isUnauthorizedError) {
                const directCode = (responseData?.code || '').toLowerCase();
                const directMessage = (responseData?.message || '').toLowerCase();
                isUnauthorizedError = (
                    directCode === 'unauthorized' ||
                    directMessage.includes('access to requested resource is denied') ||
                    directMessage.includes('unauthorized')
                );
            }
            
            if (!isUnauthorizedError && error.response.status === 401) {
                isUnauthorizedError = true;
            }
            
            if (isUnauthorizedError) {
                const enhancedError = new Error(`Amazon SP-API Unauthorized: ${JSON.stringify(responseData)}`);
                enhancedError.response = error.response;
                enhancedError.status = error.response.status;
                enhancedError.statusCode = error.response.status;
                enhancedError.amazonApiError = true;
                
                throw enhancedError;
            }
        }
        
        throw new Error(`Competitive pricing API error: ${error.message}`);
    }
};

module.exports={getCompetitivePricing}
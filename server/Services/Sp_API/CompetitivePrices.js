const axios = require('axios');
const aws4 = require('aws4');
const CompetitivePricing= require('../../models/CompetitivePricingModel.js');
const UserModel= require('../../models/userModel.js');

const getCompetitivePricing= async (asinArray,dataToReceive,UserId,baseuri,country,region) => {
    const host = baseuri;  // Correct SP-API host
    // console.log("asin-block: ",asinArray)

    // ✅ Fixed API Path & Required Params

    console.log("dataToReceive marketplaceId: ",dataToReceive.marketplaceId);
    console.log("Region: ", region, "Country: ", country);
    console.log("Base URI: ", baseuri);
    
    // Validate required parameters
    if (!dataToReceive.marketplaceId) {
        console.error("❌ Missing marketplaceId in dataToReceive");
        return false;
    }
    
    if (!asinArray || asinArray.length === 0) {
        console.error("❌ Missing or empty asinArray");
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
            console.error("❌ Missing payload in competitive pricing response");
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
            } else {
                console.warn(`⚠️ No competitive pricing data for ASIN: ${asin}, Status: ${productData.status}`);
            }
        });

        return competitivePriceData;

    } catch (error) {
        console.error(`❌ Error fetching competitive pricing:`, error.response?.data || error.message);
        
        // ===== ENHANCED ERROR PROPAGATION FOR TOKENMANAGER =====
        if (error.response) {
            // Check if this is an Amazon API unauthorized error
            const responseData = error.response.data;
            let isUnauthorizedError = false;
            
            // Check for errors array (Amazon SP-API format)
            if (Array.isArray(responseData?.errors)) {
                isUnauthorizedError = responseData.errors.some(err => 
                    err && (
                        (err.code || '').toLowerCase() === 'unauthorized' ||
                        (err.message || '').toLowerCase().includes('access to requested resource is denied') ||
                        (err.message || '').toLowerCase().includes('unauthorized')
                    )
                );
            }
            
            // Check direct error properties
            if (!isUnauthorizedError) {
                const directCode = (responseData?.code || '').toLowerCase();
                const directMessage = (responseData?.message || '').toLowerCase();
                isUnauthorizedError = (
                    directCode === 'unauthorized' ||
                    directMessage.includes('access to requested resource is denied') ||
                    directMessage.includes('unauthorized')
                );
            }
            
            // Check status code
            if (!isUnauthorizedError && error.response.status === 401) {
                isUnauthorizedError = true;
            }
            
            if (isUnauthorizedError) {
                console.log("🔍 CompetitivePrices: Detected unauthorized error, preserving for TokenManager");
                
                // Create enhanced error that TokenManager can detect
                const enhancedError = new Error(`Amazon SP-API Unauthorized: ${JSON.stringify(responseData)}`);
                enhancedError.response = error.response;
                enhancedError.status = error.response.status;
                enhancedError.statusCode = error.response.status;
                enhancedError.amazonApiError = true; // Flag for TokenManager
                
                throw enhancedError;
            }
        }
        
        // For non-unauthorized errors, throw normally
        throw new Error(`Competitive pricing API error: ${error.message}`);
    }
};

module.exports={getCompetitivePricing}
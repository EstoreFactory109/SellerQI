const axios = require('axios');
const aws4 = require('aws4');
const CompetitivePricing= require('../../models/CompetitivePricingModel.js');
const UserModel= require('../../models/userModel.js');

const getCompetitivePricing= async (asinArray,dataToReceive,UserId,baseuri,country,region) => {
    const host = baseuri;  // Correct SP-API host
    // console.log("asin-block: ",asinArray)

    // ✅ Fixed API Path & Required Params

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
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        sessionToken: dataToReceive.SessionToken // Include only if using temporary credentials
    });

    // ✅ Make Request with Correct Headers
    try {
        const response = await axios.get(`https://${request.host}${request.path}`, { headers: request.headers });
        if(!response || !response.data){
            return false;
        }
        
      
        
        const Products=[];

        response.data.payload.forEach(element => {
            
            if(element.Product.CompetitivePricing.CompetitivePrices.length===0){
                                // console.log(element.Product.CompetitivePricing.CompetitivePrices)
                    // console.log(element.Product.CompetitivePricing.CompetitivePrices.length)
                Products.push({
                asin: element.ASIN,
                belongsToRequester:false
            })
            }else{
                                    // console.log(element.Product.CompetitivePricing.CompetitivePrices)
                 Products.push({
                asin: element.ASIN,
                belongsToRequester:element.Product?.CompetitivePricing.CompetitivePrices[0].belongsToRequester
            })
        }
            
        })
        return Products

    } catch (error) {
        console.error("❌ Error Fetching Catalog:", error.response?.data || error.message);
        return false;
    }
};

module.exports={getCompetitivePricing}
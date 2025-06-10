const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const aws4 = require('aws4');
const logger = require('../../utils/Logger.js');
const ApiError = require('../../utils/ApiError.js'); // If you're using custom ApiError
const SellerCentralModel = require('../../models/sellerCentralModel.js');

// ✅ Setup axios-retry globally
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return (
      axiosRetry.isNetworkError(error) ||
      axiosRetry.isRetryableError(error) ||
      error.response?.status === 429 ||
      error.response?.status >= 500
    );
  }
});

const getBrand = async ( asin,marketplaceId,SessionToken, baseuri,accessToken,UserId) => {
  const host = baseuri;

  const queryParams = `marketplaceIds=${marketplaceId}&includedData=attributes`

  const path = `/catalog/2022-04-01/items/${asin}`;
  const fullUrl = `https://${host}${path}?${queryParams}`;

  let request = {
    host: host,
    path: path,
    method: "GET",
    headers: {
      "host": host,
            "user-agent": "MyApp/1.0",
            "content-type": "application/json",
            "x-amz-access-token": accessToken
    }
  };

  // ✅ AWS signing
  aws4.sign(request, {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
    sessionToken: SessionToken,
    service: 'execute-api',
    region: 'us-east-1'
  });

  try {
    const response = await axios.get(fullUrl, {
      headers: request.headers
    });

    const sellerCentral = await SellerCentralModel.findOne({User:UserId})

    if(!sellerCentral){
      logger.error(new ApiError(400, "Seller Central not found"));
      return false;
    }
   
    const brand = response.data.attributes.brand[0].value
    sellerCentral.brand = brand
    await sellerCentral.save()

    return brand

  } catch (error) {
    console.error(`❌ Error fetching brand for ASIN: ${asin}:`, error.response?.data || error.message);
    return false;
  }
};

module.exports = { getBrand };

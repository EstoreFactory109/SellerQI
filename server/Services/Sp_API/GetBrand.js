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

const getBrand = async ( dataToReceive,UserId, baseuri,) => {
  const host = baseuri;

  // Validate input parameters
  if (!dataToReceive || !dataToReceive.ASIN || !Array.isArray(dataToReceive.ASIN) || dataToReceive.ASIN.length === 0) {
    logger.error("Invalid dataToReceive or no ASINs provided for brand data");
    return null;
  }

  const queryParams = `marketplaceIds=${dataToReceive.marketplaceId}&includedData=attributes`

  const path = `/catalog/2022-04-01/items/${dataToReceive.ASIN[0]}`;
  const fullUrl = `https://${host}${path}?${queryParams}`;

  let request = {
    host: host,
    path: `${path}?${queryParams}`,
    method: "GET",
    headers: {
      "host": host,
            "user-agent": "MyApp/1.0",
            "content-type": "application/json",
            "x-amz-access-token": dataToReceive.AccessToken
    }
  };

  // ✅ AWS signing with credentials from dataToReceive
  aws4.sign(request, {
    accessKeyId: dataToReceive.AccessKey,
    secretAccessKey: dataToReceive.SecretKey,
    sessionToken: dataToReceive.SessionToken,
    service: 'execute-api',
    region: 'us-east-1'
  });

  try {
    const response = await axios.get(fullUrl, {
      headers: request.headers
    });

    // Validate response structure
    if (!response.data || !response.data.attributes) {
      logger.warn(`No attributes found in response for ASIN: ${dataToReceive.ASIN[0]}`);
      return null;
    }

    // Check if brand data exists in the response
    if (!response.data.attributes.brand || !Array.isArray(response.data.attributes.brand) || response.data.attributes.brand.length === 0) {
      logger.warn(`No brand data found for ASIN: ${dataToReceive.ASIN[0]}`);
      return null;
    }

    const brandValue = response.data.attributes.brand[0]?.value;
    if (!brandValue) {
      logger.warn(`Brand value is empty for ASIN: ${dataToReceive.ASIN[0]}`);
      return null;
    }

    // Find and update seller central data
    const sellerCentral = await SellerCentralModel.findOne({User: UserId});

    if(!sellerCentral){
      logger.error("Seller Central not found for user: " + UserId);
      return null;
    }
   
    // Update brand in seller central
    sellerCentral.brand = brandValue;
    await sellerCentral.save();

    logger.info(`Successfully saved brand: ${brandValue} for user: ${UserId}`);
    return brandValue;

  } catch (error) {
    console.error(`❌ Error fetching brand for ASIN: ${dataToReceive.ASIN[0]}:`, error.response?.data || error.message);
    
    // Log specific error details for debugging
    if (error.response) {
      logger.error(`HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    } else {
      logger.error(`Request failed: ${error.message}`);
    }
    
    return null;
  }
};

module.exports = { getBrand };

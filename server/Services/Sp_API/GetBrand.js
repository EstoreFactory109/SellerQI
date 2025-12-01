const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const aws4 = require('aws4');
const logger = require('../../utils/Logger.js');
const ApiError = require('../../utils/ApiError.js'); // If you're using custom ApiError
const SellerCentralModel = require('../../models/user-auth/sellerCentralModel.js');

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
  logger.info("GetBrand starting");
  
  const host = baseuri;

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

    if (!response.data || !response.data.attributes) {
      return null;
    }

    if (!response.data.attributes.brand || !Array.isArray(response.data.attributes.brand) || response.data.attributes.brand.length === 0) {
      return null;
    }

    const brandValue = response.data.attributes.brand[0]?.value;
    if (!brandValue) {
      return null;
    }

    const sellerCentral = await SellerCentralModel.findOne({User: UserId});

    if(!sellerCentral){
      logger.error("Seller Central not found for user: " + UserId);
      return null;
    }
   
    sellerCentral.brand = brandValue;
    await sellerCentral.save();

    logger.info("GetBrand ended");
    return brandValue;

  } catch (error) {
    logger.error(`Error fetching brand for ASIN: ${dataToReceive.ASIN[0]}:`, error.response?.data || error.message);
    
    if (error.response) {
      logger.error(`HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    } else {
      logger.error(`Request failed: ${error.message}`);
    }
    
    return null;
  }
};

module.exports = { getBrand };

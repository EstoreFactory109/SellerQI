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

const getBrand = async ( dataToReceive, UserId, baseuri) => {
  logger.info("GetBrand starting", { 
    userId: UserId, 
    baseuri,
    hasAsin: !!(dataToReceive?.ASIN?.length),
    asinCount: dataToReceive?.ASIN?.length || 0
  });
  
  const host = baseuri;

  if (!dataToReceive || !dataToReceive.ASIN || !Array.isArray(dataToReceive.ASIN) || dataToReceive.ASIN.length === 0) {
    logger.warn("GetBrand: No ASINs provided for brand data", { userId: UserId });
    return { success: true, data: null, message: "No ASINs provided" };
  }

  if (!UserId || !baseuri) {
    logger.error("GetBrand: Missing required parameters", { userId: UserId, baseuri });
    return { success: false, error: "Missing required parameters" };
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
      logger.warn("GetBrand: No attributes in response", { userId: UserId, asin: dataToReceive.ASIN[0] });
      return { success: true, data: null, message: "No attributes in catalog response" };
    }

    if (!response.data.attributes.brand || !Array.isArray(response.data.attributes.brand) || response.data.attributes.brand.length === 0) {
      logger.warn("GetBrand: No brand attribute found", { userId: UserId, asin: dataToReceive.ASIN[0] });
      return { success: true, data: null, message: "No brand attribute found" };
    }

    const brandValue = response.data.attributes.brand[0]?.value;
    if (!brandValue) {
      logger.warn("GetBrand: Brand value is empty", { userId: UserId, asin: dataToReceive.ASIN[0] });
      return { success: true, data: null, message: "Brand value is empty" };
    }

    const sellerCentral = await SellerCentralModel.findOne({User: UserId});

    if(!sellerCentral){
      logger.error("GetBrand: Seller Central not found for user", { userId: UserId });
      return { success: false, error: "Seller Central not found" };
    }
   
    sellerCentral.brand = brandValue;
    await sellerCentral.save();

    logger.info("GetBrand completed successfully", { 
      userId: UserId, 
      brand: brandValue,
      asin: dataToReceive.ASIN[0]
    });
    return { success: true, data: brandValue };

  } catch (error) {
    logger.error("GetBrand error", {
      error: error.message,
      asin: dataToReceive.ASIN[0],
      userId: UserId,
      status: error.response?.status,
      responseData: error.response?.data
    });
    
    return { success: false, error: error.message };
  }
};

module.exports = { getBrand };

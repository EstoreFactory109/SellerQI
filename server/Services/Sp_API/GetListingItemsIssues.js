const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const aws4 = require('aws4');
const logger = require('../../utils/Logger.js');
const ApiError = require('../../utils/ApiError.js'); // If you're using custom ApiError

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

const GetListingItem = async (dataToReceive, sku, asin, userId, baseuri, Country, Region) => {
  logger.info("GetListingItemsIssues starting");
  
  const host = baseuri;

  const queryParams = new URLSearchParams({
    marketplaceIds: dataToReceive.marketplaceId,
    issueLocale: dataToReceive.issueLocale,
    includedData: dataToReceive.includedData
  }).toString();

  const path = `/listings/2021-08-01/items/${dataToReceive.SellerId}/${sku}?${queryParams}`;
  const fullUrl = `https://${host}${path}`;

  let request = {
    host: host,
    path: path,
    method: "GET",
    headers: {
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

    const keywordData = response.data?.attributes?.generic_keyword?.[0];

    if (!keywordData) {
      logger.error(`No generic_keyword found for SKU: ${sku}`);
      return false;
    }

    const generic_Keyword = {
      asin: asin,
      value: keywordData.value,
      marketplace_id: keywordData.marketplace_id
    };

    logger.info("GetListingItemsIssues ended");
    return generic_Keyword;

  } catch (error) {
    logger.error(`Error fetching catalog for SKU: ${sku}:`, error.response?.data || error.message);
    
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
            const enhancedError = new Error(`Amazon SP-API Unauthorized for SKU ${sku}: ${JSON.stringify(responseData)}`);
            enhancedError.response = error.response;
            enhancedError.status = error.response.status;
            enhancedError.statusCode = error.response.status;
            enhancedError.amazonApiError = true;
            
            throw enhancedError;
        }
    }
    
    return false;
  }
};

module.exports = { GetListingItem };

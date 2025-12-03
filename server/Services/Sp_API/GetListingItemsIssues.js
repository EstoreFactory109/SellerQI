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
  logger.info("GetListingItemsIssues starting", { sku, asin, Country, Region });
  
  const host = baseuri;

  // URL encode the SKU to handle special characters (hyphens, spaces, etc.)
  // Use encodeURIComponent but then replace %2F back to / if needed for path compatibility
  const encodedSku = encodeURIComponent(sku);

  // Determine AWS region from SP-API region
  // SP-API regions: NA (us-east-1), EU (eu-west-1), FE (us-west-2)
  let awsRegion = 'us-east-1'; // Default for NA
  if (Region === 'EU') {
    awsRegion = 'eu-west-1';
  } else if (Region === 'FE') {
    awsRegion = 'us-west-2';
  }

  // Build query parameters
  // For includedData, Amazon expects multiple query params OR comma-separated values
  // Using URLSearchParams and appending each includedData value separately
  const queryParamsObj = new URLSearchParams();
  queryParamsObj.append('marketplaceIds', dataToReceive.marketplaceId);
  queryParamsObj.append('issueLocale', dataToReceive.issueLocale);
  
  // Handle includedData - can be comma-separated string or array
  const includedDataValues = typeof dataToReceive.includedData === 'string' 
    ? dataToReceive.includedData.split(',').map(v => v.trim())
    : dataToReceive.includedData;
  
  // Append each includedData value as a separate parameter
  includedDataValues.forEach(value => {
    queryParamsObj.append('includedData', value);
  });
  
  const queryParams = queryParamsObj.toString();

  // Build the path with encoded SKU
  const path = `/listings/2021-08-01/items/${dataToReceive.SellerId}/${encodedSku}?${queryParams}`;
  const fullUrl = `https://${host}${path}`;

  // Validate issueLocale format - Amazon expects formats like "en_US", "en_AU", "en_GB"
  // But some regions might need different handling
  let issueLocale = dataToReceive.issueLocale;
  
  // Log all request parameters for debugging
  logger.info("GetListingItemsIssues request details", {
    host,
    encodedSku,
    originalSku: sku,
    awsRegion,
    sellerId: dataToReceive.SellerId,
    marketplaceId: dataToReceive.marketplaceId,
    issueLocale,
    includedData: dataToReceive.includedData
  });

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
    region: awsRegion
  });
  
  logger.info("GetListingItemsIssues full URL", { fullUrl });

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

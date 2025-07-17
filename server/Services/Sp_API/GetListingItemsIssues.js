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
      // console.log("🎯 GetListingItem function called for SKU:", sku, "ASIN:", asin);
  
  const host = baseuri;

  const queryParams = new URLSearchParams({
    marketplaceIds: dataToReceive.marketplaceId,
    issueLocale: dataToReceive.issueLocale,
    includedData: dataToReceive.includedData
  }).toString();

      // console.log("queryParams: ", queryParams);
    // console.log("sku: ", sku);

  const path = `/listings/2021-08-01/items/${dataToReceive.SellerId}/${sku}?${queryParams}`;
  const fullUrl = `https://${host}${path}`;

      // console.log("dataToReceive: ", dataToReceive);

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

      // console.log("request: ", request);
  // ✅ AWS signing
  aws4.sign(request, {
    accessKeyId: dataToReceive.AccessKey,
    secretAccessKey: dataToReceive.SecretKey,
    sessionToken: dataToReceive.SessionToken,
    service: 'execute-api',
    region: 'us-east-1'
  });

  try {
    // console.log("🚀 Making API call to:", fullUrl);
    
    const response = await axios.get(fullUrl, {
      headers: request.headers
    });

          // console.log("✅ API call successful!");
      // console.log("📄 Full response:", JSON.stringify(response.data, null, 2));
      // console.log("🔍 Response attributes:", response.data?.attributes);
      // console.log("🔍 Generic keyword path:", response.data?.attributes?.generic_keyword);

    const keywordData = response.data?.attributes?.generic_keyword?.[0];

          // console.log("keywordData: ", keywordData);
      // console.log("🔍 Type of keywordData:", typeof keywordData);

    if (!keywordData) {
              // console.log("❌ keywordData is falsy:", keywordData);
      logger.error(`❌ No generic_keyword found for SKU: ${sku}`);
      return false;
    }

    const generic_Keyword = {
      asin: asin,
      value: keywordData.value,
      marketplace_id: keywordData.marketplace_id
    };

    return generic_Keyword;

  } catch (error) {
          // console.log("❌❌❌ API CALL FAILED ❌❌❌");
      // console.log("🔍 Error type:", error.constructor.name);
      // console.log("🔍 Error message:", error.message);
      // console.log("🔍 Error status:", error.response?.status);
      // console.log("🔍 Error data:", JSON.stringify(error.response?.data, null, 2));
      // console.log("🔍 Request URL:", fullUrl);
      // console.log("🔍 Request headers:", JSON.stringify(request.headers, null, 2));
    
    console.error(`❌ Error fetching catalog for SKU: ${sku}:`, error.response?.data || error.message);
    
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
            console.log(`🔍 GetListingItem: Detected unauthorized error for SKU ${sku}, preserving for TokenManager`);
            
            // Create enhanced error that TokenManager can detect
            const enhancedError = new Error(`Amazon SP-API Unauthorized for SKU ${sku}: ${JSON.stringify(responseData)}`);
            enhancedError.response = error.response;
            enhancedError.status = error.response.status;
            enhancedError.statusCode = error.response.status;
            enhancedError.amazonApiError = true; // Flag for TokenManager
            
            throw enhancedError;
        }
    }
    
    // For non-unauthorized errors, return false as before
    return false;
  }
};

module.exports = { GetListingItem };

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

    // Check for B2B pricing in purchasable_offer array (always check, even if generic_keyword is missing)
    let hasB2BPricing = false;
    const purchasableOffer = response.data?.attributes?.purchasable_offer;
    if (Array.isArray(purchasableOffer)) {
      hasB2BPricing = purchasableOffer.some(offer => 
        offer && offer.audience === "B2B"
      );
    }

    // If generic_keyword is missing, still return B2B pricing info
    if (!keywordData) {
      logger.warn(`No generic_keyword found for SKU: ${sku}, but returning B2B pricing info`, {
        sku,
        asin,
        has_b2b_pricing: hasB2BPricing
      });
      
      // Return object with B2B pricing even without generic_keyword
      return {
        asin: asin,
        value: null,
        marketplace_id: null,
        has_b2b_pricing: hasB2BPricing,
        sku: sku
      };
    }

    const generic_Keyword = {
      asin: asin,
      value: keywordData.value,
      marketplace_id: keywordData.marketplace_id,
      has_b2b_pricing: hasB2BPricing,
      sku: sku
    };

    logger.info("GetListingItemsIssues ended", { has_b2b_pricing: hasB2BPricing });
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

/**
 * Get listing item issues for inactive SKUs
 * Fetches issues from Amazon SP-API for a specific SKU
 * @param {Object} dataToReceive - Data object containing API credentials and parameters
 * @param {string} sku - SKU to fetch issues for
 * @param {string} asin - ASIN associated with the SKU
 * @param {string} userId - User ID
 * @param {string} baseuri - Base URI for the SP-API endpoint
 * @param {string} Country - Country code
 * @param {string} Region - Region (NA, EU, FE)
 * @returns {Object|false} Object containing sku and issues array, or false on error
 */
const GetListingItemIssuesForInactive = async (dataToReceive, sku, asin, userId, baseuri, Country, Region) => {
  logger.info("GetListingItemIssuesForInactive starting", { sku, asin, Country, Region });
  
  const host = baseuri;

  // URL encode the SKU to handle special characters (hyphens, spaces, etc.)
  const encodedSku = encodeURIComponent(sku);

  // Determine AWS region from SP-API region
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
  // For inactive SKUs, we need at least issues and offers
  const includedDataValues = typeof dataToReceive.includedData === 'string' 
    ? dataToReceive.includedData.split(',').map(v => v.trim())
    : (dataToReceive.includedData || ['issues', 'offers']);
  
  // Ensure issues and offers are included
  const requiredData = ['issues', 'offers'];
  const finalIncludedData = [...new Set([...requiredData, ...includedDataValues])];
  
  // Append each includedData value as a separate parameter
  finalIncludedData.forEach(value => {
    queryParamsObj.append('includedData', value);
  });
  
  const queryParams = queryParamsObj.toString();

  // Build the path with encoded SKU
  const path = `/listings/2021-08-01/items/${dataToReceive.SellerId}/${encodedSku}?${queryParams}`;
  const fullUrl = `https://${host}${path}`;

  logger.info("GetListingItemIssuesForInactive request details", {
    host,
    encodedSku,
    originalSku: sku,
    awsRegion,
    sellerId: dataToReceive.SellerId,
    marketplaceId: dataToReceive.marketplaceId,
    issueLocale: dataToReceive.issueLocale,
    includedData: finalIncludedData
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
  
  logger.info("GetListingItemIssuesForInactive full URL", { fullUrl });

  try {
    const response = await axios.get(fullUrl, {
      headers: request.headers
    });

    // Extract issues from the response
    const issuesArray = response.data?.issues || [];
    
    // If issues array is empty, use the default message for inactive SKUs
    let issuesMessages = [];
    if (issuesArray.length === 0) {
      issuesMessages = ["The selling offer is currently inactive"];
    } else {
      // Extract the message from each issue object
      issuesMessages = issuesArray.map(issue => issue.message || JSON.stringify(issue));
    }

    // Check for B2B pricing in purchasable_offer array
    let hasB2BPricing = false;
    const purchasableOffer = response.data?.attributes?.purchasable_offer;
    if (Array.isArray(purchasableOffer)) {
      hasB2BPricing = purchasableOffer.some(offer => 
        offer && offer.audience === "B2B"
      );
    }

    logger.info("GetListingItemIssuesForInactive ended", { 
      sku, 
      issuesCount: issuesMessages.length,
      has_b2b_pricing: hasB2BPricing
    });

    return {
      sku: sku,
      asin: asin,
      issues: issuesMessages,
      has_b2b_pricing: hasB2BPricing
    };

  } catch (error) {
    logger.error(`Error fetching issues for inactive SKU: ${sku}:`, error.response?.data || error.message);
    
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

module.exports = { GetListingItem, GetListingItemIssuesForInactive };

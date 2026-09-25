const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const aws4 = require('aws4');
const logger = require('../../utils/Logger.js');
const ApiError = require('../../utils/ApiError.js'); // If you're using custom ApiError

// Timeout for SP-API requests (60 seconds) - prevents indefinite hangs
const REQUEST_TIMEOUT_MS = 60000;

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

/**
 * Amazon's enforcement actions that mean a listing is not being shown to
 * shoppers. The report calls these suppressions; Amazon spells them several
 * ways depending on how the listing was penalised.
 */
const SUPPRESSION_ACTIONS = new Set([
    'LISTING_SUPPRESSED',
    'ATTRIBUTE_SUPPRESSED',
    'CATALOG_ITEM_REMOVED',
    'SEARCH_SUPPRESSED',
]);

/**
 * Keep the whole of each listing issue, not just its message.
 *
 * Both call sites below already ask Amazon for `includedData=issues`, and both
 * threw away everything except `message` — the active-SKU path discarded the
 * issues array entirely. That lost the only signal that says a listing is
 * SUPPRESSED rather than merely imperfect, which is the difference between "fix
 * when you get a chance" and "this product cannot be bought right now".
 *
 * Shapes are read defensively. The exact nesting of `enforcements` could not be
 * confirmed against a live response (no working SP-API credentials on the
 * machine this was written on), so several spellings are accepted and anything
 * unrecognised is preserved in `raw` rather than dropped.
 *
 * @param {Array} issuesArray  response.data.issues
 * @returns {Array} structured issues, safe to store
 */
const extractListingIssues = (issuesArray) => {
    if (!Array.isArray(issuesArray)) return [];

    return issuesArray.map((issue) => {
        // enforcements.actions[].action is the documented shape; the flatter
        // spellings are accepted in case the field arrives differently.
        const actionNodes = issue?.enforcements?.actions
            || issue?.enforcements
            || issue?.enforcementActions
            || [];
        const actions = (Array.isArray(actionNodes) ? actionNodes : [])
            .map((entry) => (typeof entry === 'string' ? entry : entry?.action || entry?.name || ''))
            .filter(Boolean)
            .map((action) => String(action).toUpperCase());

        return {
            code: String(issue?.code || ''),
            message: String(issue?.message || ''),
            severity: String(issue?.severity || '').toUpperCase(),
            attributeNames: Array.isArray(issue?.attributeNames) ? issue.attributeNames.map(String) : [],
            categories: Array.isArray(issue?.categories) ? issue.categories.map(String) : [],
            enforcementActions: actions,
            // Amazon can grant a temporary exemption; a suppressed-but-exempt
            // listing is still selling, so the two must not be conflated.
            exemptionStatus: String(issue?.enforcements?.exemption?.status || ''),
            isSuppression: actions.some((action) => SUPPRESSION_ACTIONS.has(action)),
        };
    });
};

const GetListingItem = async (dataToReceive, sku, asin, userId, baseuri, Country, Region) => {
  logger.debug("GetListingItemsIssues starting", { sku, asin, Country, Region });
  
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
  // Amazon Listings API expects includedData as comma-separated values (collectionFormat: csv)
  const queryParamsObj = new URLSearchParams();
  queryParamsObj.append('marketplaceIds', dataToReceive.marketplaceId);
  queryParamsObj.append('issueLocale', dataToReceive.issueLocale);
  
  // Handle includedData - ensure it's a comma-separated string
  const includedDataValues = typeof dataToReceive.includedData === 'string' 
    ? dataToReceive.includedData
    : (Array.isArray(dataToReceive.includedData) ? dataToReceive.includedData.join(',') : 'summaries');
  
  // Add includedData as a single comma-separated parameter
  queryParamsObj.append('includedData', includedDataValues);
  
  const queryParams = queryParamsObj.toString();

  // Build the path with encoded SKU
  const path = `/listings/2021-08-01/items/${dataToReceive.SellerId}/${encodedSku}?${queryParams}`;
  const fullUrl = `https://${host}${path}`;

  // Validate issueLocale format - Amazon expects formats like "en_US", "en_AU", "en_GB"
  // But some regions might need different handling
  let issueLocale = dataToReceive.issueLocale;
  
  // Log all request parameters for debugging
  logger.debug("GetListingItemsIssues request details", {
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
  
  logger.debug("GetListingItemsIssues full URL", { fullUrl });

  try {
    const response = await axios.get(fullUrl, {
      headers: request.headers,
      timeout: REQUEST_TIMEOUT_MS
    });

    const keywordData = response.data?.attributes?.generic_keyword?.[0];

    // This path already asked for includedData=issues and then ignored the
    // answer entirely. An ACTIVE listing can still be suppressed, so the issues
    // matter as much here as on the inactive path below.
    const listingIssues = extractListingIssues(response.data?.issues);

    // Check for B2B pricing in multiple locations:
    // 1. response.data.offers array (offerType === "B2B")
    // 2. response.data.attributes.purchasable_offer array (audience === "B2B")
    let hasB2BPricing = false;
    
    // Method 1: Check offers array (primary location)
    const offers = response.data?.offers;
    if (Array.isArray(offers) && offers.length > 0) {
      hasB2BPricing = offers.some(offer => 
        offer && offer.offerType === "B2B"
      );
    }
    
    // Method 2: If not found in offers, check attributes.purchasable_offer (fallback)
    if (!hasB2BPricing) {
      const purchasableOffers = response.data?.attributes?.purchasable_offer;
      if (Array.isArray(purchasableOffers) && purchasableOffers.length > 0) {
        hasB2BPricing = purchasableOffers.some(offer => 
          offer && offer.audience === "B2B"
        );
      }
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
        listingIssues,
        sku: sku
      };
    }

    const generic_Keyword = {
      asin: asin,
      value: keywordData.value,
      marketplace_id: keywordData.marketplace_id,
      has_b2b_pricing: hasB2BPricing,
      listingIssues,
      sku: sku
    };

    logger.debug("GetListingItemsIssues ended", { has_b2b_pricing: hasB2BPricing });
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
  logger.debug("GetListingItemIssuesForInactive starting", { sku, asin, Country, Region });
  
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
  // Amazon Listings API expects includedData as comma-separated values (collectionFormat: csv)
  const queryParamsObj = new URLSearchParams();
  queryParamsObj.append('marketplaceIds', dataToReceive.marketplaceId);
  queryParamsObj.append('issueLocale', dataToReceive.issueLocale);
  
  // Handle includedData - ensure issues and offers are included for inactive SKUs
  let includedDataValues = typeof dataToReceive.includedData === 'string' 
    ? dataToReceive.includedData.split(',').map(v => v.trim())
    : (dataToReceive.includedData || ['issues', 'offers']);
  
  // Ensure issues and offers are included
  const requiredData = ['issues', 'offers', 'attributes'];
  const finalIncludedData = [...new Set([...requiredData, ...includedDataValues])];
  
  // Add includedData as a single comma-separated parameter
  queryParamsObj.append('includedData', finalIncludedData.join(','));
  
  const queryParams = queryParamsObj.toString();

  // Build the path with encoded SKU
  const path = `/listings/2021-08-01/items/${dataToReceive.SellerId}/${encodedSku}?${queryParams}`;
  const fullUrl = `https://${host}${path}`;

  logger.debug("GetListingItemIssuesForInactive request details", {
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
  
  logger.debug("GetListingItemIssuesForInactive full URL", { fullUrl });

  try {
    const response = await axios.get(fullUrl, {
      headers: request.headers,
      timeout: REQUEST_TIMEOUT_MS
    });

    // Extract issues from the response
    const issuesArray = response.data?.issues || [];

    // The full issue objects, kept beside the plain messages. The messages stay
    // exactly as they were: a lot of downstream code reads products[].issues as
    // an array of strings and must not break.
    const listingIssues = extractListingIssues(issuesArray);

    // If issues array is empty, use the default message for inactive SKUs
    let issuesMessages = [];
    if (issuesArray.length === 0) {
      issuesMessages = ["The selling offer is currently inactive"];
    } else {
      // Extract the message from each issue object
      issuesMessages = issuesArray.map(issue => issue.message || JSON.stringify(issue));
    }

    // Check for B2B pricing in multiple locations:
    // 1. response.data.offers array (offerType === "B2B")
    // 2. response.data.attributes.purchasable_offer array (audience === "B2B")
    let hasB2BPricing = false;
    
    // Method 1: Check offers array (primary location)
    const offers = response.data?.offers;
    if (Array.isArray(offers) && offers.length > 0) {
      hasB2BPricing = offers.some(offer => 
        offer && offer.offerType === "B2B"
      );
    }
    
    // Method 2: If not found in offers, check attributes.purchasable_offer (fallback)
    if (!hasB2BPricing) {
      const purchasableOffers = response.data?.attributes?.purchasable_offer;
      if (Array.isArray(purchasableOffers) && purchasableOffers.length > 0) {
        hasB2BPricing = purchasableOffers.some(offer => 
          offer && offer.audience === "B2B"
        );
      }
    }

    logger.debug("GetListingItemIssuesForInactive ended", {
      sku, 
      issuesCount: issuesMessages.length,
      has_b2b_pricing: hasB2BPricing
    });

    return {
      sku: sku,
      asin: asin,
      issues: issuesMessages,
      listingIssues,
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
// Exported for tests: the enforcement parsing is the part that can be checked
// without a live Amazon response, and the part most likely to be quietly wrong.
module.exports.extractListingIssues = extractListingIssues;
module.exports.SUPPRESSION_ACTIONS = SUPPRESSION_ACTIONS;

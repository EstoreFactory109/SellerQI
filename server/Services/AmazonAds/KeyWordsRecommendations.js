const axios = require('axios');
const logger = require('../../utils/Logger.js');
const { AsinKeywordRecommendations, KeywordRecommendations } = require('../../models/amazon-ads/KeywordRecommendationsModel.js');

// Base URIs for different regions (same as other Amazon Ads services)
const BASE_URIS = {
  'NA': 'https://advertising-api.amazon.com',
  'EU': 'https://advertising-api-eu.amazon.com',
  'FE': 'https://advertising-api-fe.amazon.com'
};

// Map country codes to locale strings
const COUNTRY_TO_LOCALE = {
  // North America
  'US': 'en_US',
  'CA': 'en_CA',
  'MX': 'es_MX',
  'BR': 'pt_BR',
  
  // Europe
  'IE': 'en_IE',  // Ireland
  'ES': 'es_ES',  // Spain
  'GB': 'en_GB',
  'UK': 'en_GB',  // United Kingdom
  'FR': 'fr_FR',  // France
  'BE': 'nl_BE',  // Belgium (Dutch locale)
  'NL': 'nl_NL',  // Netherlands
  'DE': 'de_DE',  // Germany
  'IT': 'it_IT',  // Italy
  'SE': 'sv_SE',  // Sweden
  'ZA': 'en_ZA',  // South Africa
  'PL': 'pl_PL',  // Poland
  'EG': 'ar_EG',  // Egypt
  'TR': 'tr_TR',  // Turkey
  'SA': 'ar_SA',  // Saudi Arabia
  'AE': 'ar_AE',  // United Arab Emirates
  'IN': 'en_IN',  // India
  
  // Far East
  'SG': 'en_SG',  // Singapore
  'AU': 'en_AU',  // Australia
  'JP': 'ja_JP'   // Japan
};

/**
 * Get locale string based on country code
 * @param {string} country - Country code (e.g., 'US', 'GB', 'DE')
 * @returns {string} - Locale string (e.g., 'en_US', 'en_GB', 'de_DE')
 */
function getLocaleFromCountry(country) {
  if (!country) {
    return 'en_US'; // Default to US English
  }
  
  const countryUpper = country.toUpperCase();
  return COUNTRY_TO_LOCALE[countryUpper] || 'en_US'; // Default to en_US if country not found
}

/**
 * Split array into chunks of specified size
 * @param {Array} array - Array to chunk
 * @param {number} chunkSize - Size of each chunk
 * @returns {Array<Array>} - Array of chunks
 */
function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Delay execution for specified milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} - Promise that resolves after delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make a single API request for keyword recommendations for ONE ASIN
 * @param {string} url - API endpoint URL
 * @param {Object} headers - Request headers
 * @param {string} asin - Single ASIN for this request
 * @param {string} locale - Locale string
 * @returns {Promise<Object>} - API response data with ASIN included
 */
async function makeKeywordRecommendationRequestForAsin(url, headers, asin, locale) {
  const requestBody = {
    recommendationType: 'KEYWORDS_FOR_ASINS',
    biddingStrategy: 'AUTO_FOR_SALES',
    sortDimension: 'CLICKS',
    asins: [asin], // Single ASIN in array
    bidsEnabled: true,
    locale: locale,
    maxRecommendations: '200'
  };

  const response = await axios.post(url, requestBody, { headers });

  if (!response || !response.data) {
    throw new Error('Invalid response from Amazon Ads API - no data received');
  }

  return {
    asin: asin,
    keywordTargetList: response.data.keywordTargetList || []
  };
}

/**
 * Process a single ASIN - fetch keywords and save to database
 * @param {string} url - API endpoint URL
 * @param {Object} headers - Request headers
 * @param {string} asin - Single ASIN
 * @param {string} locale - Locale string
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Promise<Object>} - Result with ASIN and status
 */
async function processAsin(url, headers, asin, locale, userId, country, region) {
  try {
    // Fetch keywords for this ASIN
    const result = await makeKeywordRecommendationRequestForAsin(url, headers, asin, locale);
    
    // Save to database using upsert
    const savedData = await AsinKeywordRecommendations.upsertAsinKeywords(
      userId,
      country,
      region,
      asin,
      result.keywordTargetList
    );

    logger.info(`✅ ASIN ${asin}: ${result.keywordTargetList.length} keywords saved`);

    return {
      asin: asin,
      success: true,
      keywordCount: result.keywordTargetList.length,
      savedId: savedData._id
    };

  } catch (error) {
    logger.error(`❌ ASIN ${asin}: Error - ${error.message}`);
    
    // Re-throw auth errors for TokenManager
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      throw error;
    }

    return {
      asin: asin,
      success: false,
      error: error.message,
      keywordCount: 0
    };
  }
}

/**
 * Get keyword recommendations for given ASINs - processes ONE ASIN at a time
 * Uses Promise.all to process 5 ASINs concurrently in batches
 * @param {string} accessToken - Access token for authentication
 * @param {string} profileId - Amazon Ads profile ID
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code (NA, EU, or FE)
 * @param {Array<string>} asins - Array of ASINs to get recommendations for
 * @returns {Promise<Object>} - API response with keyword recommendations
 */
async function getKeywordRecommendations(accessToken, profileId, userId, country, region, asins) {
  logger.info("getKeywordRecommendations starting (ASIN-wise approach)");
  
  try {
    // ===== INPUT VALIDATION =====
    if (!userId) {
      throw new Error('User ID is required');
    }

    if (!country) {
      throw new Error('Country is required');
    }

    if (!region) {
      throw new Error('Region is required');
    }

    if (!profileId) {
      throw new Error('Profile ID is required');
    }

    if (!accessToken) {
      throw new Error('Access token is required');
    }

    if (!Array.isArray(asins) || asins.length === 0) {
      throw new Error('ASINs array is required and must not be empty');
    }

    // Validate region and get base URI
    const baseUri = BASE_URIS[region];
    if (!baseUri) {
      throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
    }

    // Validate environment variable
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
      throw new Error('AMAZON_ADS_CLIENT_ID not found in environment variables');
    }

    // Get locale based on country
    const locale = getLocaleFromCountry(country);

    // Construct the endpoint URL
    const url = `${baseUri}/sp/targets/keywords/recommendations`;

    // Set up headers
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': clientId,
      'Amazon-Advertising-API-Scope': String(profileId),
      'Content-Type': 'application/vnd.spkeywordsrecommendation.v5+json'
    };

    // ===== PROCESS ASINS IN BATCHES OF 5 =====
    const BATCH_SIZE = 5; // Process 5 ASINs concurrently
    const BATCH_DELAY_MS = 1000; // 1 second delay between batches

    const asinBatches = chunkArray(asins, BATCH_SIZE);
    const allResults = [];
    let totalKeywordsFound = 0;
    let successCount = 0;
    let failCount = 0;

    logger.info(`Processing ${asins.length} ASINs in ${asinBatches.length} batches of ${BATCH_SIZE}`);

    for (let batchIndex = 0; batchIndex < asinBatches.length; batchIndex++) {
      const batch = asinBatches[batchIndex];
      const batchNumber = batchIndex + 1;
      
      logger.info(`📦 Batch ${batchNumber}/${asinBatches.length}: Processing ${batch.length} ASINs`);

      // Process all ASINs in this batch concurrently using Promise.all
      const batchPromises = batch.map(asin => 
        processAsin(url, headers, asin, locale, userId, country, region)
      );

      try {
        const batchResults = await Promise.all(batchPromises);
        
        // Collect results
        for (const result of batchResults) {
          allResults.push(result);
          if (result.success) {
            successCount++;
            totalKeywordsFound += result.keywordCount;
          } else {
            failCount++;
          }
        }

        logger.info(`✅ Batch ${batchNumber} completed: ${batchResults.filter(r => r.success).length}/${batch.length} successful`);

      } catch (batchError) {
        logger.error(`❌ Batch ${batchNumber} error: ${batchError.message}`);
        
        // If it's an auth error, stop processing and throw
        if (batchError.response && (batchError.response.status === 401 || batchError.response.status === 403)) {
          throw batchError;
        }
      }

      // Rate limiting: wait between batches (except for the last one)
      if (batchIndex < asinBatches.length - 1) {
        logger.info(`⏳ Waiting ${BATCH_DELAY_MS}ms before next batch...`);
        await delay(BATCH_DELAY_MS);
      }
    }

    // ===== SUMMARY =====
    const summary = {
      totalAsins: asins.length,
      successfulAsins: successCount,
      failedAsins: failCount,
      totalKeywordsFound: totalKeywordsFound,
      results: allResults
    };

    logger.info(`🏁 getKeywordRecommendations completed`, {
      userId,
      country,
      region,
      ...summary
    });

    logger.info("getKeywordRecommendations ended");

    return summary;

  } catch (error) {
    // ===== ENHANCED ERROR HANDLING FOR TOKEN MANAGER =====
    if (error.response) {
      logger.error('Keyword Recommendations API Error Response:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers,
        userId,
        region,
        country
      });

      const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      enhancedError.response = error.response;
      enhancedError.status = error.response.status;
      enhancedError.statusCode = error.response.status;
      
      if (error.response.status === 401 || error.response.status === 403) {
        enhancedError.amazonApiError = true;
      }
      
      throw enhancedError;
    } else if (error.request) {
      logger.error('No response received from Keyword Recommendations API:', {
        request: error.request,
        userId,
        region,
        country
      });
      throw new Error('No response received from Amazon Ads API');
    } else {
      logger.error('Keyword Recommendations API request setup error:', {
        message: error.message,
        userId,
        region,
        country
      });
      throw error;
    }
  }
}

/**
 * Get keyword recommendations for a specific ASIN from database
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @param {string} asin - ASIN to get recommendations for
 * @returns {Promise<Object|null>} - Stored keyword recommendations or null
 */
async function getStoredKeywordsForAsin(userId, country, region, asin) {
  try {
    return await AsinKeywordRecommendations.findByAsin(userId, country, region, asin);
  } catch (error) {
    logger.error('Error fetching stored keywords for ASIN:', {
      error: error.message,
      userId,
      country,
      region,
      asin
    });
    return null;
  }
}

/**
 * Get all keyword recommendations for a user from database
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Promise<Array>} - Array of stored keyword recommendations
 */
async function getAllStoredKeywordsForUser(userId, country, region) {
  try {
    return await AsinKeywordRecommendations.findAllForUser(userId, country, region);
  } catch (error) {
    logger.error('Error fetching all stored keywords for user:', {
      error: error.message,
      userId,
      country,
      region
    });
    return [];
  }
}

module.exports = {
  getKeywordRecommendations,
  getStoredKeywordsForAsin,
  getAllStoredKeywordsForUser
};

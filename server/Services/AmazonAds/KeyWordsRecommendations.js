const axios = require('axios');
const logger = require('../../utils/Logger.js');
const KeywordRecommendations = require('../../models/amazon-ads/KeywordRecommendationsModel.js');

// Base URIs for different regions (same as other Amazon Ads services)
const BASE_URIS = {
  'NA': 'https://advertising-api.amazon.com',
  'EU': 'https://advertising-api-eu.amazon.com',
  'FE': 'https://advertising-api-fe.amazon.com'
};

// Map country codes to locale strings
const COUNTRY_TO_LOCALE = {
  'US': 'en_US',
  'CA': 'en_CA',
  'MX': 'es_MX',
  'BR': 'pt_BR',
  'GB': 'en_GB',
  'UK': 'en_GB',
  'DE': 'de_DE',
  'FR': 'fr_FR',
  'IT': 'it_IT',
  'ES': 'es_ES',
  'NL': 'nl_NL',
  'SE': 'sv_SE',
  'PL': 'pl_PL',
  'JP': 'ja_JP',
  'AU': 'en_AU',
  'IN': 'en_IN',
  'SG': 'en_SG',
  'AE': 'ar_AE',
  'SA': 'ar_SA',
  'EG': 'ar_EG',
  'TR': 'tr_TR'
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
 * Make a single API request for keyword recommendations
 * @param {string} url - API endpoint URL
 * @param {Object} headers - Request headers
 * @param {Array<string>} asins - Array of ASINs for this request
 * @param {string} locale - Locale string
 * @returns {Promise<Object>} - API response data
 */
async function makeKeywordRecommendationRequest(url, headers, asins, locale) {
  const requestBody = {
    recommendationType: 'KEYWORDS_FOR_ASINS',
    biddingStrategy: 'AUTO_FOR_SALES',
    sortDimension: 'CLICKS',
    asins: asins,
    bidsEnabled: true,
    locale: locale,
    maxRecommendations: '200'
  };

  const response = await axios.post(url, requestBody, { headers });

  if (!response || !response.data) {
    throw new Error('Invalid response from Amazon Ads API - no data received');
  }

  return response.data;
}

/**
 * Get keyword recommendations for given ASINs
 * @param {string} accessToken - Access token for authentication
 * @param {string} profileId - Amazon Ads profile ID
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code (NA, EU, or FE)
 * @param {Array<string>} asins - Array of ASINs to get recommendations for
 * @returns {Promise<Object>} - API response with keyword recommendations
 */
async function getKeywordRecommendations(accessToken, profileId, userId, country, region, asins) {
  logger.info("getKeywordRecommendations starting");
  
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

    // ===== CHUNK ASINS IF MORE THAN 20 =====
    const MAX_ASINS_PER_REQUEST = 20;
    const RATE_LIMIT_DELAY_MS = 500; // 2 requests per second = 500ms delay

    let asinChunks;
    if (asins.length > MAX_ASINS_PER_REQUEST) {
      asinChunks = chunkArray(asins, MAX_ASINS_PER_REQUEST);
    } else {
      asinChunks = [asins];
    }

    // ===== MAKE REQUESTS SEQUENTIALLY WITH RATE LIMITING =====
    const allResponses = [];
    let combinedKeywordTargetList = [];

    for (let i = 0; i < asinChunks.length; i++) {
      const chunk = asinChunks[i];
      const chunkNumber = i + 1;
      
      try {
        const responseData = await makeKeywordRecommendationRequest(url, headers, chunk, locale);
        
        // Combine keywordTargetList from all responses
        if (responseData && responseData.keywordTargetList && Array.isArray(responseData.keywordTargetList)) {
          combinedKeywordTargetList = combinedKeywordTargetList.concat(responseData.keywordTargetList);
        }

        // Rate limiting: wait 500ms between requests (except for the last one)
        if (i < asinChunks.length - 1) {
          await delay(RATE_LIMIT_DELAY_MS);
        }

      } catch (chunkError) {
        logger.error(`❌ Error in request ${chunkNumber}/${asinChunks.length}:`, {
          error: chunkError.message,
          asinChunk: chunk,
          userId,
          region,
          country
        });
        
        // If it's an API error (401, 403), throw it to be handled by outer catch
        if (chunkError.response && (chunkError.response.status === 401 || chunkError.response.status === 403)) {
          throw chunkError;
        }
        
        // For other errors, continue with next chunk
      }
    }

    // ===== COMBINE ALL RESPONSES =====
    const combinedResponse = {
      keywordTargetList: combinedKeywordTargetList
    };

    // ===== SAVE TO DATABASE WITH VALIDATION =====
    let savedData;
    try {
      // Validate data structure before saving
      if (!Array.isArray(combinedKeywordTargetList)) {
        throw new Error(`keywordTargetList must be an array, got: ${typeof combinedKeywordTargetList}`);
      }

      savedData = await KeywordRecommendations.create({
        userId,
        country,
        region,
        keywordRecommendationData: combinedResponse
      });

      // Verify the document was actually created
      if (!savedData || !savedData._id) {
        logger.error('Failed to save keyword recommendations data to database - no document ID returned', { 
          userId, 
          region, 
          country,
          keywordCount: combinedKeywordTargetList.length,
          savedData: savedData ? 'exists but no _id' : 'null/undefined'
        });
        
        // Return a mock object with the data for consistency
        return {
          userId,
          country,
          region,
          keywordRecommendationData: combinedResponse,
          _isTemporary: true // Flag to indicate this wasn't saved to DB
        };
      }

      // Verify the document exists in the database
      const verifyDoc = await KeywordRecommendations.findById(savedData._id);
      if (!verifyDoc) {
        logger.error('Document was created but cannot be found in database', {
          documentId: savedData._id,
          userId,
          country,
          region
        });
      } else {
        // Also verify by querying with the same criteria used in the controller
        const queryDoc = await KeywordRecommendations.findOne({
          userId: userId,
          country: country,
          region: region
        }).sort({ createdAt: -1 });
        
        if (!queryDoc || queryDoc._id.toString() !== savedData._id.toString()) {
          logger.error('Document saved but not found with controller query criteria', {
            savedDocumentId: savedData._id,
            queryDocumentId: queryDoc?._id || 'not found',
            userId,
            country,
            region,
            savedUserId: savedData.userId,
            savedCountry: savedData.country,
            savedRegion: savedData.region
          });
        }
      }

      logger.info("Data saved successfully");
      logger.info("getKeywordRecommendations ended");
      return savedData;

    } catch (dbError) {
      // Enhanced error logging
      logger.error('Database error while saving keyword recommendations data', { 
        error: dbError.message, 
        errorName: dbError.name,
        errorStack: dbError.stack,
        validationErrors: dbError.errors ? Object.keys(dbError.errors).map(key => ({
          field: key,
          message: dbError.errors[key].message,
          value: dbError.errors[key].value
        })) : null,
        userId, 
        region, 
        country,
        keywordCount: combinedKeywordTargetList.length,
        sampleData: {
          userId,
          country,
          region,
          keywordCount: combinedKeywordTargetList.length,
          firstKeyword: combinedKeywordTargetList[0] || null
        }
      });
      
      // Return the data anyway, even if DB save failed
      return {
        userId,
        country,
        region,
        keywordRecommendationData: combinedResponse,
        _isTemporary: true,
        _dbError: dbError.message
      };
    }

  } catch (error) {
    // ===== ENHANCED ERROR HANDLING FOR TOKEN MANAGER =====
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      logger.error('Keyword Recommendations API Error Response:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers,
        userId,
        region,
        country
      });

      // Create enhanced error for TokenManager compatibility
      const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      enhancedError.response = error.response;
      enhancedError.status = error.response.status;
      enhancedError.statusCode = error.response.status;
      
      // Flag for TokenManager to detect Amazon API errors
      if (error.response.status === 401 || error.response.status === 403) {
        enhancedError.amazonApiError = true;
      }
      
      throw enhancedError;
    } else if (error.request) {
      // The request was made but no response was received
      logger.error('No response received from Keyword Recommendations API:', {
        request: error.request,
        userId,
        region,
        country
      });
      throw new Error('No response received from Amazon Ads API');
    } else {
      // Something happened in setting up the request that triggered an Error
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

module.exports = {
  getKeywordRecommendations
};


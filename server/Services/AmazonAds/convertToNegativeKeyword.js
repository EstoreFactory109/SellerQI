/**
 * Amazon Ads API - Convert Keywords to Negative Keywords
 *
 * This module provides functions to convert regular keywords to negative keywords
 * using the Amazon Ads API v3 for Sponsored Products.
 * Use convertToNegativeKeywordsForUser(userId, country, region, keywords, options)
 * to resolve ads credentials from the DB and use region-based base URL (same as other Ads services).
 */

const { Integration } = require('../main/Integration.js');
const { generateAdsAccessToken } = require('./GenerateToken.js');

// Region base URIs (same as GetWastedSpendKeywords and other Amazon Ads services)
const BASE_URIS = {
  NA: 'https://advertising-api.amazon.com',      // North America (US, CA, MX, BR)
  EU: 'https://advertising-api-eu.amazon.com',   // Europe (UK, DE, FR, IT, ES, NL, etc.)
  FE: 'https://advertising-api-fe.amazon.com'    // Far East (JP, AU, SG)
};

/**
 * Configuration for API requests
 */
class AmazonAdsConfig {
  constructor({ accessToken, clientId, profileId, region = 'NA' }) {
    this.accessToken = accessToken;
    this.clientId = clientId;
    this.profileId = profileId;
    const baseUrl = BASE_URIS[region];
    this.baseUrl = baseUrl || BASE_URIS.NA;
    if (!BASE_URIS[region]) {
      console.warn(`[convertToNegativeKeyword] Invalid region "${region}", defaulting to NA`);
    }
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Amazon-Advertising-API-ClientId': this.clientId,
      'Amazon-Advertising-API-Scope': this.profileId,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.spkeyword.v3+json'
    };
  }
}

/**
 * Delete (archive) keywords by their IDs
 * 
 * @param {AmazonAdsConfig} config - API configuration
 * @param {string[]} keywordIds - Array of keyword IDs to delete
 * @returns {Promise<Object>} - API response
 */
async function deleteKeywords(config, keywordIds) {
  const url = `${config.baseUrl}/sp/keywords/delete`;
  
  const payload = {
    keywordIdFilter: {
      include: keywordIds.map(id => String(id))
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: config.getHeaders(),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    if (response.status === 401) {
      const err = new Error('Amazon Ads API: Unauthorized (401)');
      err.statusCode = 401;
      throw err;
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(`Failed to delete keywords: ${JSON.stringify(error)}`);
  }

  return response.json();
}

/**
 * Create negative keywords at ad group level
 * 
 * @param {AmazonAdsConfig} config - API configuration
 * @param {Object[]} negativeKeywords - Array of negative keyword objects
 * @param {string} negativeKeywords[].campaignId - Campaign ID
 * @param {string} negativeKeywords[].adGroupId - Ad Group ID
 * @param {string} negativeKeywords[].keywordText - The keyword text
 * @param {string} negativeKeywords[].matchType - NEGATIVE_EXACT or NEGATIVE_PHRASE
 * @returns {Promise<Object>} - API response
 */
async function createNegativeKeywords(config, negativeKeywords) {
  const url = `${config.baseUrl}/sp/negativeKeywords`;

  const payload = {
    negativeKeywords: negativeKeywords.map(kw => ({
      campaignId: String(kw.campaignId),
      adGroupId: String(kw.adGroupId),
      keywordText: kw.keywordText,
      matchType: kw.matchType || 'NEGATIVE_EXACT',
      state: 'ENABLED'
    }))
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: config.getHeaders(),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    if (response.status === 401) {
      const err = new Error('Amazon Ads API: Unauthorized (401)');
      err.statusCode = 401;
      throw err;
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(`Failed to create negative keywords: ${JSON.stringify(error)}`);
  }

  return response.json();
}

/**
 * Create negative keywords at campaign level
 * 
 * @param {AmazonAdsConfig} config - API configuration
 * @param {Object[]} negativeKeywords - Array of negative keyword objects
 * @param {string} negativeKeywords[].campaignId - Campaign ID
 * @param {string} negativeKeywords[].keywordText - The keyword text
 * @param {string} negativeKeywords[].matchType - NEGATIVE_EXACT or NEGATIVE_PHRASE
 * @returns {Promise<Object>} - API response
 */
async function createCampaignNegativeKeywords(config, negativeKeywords) {
  const url = `${config.baseUrl}/sp/campaignNegativeKeywords`;

  const payload = {
    campaignNegativeKeywords: negativeKeywords.map(kw => ({
      campaignId: String(kw.campaignId),
      keywordText: kw.keywordText,
      matchType: kw.matchType || 'NEGATIVE_EXACT',
      state: 'ENABLED'
    }))
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: config.getHeaders(),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    if (response.status === 401) {
      const err = new Error('Amazon Ads API: Unauthorized (401)');
      err.statusCode = 401;
      throw err;
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(`Failed to create campaign negative keywords: ${JSON.stringify(error)}`);
  }

  return response.json();
}

/**
 * Convert keywords to negative keywords
 * 
 * This function performs two operations:
 * 1. Deletes (archives) the original positive keywords
 * 2. Creates new negative keywords with the same text
 * 
 * @param {AmazonAdsConfig} config - API configuration
 * @param {Object[]} keywords - Array of keyword objects to convert
 * @param {string} keywords[].keywordId - The keyword ID to archive
 * @param {string} keywords[].campaignId - Campaign ID
 * @param {string} keywords[].adGroupId - Ad Group ID
 * @param {string} keywords[].keywordText - The keyword text (required for creating negative)
 * @param {Object} options - Additional options
 * @param {string} options.matchType - NEGATIVE_EXACT or NEGATIVE_PHRASE (default: NEGATIVE_EXACT)
 * @param {string} options.level - 'adGroup' or 'campaign' (default: 'adGroup')
 * @returns {Promise<Object>} - Results of both operations
 */
async function convertToNegativeKeywords(config, keywords, options = {}) {
  const { matchType = 'NEGATIVE_EXACT', level = 'adGroup' } = options;

  // Validate input
  if (!keywords || keywords.length === 0) {
    throw new Error('No keywords provided for conversion');
  }

  for (const kw of keywords) {
    if (!kw.keywordId || !kw.campaignId || !kw.keywordText) {
      throw new Error('Each keyword must have keywordId, campaignId, and keywordText');
    }
    if (level === 'adGroup' && !kw.adGroupId) {
      throw new Error('adGroupId is required for ad group level negative keywords');
    }
  }

  const results = {
    deleted: null,
    created: null,
    errors: []
  };

  try {
    // Step 1: Delete (archive) the positive keywords
    const keywordIds = keywords.map(kw => kw.keywordId);
    results.deleted = await deleteKeywords(config, keywordIds);
    console.log(`Successfully deleted ${keywordIds.length} keyword(s)`);
  } catch (error) {
    results.errors.push({ step: 'delete', error: error.message });
    console.error('Error deleting keywords:', error.message);
    // Continue to create negative keywords even if delete fails
  }

  try {
    // Step 2: Create negative keywords
    const negativeKeywordData = keywords.map(kw => ({
      campaignId: kw.campaignId,
      adGroupId: kw.adGroupId,
      keywordText: kw.keywordText,
      matchType: matchType
    }));

    if (level === 'campaign') {
      results.created = await createCampaignNegativeKeywords(config, negativeKeywordData);
    } else {
      results.created = await createNegativeKeywords(config, negativeKeywordData);
    }
    console.log(`Successfully created ${keywords.length} negative keyword(s)`);
  } catch (error) {
    results.errors.push({ step: 'create', error: error.message });
    console.error('Error creating negative keywords:', error.message);
  }

  return results;
}

/**
 * Batch convert keywords to negative keywords with rate limiting
 * 
 * @param {AmazonAdsConfig} config - API configuration
 * @param {Object[]} keywords - Array of keyword objects to convert
 * @param {Object} options - Additional options
 * @param {number} options.batchSize - Number of keywords per batch (default: 100)
 * @param {number} options.delayMs - Delay between batches in ms (default: 1000)
 * @param {string} options.matchType - NEGATIVE_EXACT or NEGATIVE_PHRASE
 * @param {string} options.level - 'adGroup' or 'campaign'
 * @returns {Promise<Object[]>} - Array of results for each batch
 */
async function batchConvertToNegativeKeywords(config, keywords, options = {}) {
  const { 
    batchSize = 100, 
    delayMs = 1000,
    matchType = 'NEGATIVE_EXACT',
    level = 'adGroup'
  } = options;

  const results = [];
  const totalBatches = Math.ceil(keywords.length / batchSize);

  for (let i = 0; i < keywords.length; i += batchSize) {
    const batch = keywords.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    
    console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} keywords)`);
    
    try {
      const result = await convertToNegativeKeywords(config, batch, { matchType, level });
      results.push({ batch: batchNumber, success: true, result });
    } catch (error) {
      results.push({ batch: batchNumber, success: false, error: error.message });
    }

    // Add delay between batches to avoid rate limiting
    if (i + batchSize < keywords.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

/**
 * Convert keywords to negative keywords using userId, country, and region.
 * Resolves ads refresh token and profile from the seller account, generates access token,
 * and uses the region-based base URL (same pattern as GetWastedSpendKeywords and other Ads services).
 *
 * @param {string} userId - User ID (Mongo ObjectId)
 * @param {string} country - Country code (e.g. US, UK, DE)
 * @param {string} region - Region: NA, EU, or FE
 * @param {Object[]} keywords - Array of keyword objects (keywordId, campaignId, adGroupId, keywordText, etc.)
 * @param {Object} options - Same as convertToNegativeKeywords (matchType, level, batchSize, delayMs)
 * @returns {Promise<Object>} - Result of convertToNegativeKeywords or batchConvertToNegativeKeywords
 */
async function convertToNegativeKeywordsForUser(userId, country, region, keywords, options = {}) {
  if (!userId) throw new Error('userId is required');
  if (!country) throw new Error('country is required');
  if (!region) throw new Error('region is required');

  const baseUri = BASE_URIS[region];
  if (!baseUri) {
    throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
  }

  const sellerData = await Integration.getSellerDataAndTokens(userId, region, country);
  if (!sellerData.success) {
    throw new Error(sellerData.error || 'Failed to get seller data and tokens');
  }

  const { AdsRefreshToken, ProfileId } = sellerData;
  if (!AdsRefreshToken || !ProfileId) {
    throw new Error('Amazon Ads refresh token or ProfileId is missing for this account. Please connect Amazon Ads for this region and country.');
  }

  const clientId = process.env.AMAZON_ADS_CLIENT_ID;
  if (!clientId) {
    throw new Error('AMAZON_ADS_CLIENT_ID is not set in environment');
  }

  let accessToken = await generateAdsAccessToken(AdsRefreshToken);
  let config = new AmazonAdsConfig({
    accessToken,
    clientId,
    profileId: ProfileId,
    region
  });

  const runConversion = async () => {
    const { batchSize, ...restOptions } = options;
    if (batchSize && keywords.length > batchSize) {
      return batchConvertToNegativeKeywords(config, keywords, options);
    }
    return convertToNegativeKeywords(config, keywords, restOptions);
  };

  try {
    return await runConversion();
  } catch (err) {
    if (err.statusCode === 401 && AdsRefreshToken) {
      accessToken = await generateAdsAccessToken(AdsRefreshToken);
      config = new AmazonAdsConfig({
        accessToken,
        clientId,
        profileId: ProfileId,
        region
      });
      return await runConversion();
    }
    throw err;
  }
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

async function example() {
  // Initialize configuration
  const config = new AmazonAdsConfig({
    accessToken: 'your-access-token',
    clientId: 'your-client-id',
    profileId: 'your-profile-id',
    region: 'NA' // NA, EU, or FE
  });

  // Keywords to convert (you would get this from your report or database)
  const keywordsToConvert = [
    {
      keywordId: '111111111',
      campaignId: '123456789',
      adGroupId: '987654321',
      keywordText: 'bad performing keyword'
    },
    {
      keywordId: '222222222',
      campaignId: '123456789',
      adGroupId: '987654321',
      keywordText: 'another bad keyword'
    }
  ];

  try {
    // Option 1: Convert to ad group level negative keywords (NEGATIVE_EXACT)
    const result1 = await convertToNegativeKeywords(config, keywordsToConvert, {
      matchType: 'NEGATIVE_EXACT',
      level: 'adGroup'
    });
    console.log('Conversion result:', JSON.stringify(result1, null, 2));

    // Option 2: Convert to campaign level negative keywords (NEGATIVE_PHRASE)
    // const result2 = await convertToNegativeKeywords(config, keywordsToConvert, {
    //   matchType: 'NEGATIVE_PHRASE',
    //   level: 'campaign'
    // });

    // Option 3: Batch convert large number of keywords
    // const batchResults = await batchConvertToNegativeKeywords(config, largeKeywordList, {
    //   batchSize: 100,
    //   delayMs: 1000,
    //   matchType: 'NEGATIVE_EXACT',
    //   level: 'adGroup'
    // });

  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Export functions for use as module
module.exports = {
  BASE_URIS,
  AmazonAdsConfig,
  deleteKeywords,
  createNegativeKeywords,
  createCampaignNegativeKeywords,
  convertToNegativeKeywords,
  batchConvertToNegativeKeywords,
  convertToNegativeKeywordsForUser
};

// Uncomment to run example
// example();

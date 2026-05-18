const axios = require('axios');
const NegativeKeywords = require('../../models/amazon-ads/NegetiveKeywords.js');
const logger = require('../../utils/Logger.js');
const { getYesterdayMetricDateUtc } = require('../../utils/metricDateKey.js');

/**
 * Negative keyword entities → one snapshot doc per `metricDate` (upsert).
 *
 * MIGRATED: v2 GET /v2/negativeKeywords?campaignIdFilter=...&adGroupIdFilter=...
 *         → SP v3 POST /sp/negativeKeywords/list
 *
 * Key changes:
 * - POST with JSON body instead of GET with query params
 * - campaignIdFilter / adGroupIdFilter are now { "include": [...] } in body
 * - Pagination via nextToken / maxResults (max 100 per page)
 * - Response shape: { negativeKeywords: [...], nextToken: "..." }
 * - Requires Accept header: application/vnd.spNegativeKeyword.v3+json
 * - No more URL-length-based chunking needed (POST body has no URL length limit)
 *
 * NOTE: SP v3 also has campaign-level negatives at POST /sp/campaignNegativeKeywords/list
 * This file fetches ad-group-level negatives via /sp/negativeKeywords/list
 * Both are fetched and merged for the complete negative keyword picture.
 */

const BASE_URIS = {
  'NA': 'https://advertising-api.amazon.com',
  'EU': 'https://advertising-api-eu.amazon.com',
  'FE': 'https://advertising-api-fe.amazon.com'
};

// SP v3 content-type headers for negative keywords
const SP_V3_NEG_KW_ACCEPT = 'application/vnd.spNegativeKeyword.v3+json';
const SP_V3_NEG_KW_CONTENT_TYPE = 'application/vnd.spNegativeKeyword.v3+json';

// SP v3 content-type headers for campaign-level negative keywords
const SP_V3_CAMP_NEG_KW_ACCEPT = 'application/vnd.spCampaignNegativeKeyword.v3+json';
const SP_V3_CAMP_NEG_KW_CONTENT_TYPE = 'application/vnd.spCampaignNegativeKeyword.v3+json';


/**
 * Paginated fetch helper for SP v3 list endpoints.
 * Returns all items across all pages.
 */
async function fetchAllPages(url, requestBody, headers, responseKey) {
  let allItems = [];
  let nextToken = null;

  do {
    const body = { ...requestBody, maxResults: 100 };
    if (nextToken) {
      body.nextToken = nextToken;
    }

    const response = await axios.post(url, body, { headers });

    if (!response || !response.data) {
      throw new Error('Invalid response from Amazon Ads API - no data received');
    }

    const items = response.data[responseKey];

    if (!Array.isArray(items)) {
      break;
    }

    allItems.push(...items);
    nextToken = response.data.nextToken || null;

  } while (nextToken);

  return allItems;
}


async function getNegativeKeywords(accessToken, profileId, userId, country, region = 'NA', campaignIdArray, adGroupIdArray) {
  try {
    // Validate region
    if (!BASE_URIS[region]) {
      throw new Error(`Invalid region: ${region}. Must be NA, EU, or FE`);
    }

    // Get client ID from environment variables
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
      throw new Error('AMAZON_ADS_CLIENT_ID not found in environment variables');
    }

    // VALIDATE INPUT ARRAYS
    if (!Array.isArray(campaignIdArray)) {
      logger.warn('Campaign ID array is not an array, converting to empty array', { campaignIdArray, userId });
      campaignIdArray = [];
    }

    if (!Array.isArray(adGroupIdArray)) {
      logger.warn('Ad Group ID array is not an array, converting to empty array', { adGroupIdArray, userId });
      adGroupIdArray = [];
    }

    // Filter out invalid IDs and convert to strings
    const validCampaignIds = campaignIdArray
      .filter(id => id !== null && id !== undefined && id !== '')
      .map(id => String(id));
    const validAdGroupIds = adGroupIdArray
      .filter(id => id !== null && id !== undefined && id !== '')
      .map(id => String(id));

    console.log(`📊 Negative Keywords Input Validation:`, {
      originalCampaignIds: campaignIdArray.length,
      validCampaignIds: validCampaignIds.length,
      originalAdGroupIds: adGroupIdArray.length,
      validAdGroupIds: validAdGroupIds.length,
      userId
    });

    // Check if we have any valid IDs to work with
    if (validCampaignIds.length === 0 && validAdGroupIds.length === 0) {
      logger.warn('No valid campaign or ad group IDs provided, returning empty negative keywords result', { userId, region, country });

      const metricDate = getYesterdayMetricDateUtc();
      const negativeKeywords = await NegativeKeywords.findOneAndUpdate(
        {
          userId: String(userId),
          country: country,
          region: region,
          metricDate
        },
        {
          $set: {
            userId: String(userId),
            country: country,
            region: region,
            metricDate,
            negativeKeywordsData: []
          }
        },
        {
          new: true,
          upsert: true,
          runValidators: true
        }
      );

      return negativeKeywords;
    }

    const baseUrl = BASE_URIS[region];

    // ===== FETCH AD-GROUP-LEVEL NEGATIVE KEYWORDS =====
    // SP v3: POST /sp/negativeKeywords/list
    console.log(`📡 Fetching ad-group-level negative keywords (SP v3)`);

    const adGroupNegHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': clientId,
      'Amazon-Advertising-API-Scope': String(profileId),
      'Accept': SP_V3_NEG_KW_ACCEPT,
      'Content-Type': SP_V3_NEG_KW_CONTENT_TYPE
    };

    // Build filter body — include both campaignId and adGroupId filters if available
    const adGroupNegBody = {};

    if (validCampaignIds.length > 0) {
      adGroupNegBody.campaignIdFilter = { include: validCampaignIds };
    }
    if (validAdGroupIds.length > 0) {
      adGroupNegBody.adGroupIdFilter = { include: validAdGroupIds };
    }

    let adGroupNegativeKeywords = [];
    try {
      adGroupNegativeKeywords = await fetchAllPages(
        `${baseUrl}/sp/negativeKeywords/list`,
        adGroupNegBody,
        adGroupNegHeaders,
        'negativeKeywords'
      );
      console.log(`  ↳ Ad-group-level negative keywords: ${adGroupNegativeKeywords.length}`);
    } catch (err) {
      logger.warn('Failed to fetch ad-group-level negative keywords, continuing with campaign-level', {
        error: err.message,
        userId
      });
    }

    // ===== FETCH CAMPAIGN-LEVEL NEGATIVE KEYWORDS =====
    // SP v3: POST /sp/campaignNegativeKeywords/list
    console.log(`📡 Fetching campaign-level negative keywords (SP v3)`);

    const campNegHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': clientId,
      'Amazon-Advertising-API-Scope': String(profileId),
      'Accept': SP_V3_CAMP_NEG_KW_ACCEPT,
      'Content-Type': SP_V3_CAMP_NEG_KW_CONTENT_TYPE
    };

    const campNegBody = {};
    if (validCampaignIds.length > 0) {
      campNegBody.campaignIdFilter = { include: validCampaignIds };
    }

    let campaignNegativeKeywords = [];
    try {
      campaignNegativeKeywords = await fetchAllPages(
        `${baseUrl}/sp/campaignNegativeKeywords/list`,
        campNegBody,
        campNegHeaders,
        'campaignNegativeKeywords'
      );
      console.log(`  ↳ Campaign-level negative keywords: ${campaignNegativeKeywords.length}`);
    } catch (err) {
      logger.warn('Failed to fetch campaign-level negative keywords, continuing with ad-group-level only', {
        error: err.message,
        userId
      });
    }

    // ===== MERGE AND NORMALIZE =====
    // Normalize both types into a consistent shape matching the old v2 output
    const normalizedAdGroupNeg = adGroupNegativeKeywords.map(item => ({
      campaignId: item.campaignId || '',
      adGroupId: item.adGroupId || '',
      keywordId: item.keywordId || '',
      keywordText: item.keywordText || '',
      matchType: item.matchType || '',
      state: item.state || 'ENABLED',
      stateLower: (item.state || '').toLowerCase(),
      _level: 'adGroup',
      _v3Original: true
    }));

    const normalizedCampNeg = campaignNegativeKeywords.map(item => ({
      campaignId: item.campaignId || '',
      adGroupId: '',  // Campaign-level negatives don't have adGroupId
      keywordId: item.keywordId || '',
      keywordText: item.keywordText || '',
      matchType: item.matchType || '',
      state: item.state || 'ENABLED',
      stateLower: (item.state || '').toLowerCase(),
      _level: 'campaign',
      _v3Original: true
    }));

    const allNegativeKeywordsData = [...normalizedAdGroupNeg, ...normalizedCampNeg];

    // Remove duplicates based on keywordId (if any)
    const uniqueNegativeKeywordsData = allNegativeKeywordsData.filter((item, index, self) =>
      index === self.findIndex(t => t.keywordId === item.keywordId)
    );

    console.log(`✅ Negative keywords processing complete: ${uniqueNegativeKeywordsData.length} unique keywords found`);

    // Save all merged data to database (update if exists, create if not)
    const metricDate = getYesterdayMetricDateUtc();
    const negativeKeywords = await NegativeKeywords.findOneAndUpdate(
      {
        userId: String(userId),
        country: country,
        region: region,
        metricDate
      },
      {
        $set: {
          userId: String(userId),
          country,
          region,
          metricDate,
          negativeKeywordsData: uniqueNegativeKeywordsData
        }
      },
      {
        new: true,
        upsert: true
      }
    );

    if (!negativeKeywords) {
      return false;
    }
    return negativeKeywords;

  } catch (error) {
    if (error.response) {
      console.error('❌ Negative Keywords API Error Response:', {
        status: error.response.status,
        data: error.response.data,
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
    }

    console.error('Error in getNegativeKeywords:', error.message);
    throw error;
  }
}

module.exports = {
  getNegativeKeywords
};
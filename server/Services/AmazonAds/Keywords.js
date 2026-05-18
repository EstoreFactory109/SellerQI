const axios = require('axios');
const KeywordModel = require('../../models/amazon-ads/keywordModel.js');
const logger = require('../../utils/Logger.js');
const { getYesterdayMetricDateUtc } = require('../../utils/metricDateKey.js');

/**
 * SP keywords → one snapshot doc per `metricDate` (upsert).
 * Feeds auto-campaign insights (manual keyword set).
 *
 * MIGRATED: v2 GET /v2/keywords?stateFilter=enabled → SP v3 POST /sp/keywords/list
 * - POST with JSON body instead of GET with query params
 * - stateFilter is now { "include": ["ENABLED"] } in body
 * - Pagination via nextToken / maxResults (max 100 per page)
 * - Response shape: { keywords: [...], nextToken: "..." }
 * - Requires Accept header: application/vnd.spKeyword.v3+json
 */

const BASE_URIS = {
  'NA': 'https://advertising-api.amazon.com',
  'EU': 'https://advertising-api-eu.amazon.com',
  'FE': 'https://advertising-api-fe.amazon.com'
};

// SP v3 content-type headers for keywords
const SP_V3_ACCEPT = 'application/vnd.spKeyword.v3+json';
const SP_V3_CONTENT_TYPE = 'application/vnd.spKeyword.v3+json';


async function getKeywords(accessToken, profileId, userId, country, region = 'NA') {
  try {
    // ===== INPUT VALIDATION =====
    if (!accessToken) {
      throw new Error('Access token is required');
    }

    if (!profileId) {
      throw new Error('Profile ID is required');
    }

    if (!userId) {
      throw new Error('User ID is required');
    }

    if (!country) {
      throw new Error('Country is required');
    }

    // Validate region
    if (!BASE_URIS[region]) {
      throw new Error(`Invalid region: ${region}. Must be NA, EU, or FE`);
    }

    // Get client ID from environment variables
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
      throw new Error('AMAZON_ADS_CLIENT_ID not found in environment variables');
    }

    console.log(`📡 Getting keywords (SP v3) for region: ${region}, country: ${country}, userId: ${userId}`);

    // SP v3 endpoint
    const baseUrl = BASE_URIS[region];
    const url = `${baseUrl}/sp/keywords/list`;

    // Set up headers
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': clientId,
      'Amazon-Advertising-API-Scope': String(profileId),
      'Accept': SP_V3_ACCEPT,
      'Content-Type': SP_V3_CONTENT_TYPE
    };

    // ===== PAGINATED FETCH =====
    let allKeywords = [];
    let nextToken = null;

    do {
      const requestBody = {
        stateFilter: {
          include: ['ENABLED']
        },
        maxResults: 100
      };

      if (nextToken) {
        requestBody.nextToken = nextToken;
      }

      const response = await axios.post(url, requestBody, { headers });

      // ===== VALIDATE API RESPONSE =====
      if (!response || !response.data) {
        throw new Error('Invalid response from Amazon Ads API - no data received');
      }

      // SP v3 response shape: { keywords: [...], nextToken: "..." }
      const keywords = response.data.keywords;

      if (!Array.isArray(keywords)) {
        logger.warn('Keywords API response keywords field is not an array', {
          responseType: typeof keywords,
          userId,
          region,
          country
        });
        break;
      }

      allKeywords.push(...keywords);
      nextToken = response.data.nextToken || null;

      console.log(`  ↳ Fetched ${keywords.length} keywords (total so far: ${allKeywords.length})`);

    } while (nextToken);

    console.log(`✅ Keywords API response received: ${allKeywords.length} keywords total`);

    // ===== HANDLE EMPTY KEYWORDS GRACEFULLY =====
    if (allKeywords.length === 0) {
      logger.warn('No keywords found for user', { userId, region, country });

      const metricDate = getYesterdayMetricDateUtc();
      const createdKeywords = await KeywordModel.findOneAndUpdate(
        { userId: String(userId), country, region, metricDate },
        {
          $set: {
            userId: String(userId),
            country,
            region,
            metricDate,
            keywordData: []
          }
        },
        { new: true, upsert: true, runValidators: true }
      );

      console.log(`✅ Empty keywords data saved for consistency`);
      return createdKeywords;
    } else {
      // Log some stats
      const enabledKeywords = allKeywords.filter(keyword =>
        keyword && keyword.state === 'ENABLED'
      );
      console.log(`📊 Keywords breakdown: ${allKeywords.length} total, ${enabledKeywords.length} enabled`);
    }

    // ===== NORMALIZE v3 RESPONSE FOR BACKWARD COMPATIBILITY =====
    // v3 uses UPPERCASE: state=ENABLED, matchType=BROAD/EXACT/PHRASE
    // v2 used lowercase: state=enabled, matchType=broad/exact/phrase
    const normalizedKeywords = allKeywords.map(kw => ({
      ...kw,
      _v3Original: true,
      stateLower: (kw.state || '').toLowerCase(),
      matchTypeLower: (kw.matchType || '').toLowerCase()
    }));

    // ===== SAVE TO DATABASE WITH VALIDATION =====
    let createdKeywords;
    try {
      const metricDate = getYesterdayMetricDateUtc();
      createdKeywords = await KeywordModel.findOneAndUpdate(
        { userId: String(userId), country, region, metricDate },
        {
          $set: {
            userId: String(userId),
            country,
            region,
            metricDate,
            keywordData: normalizedKeywords
          }
        },
        { new: true, upsert: true, runValidators: true }
      );

      if (!createdKeywords) {
        logger.warn('Failed to save keywords data to database, but continuing with API data', {
          userId,
          region,
          country,
          keywordCount: normalizedKeywords.length
        });

        return {
          userId,
          country,
          region,
          keywordData: normalizedKeywords,
          _isTemporary: true
        };
      }

      console.log(`✅ Keywords data saved successfully: ${normalizedKeywords.length} keywords stored`);
      return createdKeywords;

    } catch (dbError) {
      logger.error('Database error while saving keywords data', {
        error: dbError.message,
        userId,
        region,
        country,
        keywordCount: normalizedKeywords.length
      });

      return {
        userId,
        country,
        region,
        keywordData: normalizedKeywords,
        _isTemporary: true,
        _dbError: dbError.message
      };
    }

  } catch (error) {
    // ===== ENHANCED ERROR HANDLING FOR TOKEN MANAGER =====
    if (error.response) {
      console.error('❌ Keywords API Error Response:', {
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
      console.error('❌ No response received from Keywords API:', {
        request: error.request,
        userId,
        region,
        country
      });
      throw new Error('No response received from Amazon Ads API');
    } else {
      console.error('❌ Keywords API request setup error:', {
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
  getKeywords
};
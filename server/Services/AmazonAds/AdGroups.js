const axios = require('axios');
const AdsGroup = require('../../models/amazon-ads/adsgroupModel.js');
const logger = require('../../utils/Logger.js');
const { getYesterdayMetricDateUtc } = require('../../utils/metricDateKey.js');

/**
 * Ad groups list → one snapshot doc per `metricDate` (upsert).
 *
 * MIGRATED: v2 GET /v2/adGroups?campaignIdFilter=... → SP v3 POST /sp/adGroups/list
 * - POST with JSON body instead of GET with query params
 * - campaignIdFilter is now { "include": ["id1", "id2"] } in body
 * - Pagination via nextToken / maxResults (max 100 per page)
 * - Response shape: { adGroups: [...], nextToken: "..." }
 * - Requires Accept header: application/vnd.spAdGroup.v3+json
 */

// Base URIs for different regions
const BASE_URIS = {
  'NA': 'https://advertising-api.amazon.com',
  'EU': 'https://advertising-api-eu.amazon.com',
  'FE': 'https://advertising-api-fe.amazon.com'
};

// SP v3 content-type headers for ad groups
const SP_V3_ACCEPT = 'application/vnd.spAdGroup.v3+json';
const SP_V3_CONTENT_TYPE = 'application/vnd.spAdGroup.v3+json';


async function getAdGroups(accessToken, profileId, region, userId, country, campaignIds) {
  try {
    // Validate region and get base URI
    const baseUri = BASE_URIS[region];
    if (!baseUri) {
      throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
    }

    // VALIDATE CAMPAIGN IDS ARRAY
    if (!Array.isArray(campaignIds)) {
      logger.warn('Campaign IDs is not an array, converting to empty array', { campaignIds, userId });
      campaignIds = [];
    }

    if (campaignIds.length === 0) {
      logger.warn('No campaign IDs provided to getAdGroups, returning empty result', { userId, region, country });

      const metricDate = getYesterdayMetricDateUtc();
      const createEmptyAdGroupData = await AdsGroup.findOneAndUpdate(
        { userId: String(userId), country, region, metricDate },
        {
          $set: {
            userId: String(userId),
            country,
            region,
            metricDate,
            adsGroupData: []
          }
        },
        { upsert: true, new: true, runValidators: true }
      );

      return createEmptyAdGroupData;
    }

    // Filter out any invalid campaign IDs (null, undefined, empty strings)
    const validCampaignIds = campaignIds.filter(id => id !== null && id !== undefined && id !== '');

    if (validCampaignIds.length === 0) {
      logger.warn('No valid campaign IDs after filtering, returning empty result', {
        originalCount: campaignIds.length,
        validCount: validCampaignIds.length,
        userId
      });

      const metricDate = getYesterdayMetricDateUtc();
      const createEmptyAdGroupData = await AdsGroup.findOneAndUpdate(
        { userId: String(userId), country, region, metricDate },
        {
          $set: {
            userId: String(userId),
            country,
            region,
            metricDate,
            adsGroupData: []
          }
        },
        { upsert: true, new: true, runValidators: true }
      );

      return createEmptyAdGroupData;
    }

    // Validate environment variable
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
      throw new Error('AMAZON_ADS_CLIENT_ID not found in environment variables');
    }

    // SP v3 endpoint
    const url = `${baseUri}/sp/adGroups/list`;

    // Set up headers
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': clientId,
      'Amazon-Advertising-API-Scope': String(profileId),
      'Accept': SP_V3_ACCEPT,
      'Content-Type': SP_V3_CONTENT_TYPE
    };

    console.log(`📡 Getting Ad Groups (SP v3) with ${validCampaignIds.length} campaign IDs`);

    // ===== PAGINATED FETCH =====
    // SP v3 supports campaignIdFilter in body; we can pass all IDs at once
    // (v2 had URL length limits forcing chunking — v3 body has no such limit)
    let allAdGroups = [];
    let nextToken = null;

    // Convert campaign IDs to strings (v3 expects string array)
    const campaignIdStrings = validCampaignIds.map(id => String(id));

    do {
      const requestBody = {
        campaignIdFilter: {
          include: campaignIdStrings
        },
        stateFilter: {
          include: ['ENABLED', 'PAUSED']
        },
        maxResults: 100
      };

      if (nextToken) {
        requestBody.nextToken = nextToken;
      }

      const response = await axios.post(url, requestBody, { headers });

      if (!response || !response.data) {
        throw new Error('Invalid response from Amazon Ads API - no data received');
      }

      // SP v3 response shape: { adGroups: [...], nextToken: "..." }
      const adGroups = response.data.adGroups;

      if (!Array.isArray(adGroups)) {
        logger.warn('Ad Groups API response adGroups field is not an array', {
          responseType: typeof adGroups,
          userId
        });
        break;
      }

      allAdGroups.push(...adGroups);
      nextToken = response.data.nextToken || null;

      console.log(`  ↳ Fetched ${adGroups.length} ad groups (total so far: ${allAdGroups.length})`);

    } while (nextToken);

    console.log(`✅ Ad Groups data fetched: ${allAdGroups.length} ad groups total`);

    // ===== NORMALIZE v3 RESPONSE FOR BACKWARD COMPATIBILITY =====
    const normalizedAdGroups = allAdGroups.map(ag => ({
      ...ag,
      _v3Original: true,
      stateLower: (ag.state || '').toLowerCase()
    }));

    // ===== SAVE TO DATABASE =====
    const metricDate = getYesterdayMetricDateUtc();
    const createCampaignData = await AdsGroup.findOneAndUpdate(
      { userId: String(userId), country, region, metricDate },
      {
        $set: {
          userId: String(userId),
          country,
          region,
          metricDate,
          adsGroupData: normalizedAdGroups
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    if (!createCampaignData) {
      logger.error('Failed to save ad group data to database', { userId, region, country });
      return {
        userId,
        country,
        region,
        adsGroupData: normalizedAdGroups,
        _isTemporary: true
      };
    }

    console.log(`✅ Ad Groups data saved: ${normalizedAdGroups.length} ad groups`);

    return createCampaignData;

  } catch (error) {
    // Handle different types of errors
    if (error.response) {
      console.error('❌ Ad Groups API Error Response:', {
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
      console.error('❌ No response received from Ad Groups API:', error.request);
      throw new Error('No response received from Amazon Ads API');
    } else {
      console.error('❌ Ad Groups API request setup error:', error.message);
      throw error;
    }
  }
}

module.exports = {
  getAdGroups
};
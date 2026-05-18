const axios = require('axios');
const Campaign = require('../../models/amazon-ads/CampaignModel');
const logger = require('../../utils/Logger.js');
const { getYesterdayMetricDateUtc } = require('../../utils/metricDateKey.js');

/**
 * Sponsored Products campaigns list → one snapshot doc per `metricDate` (upsert).
 * Used for audit tabs that join campaigns / negatives / ad groups.
 *
 * MIGRATED: v2 GET /v2/campaigns → SP v3 POST /sp/campaigns/list
 * - POST with JSON body instead of GET with query params
 * - stateFilter is now { "include": ["ENABLED"] } in body
 * - Pagination via nextToken / maxResults (max 100 per page)
 * - Response shape: { campaigns: [...], nextToken: "..." }
 * - Requires Accept header: application/vnd.spCampaign.v3+json
 */

// Base URIs for different regions
const BASE_URIS = {
  'NA': 'https://advertising-api.amazon.com',
  'EU': 'https://advertising-api-eu.amazon.com',
  'FE': 'https://advertising-api-fe.amazon.com'
};

// SP v3 content-type headers
const SP_V3_ACCEPT = 'application/vnd.spCampaign.v3+json';
const SP_V3_CONTENT_TYPE = 'application/vnd.spCampaign.v3+json';


async function getCampaign(accessToken, profileId, region, userId, country) {
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

    if (!region) {
      throw new Error('Region is required');
    }

    if (!country) {
      throw new Error('Country is required');
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

    console.log(`📡 Getting campaigns (SP v3) for region: ${region}, country: ${country}, userId: ${userId}`);

    // SP v3 endpoint
    const url = `${baseUri}/sp/campaigns/list`;

    // Set up headers (v3 requires versioned Accept/Content-Type)
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': clientId,
      'Amazon-Advertising-API-Scope': String(profileId),
      'Accept': SP_V3_ACCEPT,
      'Content-Type': SP_V3_CONTENT_TYPE
    };

    // ===== PAGINATED FETCH =====
    let allCampaigns = [];
    let nextToken = null;

    do {
      // Build request body with stateFilter and pagination
      const requestBody = {
        stateFilter: {
          include: ['ENABLED']
        },
        maxResults: 100  // max allowed per page
      };

      if (nextToken) {
        requestBody.nextToken = nextToken;
      }

      const response = await axios.post(url, requestBody, { headers });

      // ===== VALIDATE API RESPONSE =====
      if (!response || !response.data) {
        throw new Error('Invalid response from Amazon Ads API - no data received');
      }

      // SP v3 response shape: { campaigns: [...], nextToken: "..." }
      const campaigns = response.data.campaigns;

      if (!Array.isArray(campaigns)) {
        logger.warn('Campaign API response campaigns field is not an array', {
          responseType: typeof campaigns,
          userId,
          region,
          country
        });
        break;
      }

      allCampaigns.push(...campaigns);
      nextToken = response.data.nextToken || null;

      console.log(`  ↳ Fetched ${campaigns.length} campaigns (total so far: ${allCampaigns.length})`);

    } while (nextToken);

    console.log(`✅ Campaign API response received: ${allCampaigns.length} campaigns total`);

    // ===== HANDLE EMPTY CAMPAIGNS GRACEFULLY =====
    if (allCampaigns.length === 0) {
      logger.warn('No campaigns found for user', { userId, region, country });
    } else {
      // Log some stats about the campaigns
      const enabledCampaigns = allCampaigns.filter(campaign =>
        campaign && campaign.state === 'ENABLED'
      );
      console.log(`📊 Campaign breakdown: ${allCampaigns.length} total, ${enabledCampaigns.length} enabled`);
    }

    // ===== NORMALIZE v3 RESPONSE TO MATCH EXISTING MODEL =====
    // v3 uses different field names; project them onto the v2-shaped schema so
    // downstream readers (audit calculations, frontend tables, schema validation)
    // keep working with a single shape.
    //
    // v3 fields: campaignId, name, state (ENABLED/PAUSED/ARCHIVED),
    //   targetingType (AUTO/MANUAL), dynamicBidding, budget { budget, budgetType, … },
    //   startDate, endDate
    // v2 fields (what the schema still uses): campaignId, name, state,
    //   targetingType, premiumBidAdjustment, dailyBudget, startDate
    const normalizedCampaigns = allCampaigns.map(c => {
      // Best-effort projection of v3 → v2 field names. Anything we can't map
      // is left undefined; the schema no longer requires those fields.
      const dailyBudgetRaw = c?.budget?.budget;
      const dailyBudget = (typeof dailyBudgetRaw === 'number' && Number.isFinite(dailyBudgetRaw))
        ? dailyBudgetRaw
        : (dailyBudgetRaw != null && !Number.isNaN(Number(dailyBudgetRaw)) ? Number(dailyBudgetRaw) : undefined);

      // v3 doesn't expose a single premiumBidAdjustment scalar; preserve the
      // strategy label if available so downstream code has *something* to read.
      const premiumBidAdjustment = c?.dynamicBidding?.strategy != null
        ? String(c.dynamicBidding.strategy)
        : undefined;

      return {
        ...c,
        // This endpoint is `/sp/campaigns/list`, so the type is always SP.
        campaignType: c.campaignType || 'sponsoredProducts',
        dailyBudget,
        premiumBidAdjustment,
        _v3Original: true,
        stateLower: (c.state || '').toLowerCase(),
        targetingTypeLower: (c.targetingType || '').toLowerCase(),
      };
    });

    // ===== SAVE TO DATABASE WITH VALIDATION =====
    let createCampaignData;
    try {
      const metricDate = getYesterdayMetricDateUtc();
      createCampaignData = await Campaign.findOneAndUpdate(
        { userId: String(userId), country, region, metricDate },
        {
          $set: {
            userId: String(userId),
            country,
            region,
            metricDate,
            campaignData: normalizedCampaigns
          }
        },
        { upsert: true, new: true, runValidators: true }
      );

      if (!createCampaignData) {
        // Log warning but don't fail - return the data anyway
        logger.warn('Failed to save campaign data to database, but continuing with API data', {
          userId,
          region,
          country,
          campaignCount: normalizedCampaigns.length
        });

        // Return a mock object with the data for consistency
        return {
          userId,
          country,
          region,
          campaignData: normalizedCampaigns,
          _isTemporary: true
        };
      }

      console.log(`✅ Campaign data saved successfully: ${normalizedCampaigns.length} campaigns stored`);
      return createCampaignData;

    } catch (dbError) {
      logger.error('Database error while saving campaign data', {
        error: dbError.message,
        userId,
        region,
        country,
        campaignCount: normalizedCampaigns.length
      });

      // Return the data anyway, even if DB save failed
      return {
        userId,
        country,
        region,
        campaignData: normalizedCampaigns,
        _isTemporary: true,
        _dbError: dbError.message
      };
    }

  } catch (error) {
    // ===== ENHANCED ERROR HANDLING FOR TOKEN MANAGER =====
    if (error.response) {
      console.error('❌ Campaign API Error Response:', {
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
      console.error('❌ No response received from Campaign API:', {
        request: error.request,
        userId,
        region,
        country
      });
      throw new Error('No response received from Amazon Ads API');
    } else {
      console.error('❌ Campaign API request setup error:', {
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
  getCampaign
};
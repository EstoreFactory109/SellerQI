const axios = require('axios');
const AdsGroup = require('../../models/amazon-ads/adsgroupModel.js');
const AdsGroupChunk = require('../../models/amazon-ads/adsGroupChunkModel.js');
const logger = require('../../utils/Logger.js');
const { getYesterdayMetricDateUtc } = require('../../utils/metricDateKey.js');
const { chunkIds, ADS_ID_FILTER_MAX, ADS_CHUNK_DELAY_MS: CHUNK_DELAY_MS, sleep } = require('../../utils/adsIdFilter.js');
const { persistChunkedSnapshot } = require('../../utils/snapshotChunkStore.js');

/**
 * Ad groups list → one snapshot doc per `metricDate` (upsert).
 *
 * MIGRATED: v2 GET /v2/adGroups?campaignIdFilter=... → SP v3 POST /sp/adGroups/list
 * - POST with JSON body instead of GET with query params
 * - campaignIdFilter is now { "include": ["id1", "id2"] } in body, CHUNKED to <= 100 members
 *   (v3 dropped v2's URL-length limit but still caps include[] size — see utils/adsIdFilter.js)
 * - Pagination via nextToken / maxResults (max 100 per page), scoped to each filter chunk
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

    // ===== CHUNKED + PAGINATED FETCH =====
    // The POST body removed v2's URL-length limit, but SP v3 still caps the number of members in
    // `campaignIdFilter.include` — sending every campaign ID at once fails the entire request with
    // 400 INVALID_ARGUMENT for any account with more than ~100 campaigns. So chunk the filter and
    // paginate WITHIN each chunk (nextToken is scoped to the request that produced it, hence the
    // per-chunk reset below).
    // Streamed: normalize each page immediately and drop the raw page, so we never hold the
    // full raw ad-group set AND a second normalized array at the same time.
    const normalizedAdGroups = [];

    // Convert campaign IDs to strings (v3 expects string array)
    const campaignIdStrings = validCampaignIds.map(id => String(id));
    const campaignIdChunks = chunkIds(campaignIdStrings);

    console.log(`📦 Split ${campaignIdStrings.length} campaign IDs into ${campaignIdChunks.length} chunk(s) of <= ${ADS_ID_FILTER_MAX}`);

    // Tracks chunks whose pagination was cut short by a malformed response. Pre-chunking, that
    // `break` ended the ONE request loop and we saved what we had; now it would end just one chunk
    // of many and still save, silently publishing a partial ad-group set that starves
    // `adGroupIdArray` downstream. So we record it and refuse to write below.
    const incompleteChunks = [];

    for (let chunkIndex = 0; chunkIndex < campaignIdChunks.length; chunkIndex++) {
      const campaignIdChunk = campaignIdChunks[chunkIndex];
      let nextToken = null;

      // Pace the chunks — 52 back-to-back POSTs is itself a plausible 429 trigger.
      if (chunkIndex > 0) await sleep(CHUNK_DELAY_MS);

      do {
        const requestBody = {
          campaignIdFilter: {
            include: campaignIdChunk
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

        // An ABSENT key is Amazon's normal "this chunk of campaigns has no ad groups" shape, which
        // is legitimate — end this chunk's pagination without flagging it. An explicit `null`, or
        // any other non-array value, is malformed and must block the write below.
        if (adGroups === undefined) {
          break;
        }

        if (!Array.isArray(adGroups)) {
          logger.warn('Ad Groups API response adGroups field is not an array', {
            responseType: typeof adGroups,
            chunkIndex,
            userId
          });
          incompleteChunks.push(chunkIndex);
          break;
        }

        // Normalize this page for backward compatibility and drop the raw page.
        for (let i = 0; i < adGroups.length; i++) {
          const ag = adGroups[i];
          normalizedAdGroups.push({ ...ag, _v3Original: true, stateLower: (ag.state || '').toLowerCase() });
        }
        nextToken = response.data.nextToken || null;

        console.log(`  ↳ [chunk ${chunkIndex + 1}/${campaignIdChunks.length}] Fetched ${adGroups.length} ad groups (total so far: ${normalizedAdGroups.length})`);

      } while (nextToken);
    }

    // Refuse to publish an incomplete set. The upsert below is a `$set` that REPLACES the stored
    // snapshot, so writing a partial result would destroy a good one — and a silently short
    // ad-group list is worse than a stale complete one, because `adGroupIdArray` is derived from
    // it. Throwing leaves yesterday's snapshot intact and lets the caller record the failure.
    if (incompleteChunks.length > 0) {
      throw new Error(
        `Ad Groups fetch incomplete: ${incompleteChunks.length}/${campaignIdChunks.length} chunk(s) ` +
        `returned a malformed response (chunk indexes: ${incompleteChunks.join(', ')}). ` +
        `Refusing to overwrite the existing snapshot with partial data.`
      );
    }

    console.log(`✅ Ad Groups data fetched: ${normalizedAdGroups.length} ad groups total`);

    // ===== SAVE TO DATABASE =====
    // Chunks only if the set outgrows one 16MB document; below the threshold this is the
    // same inline `$set` as before. Preventive — ad groups peak at ~0.5MB today — but the
    // shape matches the snapshots that already overflowed. See utils/snapshotChunkStore.js.
    const metricDate = getYesterdayMetricDateUtc();
    const createCampaignData = await persistChunkedSnapshot({
      Model: AdsGroup,
      ChunkModel: AdsGroupChunk,
      dataField: 'adsGroupData',
      userId,
      country,
      region,
      metricDate,
      rows: normalizedAdGroups,
      label: 'adsGroupData',
    });

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
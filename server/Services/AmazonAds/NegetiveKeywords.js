const axios = require('axios');
const NegativeKeywords = require('../../models/amazon-ads/NegetiveKeywords.js');
const NegativeKeywordChunk = require('../../models/amazon-ads/negativeKeywordChunkModel.js');
const logger = require('../../utils/Logger.js');
const { getYesterdayMetricDateUtc } = require('../../utils/metricDateKey.js');
const { chunkIds, ADS_ID_FILTER_MAX, ADS_CHUNK_DELAY_MS: CHUNK_DELAY_MS, sleep } = require('../../utils/adsIdFilter.js');
const { persistChunkedSnapshot } = require('../../utils/snapshotChunkStore.js');

/**
 * Project a collected row down to the five fields the schema actually stores.
 *
 * The collectors below attach `matchType`, `stateLower`, `_level` and `_v3Original` for
 * their own filtering/merging. Mongoose strict mode already discards all four, so dropping
 * them here changes nothing that reaches Mongo — but it removes ~25-35% of the bytes we ask
 * the driver to serialize, which matters directly when the whole point is that this document
 * got too big. Applied at PERSIST time, not at collection time, so the collectors (and the
 * tests that assert on `_level`) are untouched.
 */
function toStoredNegativeRow(item) {
    return {
        campaignId: item.campaignId || '',
        adGroupId: item.adGroupId || '',
        keywordId: item.keywordId || '',
        keywordText: item.keywordText || '',
        state: item.state || 'ENABLED',
    };
}

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
 * - ID filters are CHUNKED to <= 100 members. The POST body removed v2's URL-length limit, but
 *   v3 still caps include[] size, and exceeding it 400s the whole request. Because the errors
 *   below are caught and logged as warnings, that previously degraded silently to
 *   "0 negative keywords" for any account with more than ~100 campaigns. See utils/adsIdFilter.js.
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
// With `onPage`, each page's items are handed to the callback and then DROPPED — nothing
// accumulates, so memory is a function of one page rather than the whole result set.
// Without `onPage`, behaviour is unchanged (returns the full array).
async function fetchAllPages(url, requestBody, headers, responseKey, { onPage = null } = {}) {
  const allItems = [];
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

    // An ABSENT key is Amazon's normal "no results" shape — end pagination quietly.
    // An explicit `null` is NOT that: a list field should never be null, so it falls through to
    // the malformed check below rather than being mistaken for an empty result.
    if (items === undefined) {
      break;
    }

    // A present-but-not-an-array value is malformed. Previously this `break` returned normally,
    // so the caller published however many pages had arrived AS A SUCCESS — and the caller `$set`s
    // that over the stored snapshot, silently replacing a complete set with a truncated one.
    // Chunking multiplies the exposure (52+ chunks per large account), so fail loudly instead and
    // let the per-level catch zero this level, leaving yesterday's complete snapshot intact.
    if (!Array.isArray(items)) {
      throw new Error(
        `Malformed Amazon Ads response: expected '${responseKey}' to be an array, got ${typeof items}. ` +
        `Refusing to treat a truncated page as a complete result.`
      );
    }

    if (onPage) {
      await onPage(items);          // stream: caller consumes the page, raw dropped
    } else {
      allItems.push(...items);      // legacy: accumulate + return
    }
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

      // Routed through the same helper as the main write so this path also CLEARS any
      // overflow chunks from a previous, larger sync. Writing an empty header while stale
      // chunks survived would leave orphaned documents behind forever.
      const metricDate = getYesterdayMetricDateUtc();
      const negativeKeywords = await persistChunkedSnapshot({
        Model: NegativeKeywords,
        ChunkModel: NegativeKeywordChunk,
        dataField: 'negativeKeywordsData',
        userId,
        country,
        region,
        metricDate,
        rows: [],
        label: 'negativeKeywords(empty)',
      });

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

    // Both campaignIdFilter and adGroupIdFilter are capped at 100 members each, so chunking one
    // while sending the other whole would still 400. Since the two filters intersect and
    // adGroupId is the strictly narrower key, we chunk ONE filter and apply the other as an
    // equivalent client-side Set test — same result set, no combinatorial nested chunk loop.
    // Prefer chunking campaign IDs (the coarser filter, so fewer requests); fall back to
    // chunking ad group IDs when no campaign IDs were supplied.
    const adGroupIdSet = validAdGroupIds.length > 0 ? new Set(validAdGroupIds) : null;
    const chunkByCampaign = validCampaignIds.length > 0;
    const adGroupNegChunks = chunkByCampaign
      ? chunkIds(validCampaignIds).map(chunk => ({ campaignIdFilter: { include: chunk } }))
      : chunkIds(validAdGroupIds).map(chunk => ({ adGroupIdFilter: { include: chunk } }));

    console.log(`📦 Ad-group-level negatives: ${adGroupNegChunks.length} chunk(s) of <= ${ADS_ID_FILTER_MAX} ${chunkByCampaign ? 'campaign' : 'ad group'} IDs`);

    // Streamed: normalize each page into the accumulator; raw pages are dropped.
    // The accumulator spans all chunks, so the merge/dedupe below is unaffected by chunking.
    // The try/catch deliberately wraps the WHOLE chunk loop, not each chunk. Chunking splits one
    // logical fetch into many requests, so catching per chunk would let a single 429 drop a slice
    // of the negatives while the function still reported success — and the caller `$set`s the
    // result, overwriting a complete snapshot with a silently incomplete one. Failing the level as
    // a unit preserves the pre-chunking contract exactly: this level yields all-or-nothing, the
    // other level still proceeds independently, and a stale-but-complete snapshot survives.
    let normalizedAdGroupNeg = [];
    try {
      const collected = [];
      for (let i = 0; i < adGroupNegChunks.length; i++) {
        // Pace the chunks. Pre-chunking this was one request; a 5,102-campaign account now issues
        // 52, and firing them back-to-back is itself a plausible 429 trigger.
        if (i > 0) await sleep(CHUNK_DELAY_MS);
        await fetchAllPages(
          `${baseUrl}/sp/negativeKeywords/list`,
          adGroupNegChunks[i],
          adGroupNegHeaders,
          'negativeKeywords',
          { onPage: (items) => {
              for (const item of items) {
                // Stand-in for the adGroupIdFilter we could not send alongside a chunked
                // campaignIdFilter. Only applied when chunking by campaign — when chunking by
                // ad group the filter is already in the request.
                if (chunkByCampaign && adGroupIdSet && !adGroupIdSet.has(String(item.adGroupId || ''))) continue;
                collected.push({
                  campaignId: item.campaignId || '',
                  adGroupId: item.adGroupId || '',
                  keywordId: item.keywordId || '',
                  keywordText: item.keywordText || '',
                  matchType: item.matchType || '',
                  state: item.state || 'ENABLED',
                  stateLower: (item.state || '').toLowerCase(),
                  _level: 'adGroup',
                  _v3Original: true
                });
              }
            } }
        );
      }
      // Only publish once every chunk landed, so a mid-loop throw cannot leak a partial set.
      normalizedAdGroupNeg = collected;
    } catch (err) {
      logger.warn('Failed to fetch ad-group-level negative keywords, continuing with campaign-level', {
        error: err.message,
        totalChunks: adGroupNegChunks.length,
        userId
      });
    }
    console.log(`  ↳ Ad-group-level negative keywords: ${normalizedAdGroupNeg.length}`);

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

    // Chunked for the same include[] cap. An empty campaign list yields no chunks, preserving the
    // previous "no filter supplied" behaviour of a single unfiltered request.
    const campNegChunks = validCampaignIds.length > 0
      ? chunkIds(validCampaignIds).map(chunk => ({ campaignIdFilter: { include: chunk } }))
      : [{}];

    console.log(`📦 Campaign-level negatives: ${campNegChunks.length} chunk(s) of <= ${ADS_ID_FILTER_MAX} campaign IDs`);

    // Streamed: normalize each page into the accumulator; raw pages are dropped.
    // All-or-nothing per level, for the same reason as the ad-group loop above.
    let normalizedCampNeg = [];
    try {
      const collected = [];
      for (let i = 0; i < campNegChunks.length; i++) {
        if (i > 0) await sleep(CHUNK_DELAY_MS);
        await fetchAllPages(
          `${baseUrl}/sp/campaignNegativeKeywords/list`,
          campNegChunks[i],
          campNegHeaders,
          'campaignNegativeKeywords',
          { onPage: (items) => {
              for (const item of items) collected.push({
                campaignId: item.campaignId || '',
                adGroupId: '',  // Campaign-level negatives don't have adGroupId
                keywordId: item.keywordId || '',
                keywordText: item.keywordText || '',
                matchType: item.matchType || '',
                state: item.state || 'ENABLED',
                stateLower: (item.state || '').toLowerCase(),
                _level: 'campaign',
                _v3Original: true
              });
            } }
        );
      }
      normalizedCampNeg = collected;
    } catch (err) {
      logger.warn('Failed to fetch campaign-level negative keywords, continuing with ad-group-level only', {
        error: err.message,
        totalChunks: campNegChunks.length,
        userId
      });
    }
    console.log(`  ↳ Campaign-level negative keywords: ${normalizedCampNeg.length}`);

    // ===== MERGE =====
    const allNegativeKeywordsData = [...normalizedAdGroupNeg, ...normalizedCampNeg];

    // Remove duplicates based on keywordId (if any), keeping first occurrence.
    // Set-keyed rather than filter+findIndex: that was O(n^2) and only survived because the
    // unchunked requests above always 400'd and left this array empty. Now that real data flows
    // for large accounts it would be a hot loop over tens of thousands of rows.
    const seenKeywordIds = new Set();
    const uniqueNegativeKeywordsData = allNegativeKeywordsData.filter((item) => {
      if (seenKeywordIds.has(item.keywordId)) return false;
      seenKeywordIds.add(item.keywordId);
      return true;
    });

    console.log(`✅ Negative keywords processing complete: ${uniqueNegativeKeywordsData.length} unique keywords found`);

    // Save all merged data, chunking only if the set is too large for one 16MB document.
    // Below the threshold this is byte-identical to the previous single `$set` — the whole
    // reason the existing chunking suite keeps passing unmodified. Above it, the primary doc
    // becomes a flagged header and the rows spill into NegativeKeywordChunk; readers
    // reassemble transparently in loadLatestSnapshotDoc.
    const metricDate = getYesterdayMetricDateUtc();
    const negativeKeywords = await persistChunkedSnapshot({
      Model: NegativeKeywords,
      ChunkModel: NegativeKeywordChunk,
      dataField: 'negativeKeywordsData',
      userId,
      country,
      region,
      metricDate,
      rows: uniqueNegativeKeywordsData.map(toStoredNegativeRow),
      label: 'negativeKeywords',
    });

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
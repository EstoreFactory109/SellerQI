const axios = require('axios');
const KeywordModel = require('../../models/amazon-ads/keywordModel.js');
const KeywordChunkModel = require('../../models/amazon-ads/keywordChunkModel.js');
const logger = require('../../utils/Logger.js');
const { getYesterdayMetricDateUtc } = require('../../utils/metricDateKey.js');

// A single MongoDB document is capped at 16MB. Keep each physical keyword
// document well under that so even accounts with very large keyword sets
// persist reliably. Snapshots at or under this size stay inline in the primary
// Keyword document (unchanged legacy behaviour); larger ones spill into
// KeywordChunk documents and are reassembled by `loadKeywordSnapshot`.
const KEYWORD_CHUNK_SIZE = 10000;

/**
 * Project the raw Amazon Ads v3 keywords down to the slim, schema-shaped rows
 * we persist. Built in batches that yield to the event loop so a huge keyword
 * set (tens of thousands) never blocks it — blocking would starve the BullMQ
 * lock-renewal heartbeat and stall the whole job.
 */
async function buildKeywordRows(rawKeywords) {
    const rows = new Array(rawKeywords.length);
    const BUILD_BATCH = 5000;
    for (let i = 0; i < rawKeywords.length; i++) {
        const kw = rawKeywords[i] || {};
        rows[i] = {
            keywordId: kw.keywordId,
            adGroupId: kw.adGroupId,
            campaignId: kw.campaignId,
            keywordText: kw.keywordText,
            matchType: kw.matchType,
            bid: kw.bid,
            state: kw.state
        };
        if ((i + 1) % BUILD_BATCH === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }
    return rows;
}

/**
 * Persist a keyword snapshot for one (account, metricDate), transparently
 * chunking when the set is too large for a single 16MB document.
 *
 * - Small/normal snapshots: written inline to the primary Keyword document,
 *   byte-for-byte the same shape the legacy code produced.
 * - Oversized snapshots: the primary Keyword document becomes a flagged header
 *   (`isChunked: true`, empty keywordData) and the full set is written across
 *   KeywordChunk documents. Chunk writes are awaited one at a time so the event
 *   loop (and the lock heartbeat) keeps breathing between batches.
 *
 * Stale chunks from a prior, larger sync are always cleared first so a
 * shrinking account never leaves orphaned higher-index chunks behind.
 */
async function persistKeywordSnapshot(userId, country, region, metricDate, keywordRows) {
    const userIdStr = String(userId);

    await KeywordChunkModel.deleteMany({ userId: userIdStr, country, region, metricDate });

    if (keywordRows.length <= KEYWORD_CHUNK_SIZE) {
        return KeywordModel.findOneAndUpdate(
            { userId: userIdStr, country, region, metricDate },
            {
                $set: {
                    userId: userIdStr,
                    country,
                    region,
                    metricDate,
                    keywordData: keywordRows,
                    isChunked: false,
                    totalChunks: 1
                }
            },
            { new: true, upsert: true, runValidators: true }
        );
    }

    const totalChunks = Math.ceil(keywordRows.length / KEYWORD_CHUNK_SIZE);
    for (let c = 0; c < totalChunks; c++) {
        const slice = keywordRows.slice(c * KEYWORD_CHUNK_SIZE, (c + 1) * KEYWORD_CHUNK_SIZE);
        await KeywordChunkModel.updateOne(
            { userId: userIdStr, country, region, metricDate, chunkIndex: c },
            {
                $set: {
                    userId: userIdStr,
                    country,
                    region,
                    metricDate,
                    chunkIndex: c,
                    totalChunks,
                    keywordData: slice
                }
            },
            { upsert: true }
        );
    }

    const header = await KeywordModel.findOneAndUpdate(
        { userId: userIdStr, country, region, metricDate },
        {
            $set: {
                userId: userIdStr,
                country,
                region,
                metricDate,
                keywordData: [],
                isChunked: true,
                totalChunks
            }
        },
        { new: true, upsert: true }
    );

    console.log(`✅ Keywords stored across ${totalChunks} chunks (${keywordRows.length} keywords) — oversized snapshot`);
    return header;
}

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
      // Clear any chunks left over from a previously larger snapshot, then write
      // an empty inline snapshot (isChunked:false) for consistency.
      const createdKeywords = await persistKeywordSnapshot(userId, country, region, metricDate, []);

      console.log(`✅ Empty keywords data saved for consistency`);
      return createdKeywords;
    } else {
      // Log some stats
      const enabledKeywords = allKeywords.filter(keyword =>
        keyword && keyword.state === 'ENABLED'
      );
      console.log(`📊 Keywords breakdown: ${allKeywords.length} total, ${enabledKeywords.length} enabled`);
    }

    // ===== BUILD SLIM SCHEMA ROWS (event-loop friendly) =====
    // Only the persisted schema fields are kept; built in yielding batches so a
    // very large keyword set never blocks the event loop / lock heartbeat.
    const keywordRows = await buildKeywordRows(allKeywords);

    // ===== SAVE TO DATABASE (chunk-aware) =====
    let createdKeywords;
    try {
      const metricDate = getYesterdayMetricDateUtc();
      createdKeywords = await persistKeywordSnapshot(userId, country, region, metricDate, keywordRows);

      if (!createdKeywords) {
        logger.warn('Failed to save keywords data to database, but continuing with API data', {
          userId,
          region,
          country,
          keywordCount: keywordRows.length
        });

        return {
          userId,
          country,
          region,
          keywordData: keywordRows,
          _isTemporary: true
        };
      }

      console.log(`✅ Keywords data saved successfully: ${keywordRows.length} keywords stored`);
      return createdKeywords;

    } catch (dbError) {
      logger.error('Database error while saving keywords data', {
        error: dbError.message,
        userId,
        region,
        country,
        keywordCount: keywordRows.length
      });

      return {
        userId,
        country,
        region,
        keywordData: keywordRows,
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
  getKeywords,
  // Exposed for tests / scripts. persistKeywordSnapshot handles chunked vs
  // inline storage; buildKeywordRows projects raw v3 keywords to slim rows.
  persistKeywordSnapshot,
  buildKeywordRows,
  KEYWORD_CHUNK_SIZE
};
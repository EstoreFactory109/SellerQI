/**
 * Amazon Ads API - Pause or Archive Keywords Utility
 * Supports: Sponsored Products (SP), Sponsored Brands (SB), Sponsored Display (SD)
 * Input modes: single keyword ID, list of keyword IDs, or keyword text + match type
 * States: "PAUSED" | "ARCHIVED" (SP uses uppercase; SB/SD use lowercase)
 */

const axios = require("axios");

// ─────────────────────────────────────────────
// CONFIG — from env or overridden by options when provided
// ─────────────────────────────────────────────
function getConfig(overrides = {}) {
  return {
    clientId: overrides.clientId ?? process.env.AMAZON_ADS_CLIENT_ID,
    accessToken: overrides.accessToken ?? process.env.AMAZON_ADS_ACCESS_TOKEN,
    profileId: overrides.profileId ?? process.env.AMAZON_ADS_PROFILE_ID,
    region: (overrides.region ?? process.env.AMAZON_ADS_REGION) || "NA",
  };
}

// Base URLs per region
const BASE_URLS = {
  NA: "https://advertising-api.amazon.com",
  EU: "https://advertising-api-eu.amazon.com",
  FE: "https://advertising-api-fe.amazon.com",
};

// ─────────────────────────────────────────────
// ENDPOINTS per ad type
// ─────────────────────────────────────────────
const ENDPOINTS = {
  SP: "/sp/keywords",       // Sponsored Products  (v3)
  SB: "/sb/v4/keywords",    // Sponsored Brands    (v4)
  SD: "/sd/keywords",       // Sponsored Display   (v3)
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Build common request headers for Amazon Ads API
 * @param {object} config - { accessToken, clientId, profileId }
 */
function buildHeaders(config) {
  return {
    "Content-Type": "application/vnd.spKeyword.v3+json",
    Authorization: `Bearer ${config.accessToken}`,
    "Amazon-Advertising-API-ClientId": config.clientId,
    "Amazon-Advertising-API-Scope": String(config.profileId),
  };
}

/**
 * Resolve headers per ad type (Content-Type and Accept required for SP v3 API)
 */
function buildHeadersForAdType(adType, config) {
  const contentTypeMap = {
    SP: "application/vnd.spKeyword.v3+json",
    SB: "application/json",
    SD: "application/json",
  };
  const acceptMap = {
    SP: "application/vnd.spKeyword.v3+json",
    SB: "application/json",
    SD: "application/json",
  };
  const headers = {
    ...buildHeaders(config),
    "Content-Type": contentTypeMap[adType] || "application/json",
  };
  if (acceptMap[adType]) {
    headers.Accept = acceptMap[adType];
  }
  return headers;
}

/**
 * Fetch keyword ID(s) by keyword text + match type
 * Used when the caller provides text instead of IDs.
 *
 * @param {object}   config      - { accessToken, clientId, profileId, region }
 * @param {string}   adType      - "SP" | "SB" | "SD"
 * @param {string}   keywordText - e.g. "running shoes"
 * @param {string}   matchType   - "EXACT" | "PHRASE" | "BROAD"
 * @returns {Promise<string[]>}  - array of matching keyword IDs
 */
async function fetchKeywordIdsByText(config, adType, keywordText, matchType) {
  const baseUrl = BASE_URLS[config.region];
  const endpoint = ENDPOINTS[adType];
  const url = `${baseUrl}${endpoint}/list`;

  const payload = {
    stateFilter: { include: ["ENABLED"] }, // only look for active keywords
    keywordTextFilter: { queryTermMatchType: "BROAD_MATCH", include: [keywordText] },
  };

  const response = await axios.post(url, payload, {
    headers: buildHeadersForAdType(adType, config),
  });

  const items = response.data?.keywords || response.data?.keywordResponses || [];

  // Filter by match type if provided
  const filtered = matchType
    ? items.filter((k) => k.matchType?.toUpperCase() === matchType.toUpperCase())
    : items;

  if (filtered.length === 0) {
    throw new Error(
      `No ENABLED keywords found for text "${keywordText}"${matchType ? ` with matchType "${matchType}"` : ""} in ${adType}`
    );
  }

  return filtered.map((k) => String(k.keywordId));
}

/**
 * Normalize state for each ad type (SP uses uppercase, SB/SD use lowercase).
 * @param {string} state - "PAUSED" | "ARCHIVED"
 * @param {string} adType - "SP" | "SB" | "SD"
 */
function stateForAdType(state, adType) {
  const upper = (state || "PAUSED").toUpperCase();
  if (adType === "SP") return upper; // PAUSED | ARCHIVED
  return upper.charAt(0) + upper.slice(1).toLowerCase(); // paused | archived
}

/**
 * Send a state update (pause or archive) for a list of keyword IDs.
 *
 * @param {object}   config      - { accessToken, clientId, profileId, region }
 * @param {string}   adType      - "SP" | "SB" | "SD"
 * @param {string[]} keywordIds  - array of keyword ID strings
 * @param {string}   state       - "PAUSED" | "ARCHIVED"
 * @returns {Promise<object>}    - raw API response data
 */
async function updateKeywordStateByIds(config, adType, keywordIds, state) {
  const baseUrl = BASE_URLS[config.region];
  const url = `${baseUrl}${ENDPOINTS[adType]}`;
  const stateValue = stateForAdType(state, adType);

  let payload;
  if (adType === "SP") {
    payload = {
      keywords: keywordIds.map((id) => ({
        keywordId: id,
        state: stateValue,
      })),
    };
  } else if (adType === "SB") {
    payload = keywordIds.map((id) => ({
      keywordId: Number(id),
      state: stateValue,
    }));
  } else {
    payload = keywordIds.map((id) => ({
      keywordId: id,
      state: stateValue,
    }));
  }

  const response = await axios.put(url, payload, {
    headers: buildHeadersForAdType(adType, config),
  });

  return response.data;
}

// ─────────────────────────────────────────────
// MAIN EXPORTED FUNCTION
// ─────────────────────────────────────────────

/**
 * Pause or archive one or more Amazon Ads keywords (shared implementation).
 *
 * @param {object} options
 * @param {"PAUSED"|"ARCHIVED"} options.state - Target state (default "PAUSED")
 * @param {"SP"|"SB"|"SD"|"ALL"} options.adType
 * @param {string}   [options.keywordId]    - Single keyword ID (mode 1)
 * @param {string[]} [options.keywordIds]   - Array of keyword IDs (mode 2)
 * @param {string}   [options.keywordText]  - Keyword text to look up (mode 3)
 * @param {string}   [options.matchType]    - "EXACT" | "PHRASE" | "BROAD" (when using keywordText)
 * @param {string}   [options.accessToken]  - Override env (required when not using env)
 * @param {string}   [options.profileId]   - Override env (required when not using env)
 * @param {string}   [options.region]      - Override env ("NA" | "EU" | "FE")
 * @param {string}   [options.clientId]    - Override env (optional; usually from env)
 * @returns {Promise<object>} Results keyed by ad type
 */
async function updateKeywordsState({
  state = "PAUSED",
  adType = "SP",
  keywordId,
  keywordIds,
  keywordText,
  matchType,
  accessToken,
  profileId,
  region,
  clientId,
}) {
  const config = getConfig({ accessToken, profileId, region, clientId });
  if (!config.accessToken || !config.clientId || !config.profileId) {
    throw new Error(
      "Missing credentials. Provide accessToken, profileId (and optionally region, clientId) or set AMAZON_ADS_ACCESS_TOKEN, AMAZON_ADS_PROFILE_ID, AMAZON_ADS_CLIENT_ID in env."
    );
  }

  const validAdTypes = ["SP", "SB", "SD", "ALL"];
  if (!validAdTypes.includes(adType.toUpperCase())) {
    throw new Error(`Invalid adType "${adType}". Must be one of: ${validAdTypes.join(", ")}`);
  }

  const hasId = Boolean(keywordId);
  const hasIds = Array.isArray(keywordIds) && keywordIds.length > 0;
  const hasText = Boolean(keywordText);

  if (!hasId && !hasIds && !hasText) {
    throw new Error(
      "You must provide at least one of: keywordId, keywordIds, or keywordText."
    );
  }

  let resolvedIds;

  if (hasId) {
    resolvedIds = [String(keywordId)];
  } else if (hasIds) {
    resolvedIds = keywordIds.map(String);
  } else {
    if (adType.toUpperCase() === "ALL") {
      throw new Error(
        'keywordText lookup with adType "ALL" is not supported. ' +
        "Please specify a single ad type (SP, SB, or SD) when using keywordText."
      );
    }
    console.log(`🔍 Looking up keyword IDs for text: "${keywordText}" (${matchType || "any match type"})...`);
    resolvedIds = await fetchKeywordIdsByText(config, adType.toUpperCase(), keywordText, matchType);
    console.log(`✅ Found ${resolvedIds.length} keyword(s): ${resolvedIds.join(", ")}`);
  }

  const targets = adType.toUpperCase() === "ALL" ? ["SP", "SB", "SD"] : [adType.toUpperCase()];
  const stateLabel = (state || "PAUSED").toUpperCase();
  const results = {};

  for (const type of targets) {
    try {
      console.log(`⏸  Setting ${resolvedIds.length} keyword(s) to ${stateLabel} in ${type}...`);
      const result = await updateKeywordStateByIds(config, type, resolvedIds, stateLabel);
      results[type] = { success: true, data: result };
      console.log(`✅ ${type}: Successfully set ${resolvedIds.length} keyword(s) to ${stateLabel}.`);
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      results[type] = { success: false, error: errorMsg };
      console.error(`❌ ${type}: Failed to set keywords to ${stateLabel} — ${errorMsg}`);
    }
  }

  return results;
}

/**
 * Pause one or more Amazon Ads keywords.
 * @param {object} options - Same as updateKeywordsState but state is fixed to "PAUSED"
 * @returns {Promise<object>} Results keyed by ad type
 */
async function pauseKeywords(options) {
  return updateKeywordsState({ ...options, state: "PAUSED" });
}

/**
 * Archive one or more Amazon Ads keywords.
 * @param {object} options - Same as updateKeywordsState but state is fixed to "ARCHIVED"
 * @returns {Promise<object>} Results keyed by ad type
 */
async function archiveKeywords(options) {
  return updateKeywordsState({ ...options, state: "ARCHIVED" });
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = { pauseKeywords, archiveKeywords, updateKeywordsState };


// ─────────────────────────────────────────────
// USAGE EXAMPLES (remove before production)
// ─────────────────────────────────────────────
async function runExamples() {
  try {
    // With per-request credentials (e.g. from your auth/DB):
    // const result = await pauseKeywords({
    //   adType: "SP", keywordIds: ["123"],
    //   accessToken, profileId, region,
    // });

    // Example 1: Pause a single keyword by ID (Sponsored Products)
    console.log("\n--- Example 1: Single keyword ID ---");
    const result1 = await pauseKeywords({
      adType: "SP",
      keywordId: "123456789",
    });
    console.log(JSON.stringify(result1, null, 2));

    // Example 2: Archive multiple keywords (Sponsored Brands)
    console.log("\n--- Example 2: Archive multiple keywords ---");
    const result2 = await archiveKeywords({
      adType: "SB",
      keywordIds: ["111111111", "222222222"],
    });
    console.log(JSON.stringify(result2, null, 2));

    // Example 3: Pause by keyword text + match type
    console.log("\n--- Example 3: Keyword text + match type ---");
    const result3 = await pauseKeywords({
      adType: "SP",
      keywordText: "running shoes",
      matchType: "EXACT",
    });
    console.log(JSON.stringify(result3, null, 2));

    // Example 4: Pause across ALL ad types by keyword IDs
    console.log("\n--- Example 4: All ad types ---");
    const result4 = await pauseKeywords({
      adType: "ALL",
      keywordIds: ["444444444", "555555555"],
    });
    console.log(JSON.stringify(result4, null, 2));
  } catch (err) {
    console.error("Fatal error:", err.message);
  }
}

// Uncomment to run examples directly:
// runExamples();


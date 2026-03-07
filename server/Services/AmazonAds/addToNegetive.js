/**
 * ============================================================
 *  Amazon Advertising API — Add to Negative Keywords (JS)
 *  Covers: SP Ad-Group level & Campaign level negative keywords
 *  Uses v3 API for create (aligned with convertToNegativeKeyword.js).
 *  Config: pass credentials or use env (AMAZON_ADS_*).
 * ============================================================
 */

const BASE_URIS = {
  NA: "https://advertising-api.amazon.com",
  EU: "https://advertising-api-eu.amazon.com",
  FE: "https://advertising-api-fe.amazon.com",
};

/**
 * Resolve config from env or overrides (for use in app with per-user credentials).
 * @param {object} overrides - { accessToken, clientId, profileId, region }
 */
function getConfig(overrides = {}) {
  const region = (overrides.region ?? process.env.AMAZON_ADS_REGION) || "NA";
  const baseUrl = BASE_URIS[region] || BASE_URIS.NA;
  return {
    clientId: overrides.clientId ?? process.env.AMAZON_ADS_CLIENT_ID,
    accessToken: overrides.accessToken ?? process.env.AMAZON_ADS_ACCESS_TOKEN,
    profileId: overrides.profileId ?? process.env.AMAZON_ADS_PROFILE_ID,
    region,
    baseUrl,
  };
}

/**
 * Normalize matchType to API format (NEGATIVE_EXACT | NEGATIVE_PHRASE).
 */
function toApiMatchType(matchType) {
  const t = (matchType || "negativeExact").toString().toLowerCase();
  if (t === "negativephrase" || t === "negative_phrase") return "NEGATIVE_PHRASE";
  return "NEGATIVE_EXACT";
}

/** v3 media types: negative keyword endpoints use a different type than regular keywords */
const V3_MEDIA = {
  spkeyword: "application/vnd.spKeyword.v3+json",
  spnegativeKeyword: "application/vnd.spnegativeKeyword.v3+json",
};

/**
 * Builds headers for Amazon Ads API (v3 media type for create).
 * @param {object} config
 * @param {string|boolean} v3Media - 'spnegativeKeyword' | 'spkeyword' | false
 */
function buildHeaders(config, v3Media = false) {
  const headers = {
    Authorization: `Bearer ${config.accessToken}`,
    "Amazon-Advertising-API-ClientId": config.clientId,
    "Amazon-Advertising-API-Scope": String(config.profileId),
    "Content-Type": "application/json",
  };
  const mediaType = typeof v3Media === "string" && V3_MEDIA[v3Media] ? V3_MEDIA[v3Media] : null;
  if (mediaType) {
    headers["Content-Type"] = mediaType;
    headers.Accept = mediaType;
  } else {
    headers.Accept = "application/json";
  }
  return headers;
}

/**
 * Resolve v3 media type for POST /sp/... paths (negative keyword vs keyword).
 */
function getV3MediaForPath(method, path) {
  if (method !== "POST" || !path.startsWith("/sp/")) return false;
  if (path.includes("negativeKeyword")) return "spnegativeKeyword";
  return "spkeyword";
}

/**
 * Generic API request with safe JSON parse (handles 204 No Content).
 */
async function apiRequest(method, path, config, body = null) {
  const url = `${config.baseUrl}${path}`;
  const v3Media = getV3MediaForPath(method, path);
  const options = {
    method,
    headers: buildHeaders(config, v3Media),
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;

  if (!response.ok) {
    const errMsg = data ? (data.message || data.description || JSON.stringify(data)) : text || response.statusText;
    throw new Error(`API Error ${response.status}: ${errMsg}`);
  }

  return data;
}
  
// ─────────────────────────────────────────────────────────────
// LIST PROFILES (optional, for setup)
// ─────────────────────────────────────────────────────────────

/**
 * Lists all advertising profiles (uses v2). Config from getConfig().
 */
async function listProfiles(config) {
  const profiles = await apiRequest("GET", "/v2/profiles", config);
  return Array.isArray(profiles) ? profiles : [];
}

// ─────────────────────────────────────────────────────────────
// AD-GROUP LEVEL NEGATIVE KEYWORDS (v3 create)
// ─────────────────────────────────────────────────────────────

/**
 * Adds one or more negative keywords at the AD GROUP level.
 * Uses v3 API: POST /sp/negativeKeywords with { negativeKeywords: [...] }.
 * matchType: "negativeExact" | "negativePhrase" (or NEGATIVE_EXACT | NEGATIVE_PHRASE).
 *
 * @param {object} config - from getConfig(), must have accessToken, clientId, profileId, baseUrl
 * @param {Array}  keywords - [{ campaignId, adGroupId, keywordText, matchType?, state? }]
 * @returns {Promise<object>} API response (v3 shape with success/error arrays)
 */
async function addAdGroupNegativeKeywords(config, keywords) {
  if (!keywords || keywords.length === 0) {
    throw new Error("At least one keyword is required");
  }
  keywords.forEach((kw) => {
    if (!kw.campaignId || !kw.adGroupId || !kw.keywordText) {
      throw new Error("Each keyword must have campaignId, adGroupId, and keywordText");
    }
  });

  const payload = {
    negativeKeywords: keywords.map((kw) => ({
      campaignId: String(kw.campaignId),
      adGroupId: String(kw.adGroupId),
      keywordText: kw.keywordText,
      matchType: toApiMatchType(kw.matchType),
      state: (kw.state || "enabled").toString().toUpperCase() === "PAUSED" ? "PAUSED" : "ENABLED",
    })),
  };

  const result = await apiRequest("POST", "/sp/negativeKeywords", config, payload);
  return result;
}

// ─────────────────────────────────────────────────────────────
// CAMPAIGN LEVEL NEGATIVE KEYWORDS (v3 create)
// ─────────────────────────────────────────────────────────────

/**
 * Adds one or more negative keywords at the CAMPAIGN level.
 * Uses v3 API: POST /sp/campaignNegativeKeywords with { campaignNegativeKeywords: [...] }.
 *
 * @param {object} config - from getConfig()
 * @param {Array}  keywords - [{ campaignId, keywordText, matchType?, state? }]
 * @returns {Promise<object>} API response
 */
async function addCampaignNegativeKeywords(config, keywords) {
  if (!keywords || keywords.length === 0) {
    throw new Error("At least one keyword is required");
  }
  keywords.forEach((kw) => {
    if (!kw.campaignId || !kw.keywordText) {
      throw new Error("Each keyword must have campaignId and keywordText");
    }
  });

  const payload = {
    campaignNegativeKeywords: keywords.map((kw) => ({
      campaignId: String(kw.campaignId),
      keywordText: kw.keywordText,
      matchType: toApiMatchType(kw.matchType),
      state: (kw.state || "enabled").toString().toUpperCase() === "PAUSED" ? "PAUSED" : "ENABLED",
    })),
  };

  const result = await apiRequest("POST", "/sp/campaignNegativeKeywords", config, payload);
  return result;
}

/**
 * Add keywords to negative in one call. Convenience wrapper.
 * @param {object} config - getConfig(overrides) or { accessToken, clientId, profileId, region/baseUrl }
 * @param {Array}  keywords - same shape as addAdGroupNegativeKeywords or addCampaignNegativeKeywords
 * @param {object} options - { level: 'adGroup' | 'campaign' }
 * @returns {Promise<object>} API response
 */
async function addToNegative(config, keywords, options = {}) {
  const resolvedConfig = config.baseUrl ? config : getConfig(config);
  const level = (options.level || "adGroup").toLowerCase();
  if (level === "campaign") {
    return addCampaignNegativeKeywords(resolvedConfig, keywords);
  }
  return addAdGroupNegativeKeywords(resolvedConfig, keywords);
}
  
// ─────────────────────────────────────────────────────────────
// LIST / ARCHIVE / UPDATE (v2 endpoints, optional)
// ─────────────────────────────────────────────────────────────

async function listAdGroupNegativeKeywords(config, filters = {}) {
  const params = new URLSearchParams();
  if (filters.campaignId) params.set("campaignIdFilter", filters.campaignId);
  if (filters.adGroupId) params.set("adGroupIdFilter", filters.adGroupId);
  if (filters.state) params.set("stateFilter", filters.state);
  params.set("count", filters.count || "100");
  const query = params.toString() ? `?${params.toString()}` : "";
  const result = await apiRequest("GET", `/v2/sp/negativeKeywords${query}`, config);
  return Array.isArray(result) ? result : [];
}

async function listCampaignNegativeKeywords(config, filters = {}) {
  const params = new URLSearchParams();
  if (filters.campaignId) params.set("campaignIdFilter", filters.campaignId);
  if (filters.state) params.set("stateFilter", filters.state);
  params.set("count", filters.count || "100");
  const query = params.toString() ? `?${params.toString()}` : "";
  const result = await apiRequest("GET", `/v2/sp/campaignNegativeKeywords${query}`, config);
  return Array.isArray(result) ? result : [];
}

async function archiveAdGroupNegativeKeyword(config, keywordId) {
  return apiRequest("DELETE", `/v2/sp/negativeKeywords/${keywordId}`, config);
}

async function archiveCampaignNegativeKeyword(config, keywordId) {
  return apiRequest("DELETE", `/v2/sp/campaignNegativeKeywords/${keywordId}`, config);
}

async function updateAdGroupNegativeKeywords(config, updates) {
  return apiRequest("PUT", "/v2/sp/negativeKeywords", config, updates);
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  getConfig,
  addAdGroupNegativeKeywords,
  addCampaignNegativeKeywords,
  addToNegative,
  listProfiles,
  listAdGroupNegativeKeywords,
  listCampaignNegativeKeywords,
  archiveAdGroupNegativeKeyword,
  archiveCampaignNegativeKeyword,
  updateAdGroupNegativeKeywords,
};

// Run demo only when executed directly: node addToNegetive.js
async function main() {
  const config = getConfig({});
  if (!config.accessToken || !config.clientId || !config.profileId) {
    console.warn("Set AMAZON_ADS_ACCESS_TOKEN, AMAZON_ADS_CLIENT_ID, AMAZON_ADS_PROFILE_ID (and optionally AMAZON_ADS_REGION) or pass config to addToNegative().");
    return;
  }
  try {
    await addAdGroupNegativeKeywords(config, [
      { campaignId: "YOUR_CAMPAIGN_ID", adGroupId: "YOUR_AD_GROUP_ID", keywordText: "cheap derma roller", matchType: "negativeExact" },
    ]);
    console.log("Add-to-negative demo completed.");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

/*
   * ============================================================
   *  QUICK REFERENCE — Negative Keyword Match Types
   * ============================================================
   *
   *  negativeExact  → blocks ONLY exact matches of the keyword
   *    e.g. "derma roller" blocks searches for "derma roller"
   *         but NOT "buy derma roller" or "cheap derma roller"
   *
   *  negativePhrase → blocks any search containing the keyword phrase
   *    e.g. "derma roller" blocks "buy derma roller",
   *         "cheap derma roller", etc.
   *
   *  (Note: Amazon SP does NOT support negativeBroad at ad-group level)
   *
   * ============================================================
   *  API ENDPOINTS SUMMARY
   * ============================================================
   *
   *  Ad-Group Level Negative Keywords:
   *    POST   /v2/sp/negativeKeywords           — Create
   *    GET    /v2/sp/negativeKeywords           — List
   *    GET    /v2/sp/negativeKeywords/{id}      — Get one
   *    PUT    /v2/sp/negativeKeywords           — Update state
   *    DELETE /v2/sp/negativeKeywords/{id}      — Archive
   *
   *  Campaign Level Negative Keywords:
   *    POST   /v2/sp/campaignNegativeKeywords   — Create
   *    GET    /v2/sp/campaignNegativeKeywords   — List
   *    GET    /v2/sp/campaignNegativeKeywords/{id} — Get one
   *    PUT    /v2/sp/campaignNegativeKeywords   — Update state
   *    DELETE /v2/sp/campaignNegativeKeywords/{id} — Archive
   *
   * ============================================================
   *  REGION BASE URLS
   * ============================================================
   *
   *  North America (US, CA, MX, BR): https://advertising-api.amazon.com
   *  Europe (UK, DE, FR, IT, ES...): https://advertising-api-eu.amazon.com
   *  Far East (JP, AU, SG, IN...):   https://advertising-api-fe.amazon.com
   *
   * ============================================================
   */
/**
 * Sponsored Products (Amazon Ads v3) creates, state changes and the live reads they
 * need. Used only by change handlers (Services/Actions/handlers/adsCreate.js), so
 * every call here runs after the seller approved the exact change.
 *
 * Each write answers { <entity>: { success: [{index, <id>}], error: [{index, errors}] } }:
 * callers check per-item errors (Services/Actions/adsErrors.js).
 */
const axios = require('axios');

const BASE_URIS = {
    NA: 'https://advertising-api.amazon.com',
    EU: 'https://advertising-api-eu.amazon.com',
    FE: 'https://advertising-api-fe.amazon.com'
};
const MEDIA = {
    campaign: 'application/vnd.spCampaign.v3+json',
    adGroup: 'application/vnd.spAdGroup.v3+json',
    productAd: 'application/vnd.spProductAd.v3+json',
    keyword: 'application/vnd.spKeyword.v3+json'
};
const ALL_STATES = ['ENABLED', 'PAUSED', 'ARCHIVED'];
const TIMEOUT_MS = 30000;

function headers({ accessToken, profileId }, media) {
    return {
        Authorization: `Bearer ${accessToken}`,
        'Amazon-Advertising-API-Scope': String(profileId),
        'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
        'Content-Type': media,
        Accept: media
    };
}

const url = (creds, path) => {
    const base = BASE_URIS[creds.region];
    if (!base) throw new Error(`Unknown Amazon Ads region ${creds.region}`);
    return `${base}${path}`;
};

async function post(creds, path, media, body) {
    const res = await axios.post(url(creds, path), body, { headers: headers(creds, media), timeout: TIMEOUT_MS });
    return res.data;
}

async function put(creds, path, media, body) {
    const res = await axios.put(url(creds, path), body, { headers: headers(creds, media), timeout: TIMEOUT_MS });
    return res.data;
}

/** A paged v3 list. `key` is the array in the answer (campaigns, adGroups, keywords). */
async function listAll(creds, path, media, key, filter, maxPages = 20) {
    const out = [];
    let nextToken = null;
    let pages = 0;
    do {
        const data = await post(creds, path, media, { maxResults: 1000, ...filter, ...(nextToken ? { nextToken } : {}) });
        out.push(...(data?.[key] || []));
        nextToken = data?.nextToken || null;
        pages += 1;
    } while (nextToken && pages < maxPages);
    return out;
}

// ---- Live reads (every state, unlike the daily snapshots) ----

function listCampaigns(creds, { campaignIds = null, names = null, states = ALL_STATES } = {}) {
    return listAll(creds, '/sp/campaigns/list', MEDIA.campaign, 'campaigns', {
        stateFilter: { include: states },
        ...(campaignIds ? { campaignIdFilter: { include: campaignIds.map(String) } } : {}),
        ...(names ? { nameFilter: { queryTermMatchType: 'EXACT_MATCH', include: names } } : {})
    });
}

function listAdGroups(creds, { adGroupIds = null, campaignIds = null, states = ALL_STATES } = {}) {
    return listAll(creds, '/sp/adGroups/list', MEDIA.adGroup, 'adGroups', {
        stateFilter: { include: states },
        ...(adGroupIds ? { adGroupIdFilter: { include: adGroupIds.map(String) } } : {}),
        ...(campaignIds ? { campaignIdFilter: { include: campaignIds.map(String) } } : {})
    });
}

function listKeywords(creds, { adGroupIds, states = ['ENABLED', 'PAUSED'] }) {
    return listAll(creds, '/sp/keywords/list', MEDIA.keyword, 'keywords', {
        stateFilter: { include: states },
        adGroupIdFilter: { include: adGroupIds.map(String) }
    });
}

// ---- Writes ----

const createCampaigns = (creds, campaigns) => post(creds, '/sp/campaigns', MEDIA.campaign, { campaigns });
const createAdGroups = (creds, adGroups) => post(creds, '/sp/adGroups', MEDIA.adGroup, { adGroups });
const createProductAds = (creds, productAds) => post(creds, '/sp/productAds', MEDIA.productAd, { productAds });

/** Keywords in chunks of 1000 (Amazon's limit per request); answers merged. */
async function createKeywords(creds, keywords) {
    const merged = { keywords: { success: [], error: [] } };
    for (let i = 0; i < keywords.length; i += 1000) {
        const data = await post(creds, '/sp/keywords', MEDIA.keyword, { keywords: keywords.slice(i, i + 1000) });
        for (const s of data?.keywords?.success || []) merged.keywords.success.push({ ...s, index: (s.index || 0) + i });
        for (const e of data?.keywords?.error || []) merged.keywords.error.push({ ...e, index: (e.index || 0) + i });
    }
    return merged;
}

const updateCampaignStates = (creds, items) => put(creds, '/sp/campaigns', MEDIA.campaign, { campaigns: items.map((c) => ({ campaignId: String(c.campaignId), state: c.state })) });
const updateAdGroupStates = (creds, items) => put(creds, '/sp/adGroups', MEDIA.adGroup, { adGroups: items.map((g) => ({ adGroupId: String(g.adGroupId), state: g.state })) });

module.exports = {
    listCampaigns, listAdGroups, listKeywords,
    createCampaigns, createAdGroups, createProductAds, createKeywords,
    updateCampaignStates, updateAdGroupStates,
    MEDIA, ALL_STATES
};

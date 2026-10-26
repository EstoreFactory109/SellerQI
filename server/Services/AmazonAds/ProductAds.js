/**
 * Sponsored Products product ads for one ASIN: list (a read) and pause. Pausing is
 * only ever called after the seller approved it (TaskActionService
 * 'pause_product_ads', for "Ads running on products that cannot sell").
 */
const axios = require('axios');

const BASE_URIS = {
    NA: 'https://advertising-api.amazon.com',
    EU: 'https://advertising-api-eu.amazon.com',
    FE: 'https://advertising-api-fe.amazon.com'
};
const MEDIA = 'application/vnd.spProductAd.v3+json';
const headers = (accessToken, profileId) => ({
    'Authorization': `Bearer ${accessToken}`,
    'Amazon-Advertising-API-Scope': String(profileId),
    'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
    'Content-Type': MEDIA,
    'Accept': MEDIA
});

/** Enabled product ads advertising this ASIN, read live. */
async function listEnabledProductAdsForAsin({ asin, accessToken, profileId, region }) {
    const ads = [];
    let nextToken = null;
    let pages = 0;
    do {
        const body = { stateFilter: { include: ['ENABLED'] }, maxResults: 1000, ...(nextToken ? { nextToken } : {}) };
        const res = await axios.post(`${BASE_URIS[region]}/sp/productAds/list`, body, { headers: headers(accessToken, profileId) });
        for (const ad of res.data?.productAds || []) {
            if (String(ad.asin || '').toUpperCase() === String(asin).toUpperCase()) ads.push(ad);
        }
        nextToken = res.data?.nextToken || null;
        pages++;
    } while (nextToken && pages < 50);
    return ads;
}

/** Pause the given product ads (v3 PUT /sp/productAds). */
async function pauseProductAds({ adIds, accessToken, profileId, region }) {
    if (!Array.isArray(adIds) || adIds.length === 0) throw new Error('No product ads to pause.');
    const body = { productAds: adIds.map(adId => ({ adId: String(adId), state: 'PAUSED' })) };
    const res = await axios.put(`${BASE_URIS[region]}/sp/productAds`, body, { headers: headers(accessToken, profileId) });
    return res.data;
}

module.exports = { listEnabledProductAdsForAsin, pauseProductAds };

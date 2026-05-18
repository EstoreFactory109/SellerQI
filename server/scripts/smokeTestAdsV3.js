#!/usr/bin/env node
/**
 * Smoke-test Amazon Ads SP v3 entity endpoints against a real Ads profile.
 *
 * Validates:
 *   1. GetCampaigns    → POST /sp/campaigns/list
 *   2. AdGroups        → POST /sp/adGroups/list
 *   3. Keywords        → POST /sp/keywords/list
 *   4. NegativeKeywords→ POST /sp/negativeKeywords/list
 *                       + POST /sp/campaignNegativeKeywords/list
 *
 * Checks response shape, field names, enum casing (ENABLED vs enabled),
 * and Accept header acceptance.
 *
 * Usage (from repo root):
 *   node server/scripts/smokeTestAdsV3.js \
 *     --userId=<userId> --country=<code> --region=<NA|EU|FE>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

const DB_URI = process.env.DB_URI;
const DB_NAME = process.env.DB_NAME;
const MONGODB_URI = DB_URI.includes('?')
    ? `${DB_URI}/${DB_NAME}&retryWrites=true&w=majority`
    : `${DB_URI}/${DB_NAME}?retryWrites=true&w=majority`;

const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, val] = arg.replace(/^--/, '').split('=');
    acc[key] = val;
    return acc;
}, {});

const { userId, country, region } = args;

if (!userId || !country || !region) {
    console.error('Usage: node server/scripts/smokeTestAdsV3.js --userId=<id> --country=<code> --region=<NA|EU|FE>');
    process.exit(1);
}

const BASE_URIS = {
    NA: 'https://advertising-api.amazon.com',
    EU: 'https://advertising-api-eu.amazon.com',
    FE: 'https://advertising-api-fe.amazon.com',
};

const baseUri = BASE_URIS[region];
if (!baseUri) {
    console.error(`Invalid region: ${region}`);
    process.exit(1);
}

const clientId = process.env.AMAZON_ADS_CLIENT_ID;
const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET;
const tokenUri = process.env.TOKEN_URI || 'https://api.amazon.com/auth/o2/token';

async function getAdsToken(adsRefreshToken) {
    const resp = await axios.post(tokenUri, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: adsRefreshToken,
        client_id: clientId,
        client_secret: clientSecret,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return resp.data.access_token;
}

function headers(accessToken, profileId, accept) {
    return {
        Authorization: `Bearer ${accessToken}`,
        'Amazon-Advertising-API-ClientId': clientId,
        'Amazon-Advertising-API-Scope': String(profileId),
        Accept: accept,
        'Content-Type': accept,
    };
}

function pass(label) { console.log(`  ✅ ${label}`); }
function fail(label, detail) { console.log(`  ❌ ${label}: ${detail}`); }

async function testCampaigns(accessToken, profileId) {
    console.log('\n── 1. GET CAMPAIGNS (SP v3) ──');
    const url = `${baseUri}/sp/campaigns/list`;
    const accept = 'application/vnd.spCampaign.v3+json';
    try {
        const resp = await axios.post(url, {
            stateFilter: { include: ['ENABLED'] },
            maxResults: 5,
        }, { headers: headers(accessToken, profileId, accept) });

        const data = resp.data;
        if (Array.isArray(data.campaigns)) pass(`Response shape: { campaigns: Array(${data.campaigns.length}) }`);
        else fail('Response shape', `Expected { campaigns: [...] }, got keys: ${Object.keys(data)}`);

        if (data.campaigns && data.campaigns.length > 0) {
            const c = data.campaigns[0];
            const fields = ['campaignId', 'name', 'state', 'targetingType'];
            fields.forEach(f => c[f] != null ? pass(`Field "${f}" present: ${c[f]}`) : fail(`Field "${f}"`, 'missing'));
            if (c.state === 'ENABLED') pass('Enum casing: state=ENABLED (v3 UPPERCASE)');
            else fail('Enum casing', `Expected ENABLED, got "${c.state}"`);
            if (['AUTO', 'MANUAL'].includes(c.targetingType)) pass(`Enum casing: targetingType=${c.targetingType} (v3 UPPERCASE)`);
            else fail('Enum casing', `Expected AUTO/MANUAL, got "${c.targetingType}"`);
            if (c.budget && c.budget.budget != null) pass(`Nested budget.budget: ${c.budget.budget}`);
            else fail('Nested budget', 'budget.budget missing — dailyBudget normalization will be undefined');
        } else {
            console.log('  ⚠️  No campaigns returned — cannot validate fields');
        }
        return data.campaigns || [];
    } catch (err) {
        fail('API call', err.response ? `${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message);
        return [];
    }
}

async function testAdGroups(accessToken, profileId, campaignIds) {
    console.log('\n── 2. GET AD GROUPS (SP v3) ──');
    const url = `${baseUri}/sp/adGroups/list`;
    const accept = 'application/vnd.spAdGroup.v3+json';
    try {
        const body = { maxResults: 5 };
        if (campaignIds.length > 0) body.campaignIdFilter = { include: campaignIds.slice(0, 3).map(String) };

        const resp = await axios.post(url, body, { headers: headers(accessToken, profileId, accept) });
        const data = resp.data;

        if (Array.isArray(data.adGroups)) pass(`Response shape: { adGroups: Array(${data.adGroups.length}) }`);
        else fail('Response shape', `Expected { adGroups: [...] }, got keys: ${Object.keys(data)}`);

        if (data.adGroups && data.adGroups.length > 0) {
            const ag = data.adGroups[0];
            ['adGroupId', 'name', 'campaignId', 'state'].forEach(f =>
                ag[f] != null ? pass(`Field "${f}": ${ag[f]}`) : fail(`Field "${f}"`, 'missing'));
        } else {
            console.log('  ⚠️  No ad groups returned');
        }
        return data.adGroups || [];
    } catch (err) {
        fail('API call', err.response ? `${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message);
        return [];
    }
}

async function testKeywords(accessToken, profileId) {
    console.log('\n── 3. GET KEYWORDS (SP v3) ──');
    const url = `${baseUri}/sp/keywords/list`;
    const accept = 'application/vnd.spKeyword.v3+json';
    try {
        const resp = await axios.post(url, {
            stateFilter: { include: ['ENABLED'] },
            maxResults: 5,
        }, { headers: headers(accessToken, profileId, accept) });
        const data = resp.data;

        if (Array.isArray(data.keywords)) pass(`Response shape: { keywords: Array(${data.keywords.length}) }`);
        else fail('Response shape', `Expected { keywords: [...] }, got keys: ${Object.keys(data)}`);

        if (data.keywords && data.keywords.length > 0) {
            const kw = data.keywords[0];
            ['keywordId', 'keywordText', 'matchType', 'state'].forEach(f =>
                kw[f] != null ? pass(`Field "${f}": ${kw[f]}`) : fail(`Field "${f}"`, 'missing'));
            if (['BROAD', 'EXACT', 'PHRASE'].includes(kw.matchType)) pass(`Enum: matchType=${kw.matchType}`);
            else fail('Enum', `Expected BROAD/EXACT/PHRASE, got "${kw.matchType}"`);
        } else {
            console.log('  ⚠️  No keywords returned');
        }
    } catch (err) {
        fail('API call', err.response ? `${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message);
    }
}

async function testNegativeKeywords(accessToken, profileId, campaignIds) {
    console.log('\n── 4a. GET NEGATIVE KEYWORDS - Ad Group Level (SP v3) ──');
    const url1 = `${baseUri}/sp/negativeKeywords/list`;
    const accept1 = 'application/vnd.spNegativeKeyword.v3+json';
    try {
        const body = { maxResults: 5 };
        if (campaignIds.length > 0) body.campaignIdFilter = { include: campaignIds.slice(0, 3).map(String) };

        const resp = await axios.post(url1, body, { headers: headers(accessToken, profileId, accept1) });
        const data = resp.data;

        if (Array.isArray(data.negativeKeywords)) pass(`Response shape: { negativeKeywords: Array(${data.negativeKeywords.length}) }`);
        else fail('Response shape', `Expected { negativeKeywords: [...] }, got keys: ${Object.keys(data)}`);

        if (data.negativeKeywords && data.negativeKeywords.length > 0) {
            const nk = data.negativeKeywords[0];
            ['keywordId', 'keywordText', 'campaignId', 'matchType'].forEach(f =>
                nk[f] != null ? pass(`Field "${f}": ${nk[f]}`) : fail(`Field "${f}"`, 'missing'));
        } else {
            console.log('  ⚠️  No ad-group-level negative keywords returned');
        }
    } catch (err) {
        fail('API call', err.response ? `${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message);
    }

    console.log('\n── 4b. GET NEGATIVE KEYWORDS - Campaign Level (SP v3) ──');
    const url2 = `${baseUri}/sp/campaignNegativeKeywords/list`;
    const accept2 = 'application/vnd.spCampaignNegativeKeyword.v3+json';
    try {
        const body = { maxResults: 5 };
        if (campaignIds.length > 0) body.campaignIdFilter = { include: campaignIds.slice(0, 3).map(String) };

        const resp = await axios.post(url2, body, { headers: headers(accessToken, profileId, accept2) });
        const data = resp.data;

        if (Array.isArray(data.campaignNegativeKeywords)) pass(`Response shape: { campaignNegativeKeywords: Array(${data.campaignNegativeKeywords.length}) }`);
        else fail('Response shape', `Expected { campaignNegativeKeywords: [...] }, got keys: ${Object.keys(data)}`);
    } catch (err) {
        fail('API call', err.response ? `${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message);
    }
}

async function main() {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);

    const Seller = require('../models/user-auth/sellerCentralModel.js');
    const seller = await Seller.findOne({ User: userId });

    if (!seller || !seller.sellerAccount) {
        console.error('No seller accounts found for user');
        process.exit(1);
    }

    const account = seller.sellerAccount.find(a => a.country === country && a.region === region);
    if (!account) {
        console.error(`No account found for ${country}-${region}`);
        process.exit(1);
    }

    const adsRefreshToken = account.adsRefreshToken;
    const profileId = account.ProfileId;

    if (!adsRefreshToken || !profileId) {
        console.error('Missing adsRefreshToken or profileId on this account');
        process.exit(1);
    }

    console.log(`📡 Testing v3 endpoints for ${country}-${region} (profileId: ${profileId})`);
    console.log(`   Base URI: ${baseUri}`);

    console.log('\n🔑 Getting Ads access token...');
    const accessToken = await getAdsToken(adsRefreshToken);
    pass('Token obtained');

    const campaigns = await testCampaigns(accessToken, profileId);
    const campaignIds = campaigns.map(c => c.campaignId).filter(Boolean);

    const adGroups = await testAdGroups(accessToken, profileId, campaignIds);
    await testKeywords(accessToken, profileId);
    await testNegativeKeywords(accessToken, profileId, campaignIds);

    console.log('\n══════════════════════════════════');
    console.log('   V3 SMOKE TEST COMPLETE');
    console.log('══════════════════════════════════\n');

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});

/**
 * Weekly Sponsored Products targets sync (product targets and auto-campaign targets).
 *
 * Keyword bids and keyword performance are already stored; targets were not, so an
 * ACoS-above-break-even task could only propose keyword bid cuts. This reads, once a
 * week: a 14-day spTargeting report (spend, sales, clicks per target) and the current
 * bid of each target that spent (POST /sp/targets/list, a read). Stored in
 * AdsTargetSnapshot. Nothing here changes anything on Amazon.
 *
 * Runs in the async Ads phase (adsAsync). The phase runs daily; submit() skips
 * (returns no report id, which the engine treats as NO_DATA) while the newest
 * snapshot is under 6 days old, so the report is requested about once a week.
 */
const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../../utils/Logger.js');

const BASE_URIS = {
    NA: 'https://advertising-api.amazon.com',
    EU: 'https://advertising-api-eu.amazon.com',
    FE: 'https://advertising-api-fe.amazon.com'
};
const WINDOW_DAYS = 14;
const REFRESH_AFTER_DAYS = 6;
const MAX_TARGETS = 20000;
const TARGET_MEDIA = 'application/vnd.spTargetingClause.v3+json';
// spTargeting rows for keywords have keywordType BROAD / PHRASE / EXACT; targets have these.
const isTargetRow = (row) => /TARGETING_EXPRESSION/i.test(String(row?.keywordType || ''));

const headers = (accessToken, profileId, media) => ({
    'Authorization': `Bearer ${accessToken}`,
    'Amazon-Advertising-API-Scope': profileId,
    'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
    ...(media ? { 'Content-Type': media, 'Accept': media } : { 'Content-Type': 'application/json' })
});

const dayKey = (d) => d.toISOString().slice(0, 10);
function windowFor(now = new Date()) {
    const end = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
    return { startDate: dayKey(start), endDate: dayKey(end) };
}

async function createTargetingReport(accessToken, profileId, region, { startDate, endDate }) {
    const res = await axios.post(`${BASE_URIS[region]}/reporting/reports`, {
        name: 'SellerQI targets (bid suggestions)',
        startDate,
        endDate,
        configuration: {
            adProduct: 'SPONSORED_PRODUCTS',
            reportTypeId: 'spTargeting',
            timeUnit: 'SUMMARY',
            format: 'GZIP_JSON',
            groupBy: ['targeting'],
            columns: ['keywordId', 'keywordType', 'targeting', 'campaignId', 'adGroupId', 'clicks', 'cost', 'sales7d']
        }
    }, { headers: headers(accessToken, profileId, 'application/vnd.createasyncreportrequest.v3+json') });
    return res.data?.reportId || null;
}

async function checkStatusOnce(reportId, accessToken, profileId, region) {
    const res = await axios.get(`${BASE_URIS[region]}/reporting/reports/${reportId}`, { headers: headers(accessToken, profileId) });
    const status = res.data?.status;
    if (status === 'COMPLETED') return { ready: true, handle: { location: res.data.url } };
    if (status === 'FAILED') return { failed: true, note: 'report generation failed' };
    return 'PROCESSING';
}

/**
 * Current bids of the given targets (a read). Amazon pages the answer.
 * @returns {Promise<Map<string, {bid: number|null, state: string}>>}
 */
async function listTargetBids(accessToken, profileId, region, targetIds) {
    const out = new Map();
    for (let i = 0; i < targetIds.length; i += 1000) {
        let nextToken = null;
        do {
            const body = { targetIdFilter: { include: targetIds.slice(i, i + 1000) }, maxResults: 1000, ...(nextToken ? { nextToken } : {}) };
            const res = await axios.post(`${BASE_URIS[region]}/sp/targets/list`, body, { headers: headers(accessToken, profileId, TARGET_MEDIA) });
            for (const t of res.data?.targetingClauses || []) {
                out.set(String(t.targetId), { bid: t.bid === null || t.bid === undefined ? null : Number(t.bid), state: String(t.state || '') });
            }
            nextToken = res.data?.nextToken || null;
        } while (nextToken);
    }
    return out;
}

/**
 * Change target bids (v3 PUT /sp/targets). Used only after the seller approved the
 * change (TaskActionService 'lower_bids').
 */
async function updateTargetBids({ bids, accessToken, profileId, region }) {
    if (!Array.isArray(bids) || bids.length === 0) throw new Error('No target bids to update.');
    const body = { targetingClauses: bids.map(b => ({ targetId: String(b.targetId), bid: Number(b.bid) })) };
    const res = await axios.put(`${BASE_URIS[region]}/sp/targets`, body, { headers: headers(accessToken, profileId, TARGET_MEDIA) });
    return res.data;
}

const CAMPAIGN_MEDIA = 'application/vnd.spCampaign.v3+json';

/** Enabled campaigns with their daily budget (a read). Optionally only these ids. */
async function listCampaignBudgets(accessToken, profileId, region, campaignIds = null) {
    const out = [];
    let nextToken = null;
    let pages = 0;
    do {
        const body = { maxResults: 1000, stateFilter: { include: ['ENABLED'] }, ...(campaignIds ? { campaignIdFilter: { include: campaignIds.map(String) } } : {}), ...(nextToken ? { nextToken } : {}) };
        const res = await axios.post(`${BASE_URIS[region]}/sp/campaigns/list`, body, { headers: headers(accessToken, profileId, CAMPAIGN_MEDIA) });
        for (const c of res.data?.campaigns || []) {
            out.push({ campaignId: String(c.campaignId), name: c.name || '', budget: Number(c.budget?.budget) || null, budgetType: c.budget?.budgetType || '' });
        }
        nextToken = res.data?.nextToken || null;
        pages++;
    } while (nextToken && pages < 50);
    return out;
}

/** Amazon's budget recommendations (7-day time in budget, missed sales), 100 campaigns per call. */
async function readBudgetRecommendations(accessToken, profileId, region, campaigns) {
    const out = [];
    for (let i = 0; i < campaigns.length; i += 100) {
        const slice = campaigns.slice(i, i + 100);
        const res = await axios.post(`${BASE_URIS[region]}/sp/campaigns/budgetRecommendations`, { campaignIds: slice.map(c => c.campaignId) },
            { headers: headers(accessToken, profileId, 'application/vnd.budgetrecommendation.v3+json') });
        const byId = new Map(slice.map(c => [c.campaignId, c]));
        for (const r of res.data?.budgetRecommendationsSuccessResults || []) {
            const c = byId.get(String(r.campaignId)) || {};
            const m = r.sevenDaysMissedOpportunities || {};
            out.push({
                campaignId: String(r.campaignId), name: c.name || '', budget: c.budget, budgetType: c.budgetType,
                suggestedBudget: Number(r.suggestedBudget) || null,
                percentTimeInBudget: Number.isFinite(Number(m.percentTimeInBudget)) ? Number(m.percentTimeInBudget) : null,
                missedSalesLower: Number(m.estimatedMissedSalesLower) || 0,
                missedSalesUpper: Number(m.estimatedMissedSalesUpper) || 0,
                startDate: m.startDate || '', endDate: m.endDate || ''
            });
        }
    }
    return out;
}

/** Set a campaign's daily budget (v3 PUT /sp/campaigns). Only after the seller approved it. */
async function updateCampaignBudget({ campaignId, budget, accessToken, profileId, region }) {
    const body = { campaigns: [{ campaignId: String(campaignId), budget: { budget: Number(budget), budgetType: 'DAILY' } }] };
    const res = await axios.put(`${BASE_URIS[region]}/sp/campaigns`, body, { headers: headers(accessToken, profileId, CAMPAIGN_MEDIA) });
    return res.data;
}

/** Pure: report rows -> targets that spent, one per target id. Exported for tests. */
function targetsFromReport(rows = []) {
    const byId = new Map();
    for (const row of rows || []) {
        if (!isTargetRow(row) || !row.keywordId) continue;
        const id = String(row.keywordId);
        const t = byId.get(id) || {
            targetId: id, campaignId: String(row.campaignId || ''), adGroupId: String(row.adGroupId || ''),
            expression: String(row.targeting || ''), keywordType: String(row.keywordType || ''), cost: 0, sales: 0, clicks: 0
        };
        t.cost += Number(row.cost) || 0;
        t.sales += Number(row.sales7d) || 0;
        t.clicks += Number(row.clicks) || 0;
        byId.set(id, t);
    }
    return [...byId.values()].filter(t => t.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, MAX_TARGETS);
}

function buildSpecs({ userId, country, region, accessToken, profileId, marketplaceId = '' }) {
    const window = windowFor();
    return [{
        service: 'adsTargetsData',
        paramsKey: 'default',
        params: window,
        marketplaceId,
        submit: async () => {
            const AdsTargetSnapshot = require('../../models/amazon-ads/AdsTargetSnapshotModel.js');
            const newest = await AdsTargetSnapshot.findOne({ userId, country, region }).sort({ createdAt: -1 }).select('createdAt').lean();
            if (newest && Date.now() - new Date(newest.createdAt).getTime() < REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000) {
                return null; // this week's targets are already stored
            }
            return createTargetingReport(accessToken, profileId, region, window);
        },
        checkStatusOnce: (reportId) => checkStatusOnce(reportId, accessToken, profileId, region),
        finalize: async (handle) => {
            const { downloadReportData } = require('./GetWastedSpendKeywords.js');
            const content = await downloadReportData(handle.location, accessToken, profileId, null);
            const rows = Array.isArray(content) ? content : (content?.data || content?.rows || []);
            const targets = targetsFromReport(rows);
            const bids = targets.length ? await listTargetBids(accessToken, profileId, region, targets.map(t => t.targetId)) : new Map();
            for (const t of targets) t.bid = bids.get(t.targetId)?.bid ?? null;
            // Budget recommendations ride along weekly; a failure leaves them null.
            let budgetRecs = null;
            try {
                const campaigns = (await listCampaignBudgets(accessToken, profileId, region)).filter(c => c.budgetType === 'DAILY');
                budgetRecs = campaigns.length ? await readBudgetRecommendations(accessToken, profileId, region, campaigns) : [];
            } catch (error) {
                logger.warn('[AdsTargets] budget recommendations unavailable', { userId: String(userId), country, region, error: error.message });
            }
            const AdsTargetSnapshot = require('../../models/amazon-ads/AdsTargetSnapshotModel.js');
            const uid = mongoose.Types.ObjectId.isValid(String(userId)) ? new mongoose.Types.ObjectId(String(userId)) : userId;
            await AdsTargetSnapshot.create({ userId: uid, country, region, windowStart: window.startDate, windowEnd: window.endDate, targets, targetCount: targets.length, budgetRecs });
            logger.info('[AdsTargets] stored', { userId: String(userId), country, region, targets: targets.length, withBid: targets.filter(t => t.bid !== null).length });
            return { empty: targets.length === 0 };
        }
    }];
}

module.exports = {
    WINDOW_DAYS,
    targetsFromReport,
    listTargetBids,
    updateTargetBids,
    listCampaignBudgets,
    readBudgetRecommendations,
    updateCampaignBudget,
    adsAsync: {
        serviceName: 'adsTargetsData',
        buildSpecs,
        saveFromRows: async () => ({ documentsSaved: 0 }) // finalize already saves
    }
};

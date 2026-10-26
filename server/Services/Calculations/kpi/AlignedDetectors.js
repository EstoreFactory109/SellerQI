/**
 * tasks-logics.xlsx rules that replace an older check rather than add a new one,
 * so they run for every account without a wave flag (see kpi/index.js).
 *
 * Pure functions: no DB, no network.
 */

const { rowDay, shiftDay, newestRowDay, isAdsDataStale } = require('../AdsSignals.js');
const { TARGET_ACOS_PERCENT } = require('../TaskRules.js');

const PENDING = 'pending';

// Spreadsheet "ACoS": 14 days; spend over the greater of $30 or 2x price; 20+ clicks.
const PRODUCT_ACOS_DAYS = 14;
const PRODUCT_ACOS_MIN_SPEND = 30;
const PRODUCT_ACOS_PRICE_MULTIPLE = 2;
const PRODUCT_ACOS_MIN_CLICKS = 20;

// Bid cuts proposed with the task (applied only after the seller approves them).
// Internal guardrails: judge keywords with 10+ clicks, cut at most 30% per change,
// never below Amazon's minimum Sponsored Products bid, at most 20 keywords per task.
const BID_CUT_MIN_CLICKS = 10;
const BID_CUT_MAX_SHARE = 0.30;
const BID_CUT_MAX_KEYWORDS = 20;
const MIN_BID_BY_COUNTRY = { JP: 2, IN: 1 };
const minBidFor = (country) => MIN_BID_BY_COUNTRY[String(country || '').toUpperCase()] ?? 0.02;

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Break-even ACoS per ASIN = margin before ad spend, from the 30-day profitability
 * rows: (sales - Amazon fees - COGS x units) / sales. Without COGS the spreadsheet
 * says to use the client's target ACoS; there is no per-client target yet, so it is
 * the account-wide TARGET_ACOS_PERCENT.
 * @returns {Map<string, {pct: number, fromCogs: boolean}>}
 */
function breakEvenAcosByAsin(profitRows = [], cogsMap = {}) {
    const out = new Map();
    for (const row of profitRows) {
        const asin = row?.asin;
        const sales = Number(row?.sales) || 0;
        if (!asin || sales <= 0) continue;
        const unitCost = Number(cogsMap?.[asin]) || 0;
        if (unitCost <= 0) continue;
        const fees = Number(row.amzFee) || Number(row.totalFees) || 0;
        const units = Number(row.quantity) || 0;
        out.set(asin, { pct: ((sales - fees - unitCost * units) / sales) * 100, fromCogs: true });
    }
    return out;
}

/**
 * Keyword bid cuts for one ASIN: keywords in the ad groups that advertise it, over
 * the same 14 ads days, whose own ACoS is above the product's break-even (or that
 * spent with no sales). New bid = current x break-even / keyword ACoS, cut at most
 * 30%. Keywords without a stored bid use the ad group's default and are skipped.
 *
 * @returns {Array<{keywordId, keyword, campaignId, adGroupId, currentBid, newBid, acos, spend, clicks, sharedAdGroup}>}
 */
function proposeBidCuts({ asin, bePct, adGroupsByAsin = [], keywordRows = [], keywordSnapshot = [], country, from }) {
    const groupsOfAsin = new Set();
    const asinsPerGroup = new Map();
    for (const r of adGroupsByAsin || []) {
        if (!r?.adGroupId) continue;
        const g = String(r.adGroupId);
        if (!asinsPerGroup.has(g)) asinsPerGroup.set(g, new Set());
        asinsPerGroup.get(g).add(r.asin);
        if (r.asin === asin) groupsOfAsin.add(g);
    }
    if (groupsOfAsin.size === 0) return [];

    const bidOf = new Map();
    for (const k of keywordSnapshot || []) {
        if (k?.keywordId && Number(k.bid) > 0 && String(k.state || '').toLowerCase() === 'enabled') {
            bidOf.set(String(k.keywordId), { bid: Number(k.bid), text: k.keywordText, campaignId: k.campaignId, adGroupId: String(k.adGroupId) });
        }
    }

    const perKeyword = new Map();
    for (const row of keywordRows || []) {
        const id = row?.keywordId ? String(row.keywordId) : '';
        const day = rowDay(row);
        if (!id || !day || day < from || !groupsOfAsin.has(String(row.adGroupId))) continue;
        const k = perKeyword.get(id) || { spend: 0, sales: 0, clicks: 0, keyword: row.keyword };
        k.spend += Number(row.cost) || 0;
        k.sales += Number(row.attributedSales30d) || 0;
        k.clicks += Number(row.clicks) || 0;
        perKeyword.set(id, k);
    }

    const minBid = minBidFor(country);
    const cuts = [];
    for (const [keywordId, k] of perKeyword) {
        const stored = bidOf.get(keywordId);
        if (!stored || k.clicks < BID_CUT_MIN_CLICKS || k.spend <= 0) continue;
        const acos = k.sales > 0 ? (k.spend / k.sales) * 100 : Infinity;
        if (acos <= bePct) continue;
        const factor = Number.isFinite(acos) && bePct > 0 ? bePct / acos : 0;
        const newBid = round2(Math.max(minBid, stored.bid * Math.max(factor, 1 - BID_CUT_MAX_SHARE)));
        if (newBid >= stored.bid - 0.005) continue;
        cuts.push({
            keywordId,
            keyword: stored.text || k.keyword || keywordId,
            campaignId: stored.campaignId ? String(stored.campaignId) : undefined,
            adGroupId: stored.adGroupId,
            currentBid: stored.bid,
            newBid,
            acos: Number.isFinite(acos) ? round1(acos) : null,
            spend: round2(k.spend),
            clicks: k.clicks,
            sharedAdGroup: (asinsPerGroup.get(stored.adGroupId)?.size || 1) > 1
        });
    }
    return cuts.sort((a, b) => b.spend - a.spend).slice(0, BID_CUT_MAX_KEYWORDS);
}

/**
 * Product ACoS above break-even over the last 14 ads days.
 *
 * @param {Object} params
 * @param {Array} params.adsRows - ProductWiseSponsoredAds rows (asin, date, spend, sales, clicks)
 * @param {Array} params.profitRows - 30-day profitability rows (asin, sales, amzFee, quantity)
 * @param {Object} params.cogsMap - per-unit COGS by ASIN
 * @param {Map} params.productsByAsin - catalogue rows (price, name)
 */
function detectProductAcos({ adsRows, profitRows = [], cogsMap = {}, country, productsByAsin = new Map(), now, adGroupsByAsin = null, keywordRows = [], keywordSnapshot = [] }) {
    const newestDay = newestRowDay(adsRows || []);
    if (!Array.isArray(adsRows) || adsRows.length === 0 || isAdsDataStale(newestDay, country, now)) {
        return { tasks: [], covered: false };
    }

    const from = shiftDay(newestDay, -(PRODUCT_ACOS_DAYS - 1));
    const byAsin = new Map();
    for (const row of adsRows) {
        const asin = row?.asin;
        const day = rowDay(row);
        if (!asin || !day || day < from) continue;
        const a = byAsin.get(asin) || { spend: 0, sales: 0, clicks: 0 };
        a.spend += Number(row.spend) || 0;
        a.sales += Number(row.sales) || 0;
        a.clicks += Number(row.clicks) || 0;
        byAsin.set(asin, a);
    }

    const breakEven = breakEvenAcosByAsin(profitRows, cogsMap);
    const tasks = [];
    for (const [asin, a] of byAsin) {
        const product = productsByAsin.get(asin);
        const price = Number(product?.price) || 0;
        const minSpend = Math.max(PRODUCT_ACOS_MIN_SPEND, PRODUCT_ACOS_PRICE_MULTIPLE * price);
        if (a.spend <= minSpend || a.clicks < PRODUCT_ACOS_MIN_CLICKS) continue;

        const be = breakEven.get(asin) || { pct: TARGET_ACOS_PERCENT, fromCogs: false };
        // No sales at all is ACoS without end; any spend is above break-even.
        const acos = a.sales > 0 ? (a.spend / a.sales) * 100 : Infinity;
        if (acos <= be.pct) continue;

        const bePct = round1(Math.max(0, be.pct));
        const bidChanges = Array.isArray(adGroupsByAsin)
            ? proposeBidCuts({ asin, bePct: Math.max(0, be.pct), adGroupsByAsin, keywordRows, keywordSnapshot, country, from })
            : [];
        const acosText = Number.isFinite(acos) ? `${round1(acos)}%` : 'all';
        const beText = be.fromCogs ? `your break-even of ${bePct}%` : `your target of ${bePct}% (add your cost of goods for a true break-even)`;
        tasks.push({
            asin,
            productName: product?.itemName || product?.title || asin,
            errorCategory: 'sponsoredAds',
            errorType: 'product_acos_above_breakeven',
            error: `PPC | ACoS Above Break-Even: Ads for this product cost ${acosText} of the sales they bring, above ${beText}, over the last ${PRODUCT_ACOS_DAYS} days ($${round2(a.spend)} spent, $${round2(a.sales)} in ad sales, ${a.clicks} clicks).`,
            solution: 'Lower bids or pause the targets that are not profitable.',
            // Spend above what break-even would allow on these sales.
            amount: round2(Math.max(0, a.spend - a.sales * Math.max(0, be.pct) / 100)),
            amountIsEstimated: false,
            renderData: {
                acos: Number.isFinite(acos) ? round1(acos) : null,
                breakEvenAcos: bePct,
                breakEvenFromCogs: be.fromCogs,
                spend: round2(a.spend),
                sales: round2(a.sales),
                clicks: a.clicks,
                days: PRODUCT_ACOS_DAYS,
                newestAdsDay: newestDay,
                // Proposed keyword bid cuts; sent to Amazon only after the seller approves
                // them on the Tasks page (TaskActionService 'lower_bids').
                ...(bidChanges.length ? { bidChanges } : {})
            },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

module.exports = {
    PRODUCT_ACOS_DAYS,
    PRODUCT_ACOS_MIN_SPEND,
    PRODUCT_ACOS_PRICE_MULTIPLE,
    PRODUCT_ACOS_MIN_CLICKS,
    BID_CUT_MIN_CLICKS,
    BID_CUT_MAX_SHARE,
    breakEvenAcosByAsin,
    proposeBidCuts,
    detectProductAcos
};

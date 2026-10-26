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
 * Product ACoS above break-even over the last 14 ads days.
 *
 * @param {Object} params
 * @param {Array} params.adsRows - ProductWiseSponsoredAds rows (asin, date, spend, sales, clicks)
 * @param {Array} params.profitRows - 30-day profitability rows (asin, sales, amzFee, quantity)
 * @param {Object} params.cogsMap - per-unit COGS by ASIN
 * @param {Map} params.productsByAsin - catalogue rows (price, name)
 */
function detectProductAcos({ adsRows, profitRows = [], cogsMap = {}, country, productsByAsin = new Map(), now }) {
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
                newestAdsDay: newestDay
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
    breakEvenAcosByAsin,
    detectProductAcos
};

/**
 * AdsSignals — the rules for the keyword / search-term ad tasks, shared by the task
 * check (DashboardCalculation.calculateSponsoredAdsErrors) and the PPC page
 * (PPCCampaignAnalysisService), so a task and the page it points to always agree.
 *
 * Pure: no DB, no clock except what callers pass.
 */

const {
    KEYWORD_MIN_CLICKS,
    ATTRIBUTION_SETTLE_DAYS,
    ADS_DATA_MAX_AGE_DAYS,
} = require('./TaskRules.js');
const { marketplaceYesterdayStr } = require('../../utils/marketplaceTimezone.js');

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' of a row's day, or null. */
const rowDay = (row) => {
    const d = row?.date ?? row?.metricDate;
    if (!d) return null;
    const s = d instanceof Date ? d.toISOString() : String(d);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** 'YYYY-MM-DD' shifted by n days (UTC arithmetic on a date key). */
const shiftDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The newest day any row carries, or null when none is dated. */
function newestRowDay(rows = []) {
    let newest = null;
    for (const r of rows || []) {
        const d = rowDay(r);
        if (d && (!newest || d > newest)) newest = d;
    }
    return newest;
}

/**
 * Spend on days strictly before the returned key is "settled": its 7-day attribution
 * window has closed, so a missing sale is a real missing sale. Anchored on TODAY (the
 * marketplace's yesterday, the newest day Amazon reports), not on the newest stored
 * day — attribution is about time since the click, and an account whose rows all sit
 * on one old day is fully settled, not fully "recent".
 */
const settleCutoffDay = (country, now = new Date(), days = ATTRIBUTION_SETTLE_DAYS) =>
    shiftDay(marketplaceYesterdayStr(country, now), -(days - 1));

/**
 * True when the ads rows cannot describe the account now: undated (legacy docs) or
 * newest day older than ADS_DATA_MAX_AGE_DAYS before the marketplace's yesterday.
 */
function isAdsDataStale(newestDay, country, now = new Date(), maxAgeDays = ADS_DATA_MAX_AGE_DAYS) {
    if (!newestDay) return true;
    const yesterday = marketplaceYesterdayStr(country, now);
    return newestDay < shiftDay(yesterday, -maxAgeDays);
}

/**
 * The wasted-spend rule. A keyword is wasted when, over the window:
 *  - it is still ENABLED (its latest status) — a paused keyword's old spend is not
 *    something to act on, and the PPC page never listed it (498 keywords, $4,850);
 *  - it has at least KEYWORD_MIN_CLICKS clicks;
 *  - some of its spend is settled (older than the attribution window), so the
 *    "no sales" verdict is not just sales that have not been credited yet;
 *  - it has no sales.
 * @param {{ clicks, sales, settledSpend, status }} k
 */
function isWastedKeyword(k) {
    return !!k
        && k.status === 'ENABLED'
        && (Number(k.clicks) || 0) >= KEYWORD_MIN_CLICKS
        && (Number(k.settledSpend) || 0) > 0
        && (Number(k.sales) || 0) < 0.01;
}

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * Enabled negative keywords as a lookup: `${campaignId}|${adGroupId}|${text}`, with
 * campaign-level negatives stored under an empty ad group.
 */
function buildNegatedIndex(negatives = []) {
    const index = new Set();
    for (const n of negatives || []) {
        if (!n || !n.keywordText || !n.campaignId) continue;
        if (n.state && norm(n.state) !== 'enabled') continue;
        index.add(`${n.campaignId}|${n.adGroupId || ''}|${norm(n.keywordText)}`);
    }
    return index;
}

/**
 * Whether a search term is already a negative in its campaign (ad-group level or
 * campaign level). Once the seller follows the task's advice the term stops being a
 * problem, even though its past clicks stay in the 30-day window.
 */
function isNegated(index, { searchTerm, campaignId, adGroupId }) {
    if (!index || index.size === 0 || !searchTerm || !campaignId) return false;
    const text = norm(searchTerm);
    return index.has(`${campaignId}|${adGroupId || ''}|${text}`) || index.has(`${campaignId}||${text}`);
}

/** Product-page matches report the ASIN as the search term: they need product targeting, not keywords. */
const isAsinSearchTerm = (term) => /^b0[0-9a-z]{8}$/i.test(String(term || '').trim());

module.exports = {
    rowDay,
    shiftDay,
    newestRowDay,
    settleCutoffDay,
    isAdsDataStale,
    isWastedKeyword,
    buildNegatedIndex,
    isNegated,
    isAsinSearchTerm,
};

/**
 * AdsProductAttributionService
 *
 * Attributes sponsored-ads waste back to the products it was spent advertising.
 *
 * Why this is needed: keyword- and search-term-level ad issues have no ASIN
 * anywhere in Amazon's data — a wasted keyword belongs to a campaign, not to a
 * product. On a real account that leaves 32% of all recoverable money
 * unattributable to any product, which would gut a product-level view.
 *
 * The only available bridge is ProductWiseSponsoredAdsItem, which records ad
 * spend per (campaign, ASIN). So a campaign's wasted spend is divided across the
 * ASINs that campaign advertises, in proportion to each ASIN's own ad spend.
 *
 * This is INFERENCE, not measurement, and is always reported as such:
 *   - a campaign can advertise several ASINs (2.05 on average in real data), so
 *     most splits are genuinely uncertain
 *   - even a single-ASIN campaign is an inference: a keyword can be irrelevant
 *     to the product it was advertising, which is often exactly why it wasted money
 * Every attributed amount is therefore flagged estimated, so the UI renders it
 * with the same "*" caveat used for other inferred figures.
 *
 * Money is never invented or lost: each task's amount is either split across
 * ASINs summing back to that amount, or left unattributed. Both are reported.
 */

const mongoose = require('mongoose');
const logger = require('../../utils/Logger.js');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// $match in an aggregation gets no automatic schema casting, unlike find().
const toObjectId = (id) =>
    (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id))
        ? new mongoose.Types.ObjectId(id)
        : id;

/**
 * Build the campaign → ASIN spend index used to split waste.
 *
 * Keyed by campaignId (stable) AND campaignName (fallback for tasks written
 * before campaignId was carried on the task).
 *
 * @param {Array} items - ProductWiseSponsoredAdsItem rows
 * @returns {{byId: Map<string, Map<string, number>>, byName: Map<string, Map<string, number>>, asinNames: Map<string,string>}}
 */
function buildCampaignAsinIndex(items) {
    const byId = new Map();
    const byName = new Map();

    for (const row of Array.isArray(items) ? items : []) {
        if (!row || !row.asin) continue;
        const spend = Number(row.spend) || 0;

        const add = (map, key) => {
            if (!key) return;
            const k = String(key);
            if (!map.has(k)) map.set(k, new Map());
            const asins = map.get(k);
            asins.set(row.asin, (asins.get(row.asin) || 0) + spend);
        };

        add(byId, row.campaignId);
        add(byName, row.campaignName);
    }

    return { byId, byName };
}

/**
 * Split one amount across a campaign's ASINs, weighted by each ASIN's ad spend.
 * Falls back to an equal split when the campaign has no recorded spend, so a
 * zero-spend campaign still attributes rather than silently vanishing.
 *
 * @param {number} amount
 * @param {Map<string, number>} asinSpend
 * @returns {Array<{asin: string, amount: number}>}
 */
function splitAcrossAsins(amount, asinSpend) {
    const entries = [...asinSpend.entries()];
    if (entries.length === 0) return [];
    if (entries.length === 1) return [{ asin: entries[0][0], amount: round2(amount) }];

    const totalSpend = entries.reduce((s, [, v]) => s + v, 0);

    const shares = totalSpend > 0
        ? entries.map(([asin, spend]) => ({ asin, amount: amount * (spend / totalSpend) }))
        : entries.map(([asin]) => ({ asin, amount: amount / entries.length }));

    // Round, then push any rounding residue onto the largest share so the parts
    // always sum back to the original amount — no money invented or lost.
    const rounded = shares.map(s => ({ asin: s.asin, amount: round2(s.amount) }));
    const residue = round2(amount - rounded.reduce((s, r) => s + r.amount, 0));
    if (residue !== 0) {
        const biggest = rounded.reduce((a, b) => (b.amount > a.amount ? b : a), rounded[0]);
        biggest.amount = round2(biggest.amount + residue);
    }

    return rounded.filter(r => r.amount !== 0 || rounded.length === 1);
}

/**
 * Attribute a set of sponsored-ads tasks to ASINs.
 *
 * Pure function — the unit-testable core. Pass the campaign index separately so
 * this needs no DB access.
 *
 * @param {Array} adsTasks - tasks with errorCategory 'sponsoredAds'
 * @param {Object} index - from buildCampaignAsinIndex
 * @returns {{byAsin: Map<string, {amount: number, taskCount: number}>, attributedAmount: number, unattributedAmount: number, attributedTasks: number, unattributedTasks: number, splitTasks: number}}
 */
function attributeAdsTasksToAsins(adsTasks, index) {
    const byAsin = new Map();
    let attributedAmount = 0;
    let unattributedAmount = 0;
    let attributedTasks = 0;
    let unattributedTasks = 0;
    let splitTasks = 0;

    for (const task of Array.isArray(adsTasks) ? adsTasks : []) {
        const amount = Number(task?.amount) || 0;
        const rd = task?.renderData || {};

        const asinSpend =
            (rd.campaignId && index.byId.get(String(rd.campaignId))) ||
            (rd.campaignName && index.byName.get(String(rd.campaignName))) ||
            null;

        if (!asinSpend || asinSpend.size === 0) {
            unattributedTasks++;
            unattributedAmount += amount;
            continue;
        }

        if (asinSpend.size > 1) splitTasks++;

        for (const part of splitAcrossAsins(amount, asinSpend)) {
            const entry = byAsin.get(part.asin) || { amount: 0, taskCount: 0 };
            entry.amount = round2(entry.amount + part.amount);
            entry.taskCount += 1;
            byAsin.set(part.asin, entry);
        }

        attributedTasks++;
        attributedAmount += amount;
    }

    return {
        byAsin,
        attributedAmount: round2(attributedAmount),
        unattributedAmount: round2(unattributedAmount),
        attributedTasks,
        unattributedTasks,
        splitTasks
    };
}

/**
 * Load the campaign→ASIN index for an account.
 *
 * Collapses the rows in MongoDB rather than in Node. These rows are per
 * (campaign, ASIN, DAY, ad type), so a large account holds enormous numbers of
 * them — one real account has 153,305, which took 19.3s and 21.7MB to pull down
 * in full. Grouping server-side returns one row per (campaign, ASIN) instead:
 * 9,755 rows, 1.2MB, 1.7s for that same account.
 *
 * The daily granularity is irrelevant here — all we need is each ASIN's share of
 * a campaign's spend, so summing across dates loses nothing.
 *
 * @param {string} userId
 * @param {string} country
 * @param {string} region
 */
async function loadCampaignAsinIndex(userId, country, region) {
    const startTime = Date.now();

    const grouped = await ProductWiseSponsoredAdsItem.aggregate([
        { $match: { userId: toObjectId(userId), country, region } },
        {
            $group: {
                _id: { campaignId: '$campaignId', campaignName: '$campaignName', asin: '$asin' },
                spend: { $sum: '$spend' }
            }
        }
    ]);

    // Flatten to the same shape buildCampaignAsinIndex takes from raw rows, so the
    // pure indexing logic stays independent of how the data was fetched.
    const items = grouped.map(g => ({
        campaignId: g._id.campaignId,
        campaignName: g._id.campaignName,
        asin: g._id.asin,
        spend: g.spend
    }));

    const index = buildCampaignAsinIndex(items);

    logger.info('[AdsProductAttribution] Built campaign->ASIN index', {
        userId,
        country,
        region,
        campaignAsinPairs: items.length,
        campaignsById: index.byId.size,
        campaignsByName: index.byName.size,
        duration: Date.now() - startTime
    });

    return index;
}

module.exports = {
    loadCampaignAsinIndex,
    buildCampaignAsinIndex,
    attributeAdsTasksToAsins,
    splitAcrossAsins
};

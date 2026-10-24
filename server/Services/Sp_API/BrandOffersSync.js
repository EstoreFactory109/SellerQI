/**
 * Weekly check of who offers on the seller's own brand listings, for the
 * tasks-logics.xlsx "New seller on brand listing" task.
 *
 * WHICH ASINS
 * Active catalogue listings whose brand (stored weekly by the listing-items sync)
 * matches the account's brand, ranked by the last 30 days' revenue, top 200 —
 * the cap getCompetitiveOffers already enforces (10 batches of 20 at one call per
 * 11s, about two minutes). A wholesale or resale listing is left out: other
 * sellers on those are normal, and would bury the real warnings.
 *
 * The offers fetch is getCompetitiveOffers with persist:false; the result is
 * reduced to other sellers' IDs per ASIN and stored in BrandOfferSnapshot.
 *
 * Same positional signature as the other report services, so the scheduler and
 * tokenManager can call it.
 */

const logger = require('../../utils/Logger.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const BrandOfferSnapshot = require('../../models/products/BrandOfferSnapshotModel.js');
const { getCompetitiveOffers, MAX_ASINS_PER_BATCH } = require('./GET_COMPETITIVE_OFFERS.js');
const { getAsinFinanceForWindow } = require('../Finance/AsinFinanceWindowService.js');

const MAX_BRAND_ASINS = 200;

/**
 * Brand names compared loosely: case, accents, spacing and punctuation differ between
 * sources ("Könighaus" on the account, "KONIGHAUS" on a listing).
 */
const normaliseBrand = (value) => String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Pure: which ASINs to check. Exported for tests.
 * @param {Array} products - catalogue rows (asin, status, brand)
 * @param {string} accountBrand
 * @param {Object} salesByAsin - { [asin]: { sales } }
 */
function selectBrandAsins(products, accountBrand, salesByAsin = {}) {
    const brand = normaliseBrand(accountBrand);
    if (!brand || brand === 'brandname') return []; // the schema's placeholder, not a brand
    const asins = new Set();
    for (const p of products || []) {
        if (p?.asin && p.status === 'Active' && normaliseBrand(p.brand) === brand) asins.add(p.asin);
    }
    return [...asins]
        .sort((a, b) => (Number(salesByAsin[b]?.sales) || 0) - (Number(salesByAsin[a]?.sales) || 0))
        .slice(0, MAX_BRAND_ASINS);
}

/** Pure: a getCompetitiveOffers result -> what is stored. Exported for tests. */
function toSnapshotItems(items = []) {
    return (items || []).map((item) => {
        const others = (item.offers || []).filter((o) => !o.isOurs);
        return {
            asin: item.asin,
            sellerIds: [...new Set(others.map((o) => String(o.sellerId || '')).filter(Boolean))],
            offerCount: others.length,
            error: item.error || ''
        };
    });
}

const syncBrandOffers = async (accessToken, marketplaceIds, userId, baseUri, country, region) => {
    try {
        const seller = await Seller.findOne({ User: userId }).select('brand sellerAccount').lean();
        const account = (seller?.sellerAccount || []).find((acc) => acc.region === region && acc.country === country);
        if (!account) return false;

        const end = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
        const salesByAsin = await getAsinFinanceForWindow(userId, country, region, start, end);
        const asins = selectBrandAsins(account.products, seller.brand, salesByAsin);

        const storedId = String(account.selling_partner_id || '');
        const ourSellerId = /^[0-9a-f-]{36}$/i.test(storedId) ? '' : storedId;

        const fetched = asins.length
            ? await getCompetitiveOffers(accessToken, marketplaceIds, userId, baseUri, country, region, { asins, ourSellerId, persist: false })
            : { items: [], sellerIdsReturned: false };
        if (!fetched) return false;

        const doc = await BrandOfferSnapshot.create({
            User: userId,
            region,
            country,
            brand: seller.brand || '',
            items: toSnapshotItems(fetched.items),
            asinsRequested: asins.length,
            sellerIdsReturned: !!fetched.sellerIdsReturned
        });
        logger.info(`[BrandOffers] checked ${asins.length} brand ASIN(s)`, { userId, country, region, batches: Math.ceil(asins.length / MAX_ASINS_PER_BATCH) });
        return doc;
    } catch (error) {
        logger.error(`[BrandOffers] sync failed: ${error.message}`, { userId, country, region });
        return false;
    }
};

module.exports = syncBrandOffers;
module.exports.selectBrandAsins = selectBrandAsins;
module.exports.toSnapshotItems = toSnapshotItems;
module.exports.normaliseBrand = normaliseBrand;
module.exports.MAX_BRAND_ASINS = MAX_BRAND_ASINS;

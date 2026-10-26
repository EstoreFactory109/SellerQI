/**
 * Detects changes to a seller's listings between syncs and records them
 * (ListingChangeEvent) for the "Detail page changed without us" task.
 *
 * Pure diff functions plus one writer. A write failure never stops the sync that
 * called it: the events are a side record.
 */
const crypto = require('crypto');
const logger = require('../../utils/Logger.js');

const normText = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const toPrice = (v) => {
    const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** Short, stable fingerprint of a listing's bullet points. */
function hashBullets(bullets) {
    const list = (Array.isArray(bullets) ? bullets : []).map(normText).filter(Boolean);
    if (list.length === 0) return null;
    return crypto.createHash('sha1').update(list.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Daily: title and price differences between the stored rows and the new listings report.
 * Matched by asin|sku; new or removed listings are not changes.
 */
function diffDailyListings(existing = [], incoming = []) {
    const prev = new Map();
    for (const p of existing || []) if (p?.asin) prev.set(`${p.asin}|${p.sku || ''}`, p);
    const events = [];
    for (const row of incoming || []) {
        const old = row?.asin ? prev.get(`${row.asin}|${row.sku || ''}`) : null;
        if (!old) continue;
        const oldTitle = normText(old.itemName);
        const newTitle = normText(row.itemName);
        if (oldTitle && newTitle && oldTitle !== newTitle) {
            events.push({ asin: row.asin, sku: row.sku || '', field: 'title', oldValue: oldTitle, newValue: newTitle, source: 'merchant_listings' });
        }
        const oldPrice = toPrice(old.price);
        const newPrice = toPrice(row.price);
        if (oldPrice !== null && newPrice !== null && oldPrice !== newPrice) {
            events.push({ asin: row.asin, sku: row.sku || '', field: 'price', oldValue: oldPrice, newValue: newPrice, source: 'merchant_listings' });
        }
    }
    return events;
}

/**
 * Weekly: bullet points, main image and brand for one SKU, against what the last
 * weekly sync stored on the product. A first reading (nothing stored) is not a change.
 * @param {Object} product - stored catalogue row (bulletsHash, mainImage, brand)
 * @param {Object} facts - { bullets, bulletsHash, mainImage, brand } from the listing
 */
function diffWeeklyListing(product, facts) {
    const events = [];
    if (!product?.asin || !facts) return events;
    const base = { asin: product.asin, sku: product.sku || '', source: 'listing_items' };
    if (product.bulletsHash && facts.bulletsHash && product.bulletsHash !== facts.bulletsHash) {
        events.push({ ...base, field: 'bulletpoints', oldValue: null, newValue: (facts.bullets || []).slice(0, 10) });
    }
    if (product.mainImage && facts.mainImage && product.mainImage !== facts.mainImage) {
        events.push({ ...base, field: 'main_image', oldValue: product.mainImage, newValue: facts.mainImage });
    }
    if (product.brand && facts.brand && normText(product.brand).toLowerCase() !== normText(facts.brand).toLowerCase()) {
        events.push({ ...base, field: 'brand', oldValue: product.brand, newValue: facts.brand });
    }
    return events;
}

async function recordListingChanges(userId, country, region, events) {
    if (!Array.isArray(events) || events.length === 0) return 0;
    try {
        const ListingChangeEvent = require('../../models/products/ListingChangeEventModel.js');
        await ListingChangeEvent.insertMany(events.slice(0, 5000).map(e => ({ User: userId, country, region, ...e })), { ordered: false });
        logger.info('[ListingChanges] recorded', { userId: String(userId), country, region, count: events.length });
        return events.length;
    } catch (error) {
        logger.warn('[ListingChanges] could not record changes', { userId: String(userId), country, region, error: error.message });
        return 0;
    }
}

module.exports = { hashBullets, diffDailyListings, diffWeeklyListing, recordListingChanges, toPrice };

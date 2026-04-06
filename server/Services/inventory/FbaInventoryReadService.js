const mongoose = require('mongoose');
const FbaInventoryApiDetail = require('../../models/inventory/FbaInventoryApiDetailModel.js');

function toObjectId(userId) {
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
    return new mongoose.Types.ObjectId(userId);
  }
  return userId;
}

function normalizeAsin(asin) {
  const s = String(asin || '').trim();
  if (!s) return null;
  return s.toUpperCase();
}

function normalizeCountry(country) {
  return String(country || '').trim().toUpperCase() || null;
}

function stripMongoDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const { __v, ...rest } = doc;
  return rest;
}

/**
 * All stored FBA inventory rows for an ASIN in the current marketplace (User + country + region).
 * One ASIN can map to multiple MSKUs (sellerSku).
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @param {string} params.country
 * @param {string} params.region  NA | EU | FE
 * @param {string} params.asin
 * @returns {Promise<{ asin: string, country: string, region: string, items: object[], summary: object }>}
 */
async function getByAsin({ userId, country, region, asin }) {
  const asinNorm = normalizeAsin(asin);
  const countryNorm = normalizeCountry(country);
  const regionNorm = String(region || '').toUpperCase();

  if (!asinNorm) {
    throw new Error('ASIN is required');
  }
  if (!countryNorm || !['NA', 'EU', 'FE'].includes(regionNorm)) {
    throw new Error('Valid country and region (NA, EU, FE) are required');
  }

  const items = await FbaInventoryApiDetail.find({
    User: toObjectId(userId),
    country: countryNorm,
    region: regionNorm,
    asin: new RegExp(`^${asinNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  })
    .sort({ sellerSku: 1 })
    .lean();

  const cleaned = items.map(stripMongoDoc);

  const summary = {
    skuCount: cleaned.length,
    totalFulfillable: cleaned.reduce((s, r) => s + (Number(r.fulfillableQuantity) || 0), 0),
    totalQuantity: cleaned.reduce((s, r) => s + (Number(r.totalQuantity) || 0), 0),
    totalReserved: cleaned.reduce((s, r) => s + (Number(r.totalReservedQuantity) || 0), 0),
    totalInbound:
      cleaned.reduce(
        (s, r) =>
          s +
          (Number(r.inboundWorkingQuantity) || 0) +
          (Number(r.inboundShippedQuantity) || 0) +
          (Number(r.inboundReceivingQuantity) || 0),
        0
      ),
    totalUnfulfillable: cleaned.reduce((s, r) => s + (Number(r.totalUnfulfillableQuantity) || 0), 0),
    latestFetchedAt:
      cleaned.length === 0
        ? null
        : cleaned.reduce((latest, r) => {
            const t = r.fetchedAt ? new Date(r.fetchedAt).getTime() : 0;
            return t > latest.t ? { t, d: r.fetchedAt } : latest;
          }, { t: 0, d: null }).d,
  };

  const marketplaceId =
    cleaned.length === 0 ? null : cleaned[0].marketplaceId || null;

  return {
    asin: asinNorm,
    country: countryNorm,
    region: regionNorm,
    marketplaceId,
    items: cleaned,
    summary,
  };
}

module.exports = {
  getByAsin,
  normalizeAsin,
};

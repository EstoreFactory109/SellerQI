const mongoose = require('mongoose');
const FbaInventoryApiDetail = require('../../models/inventory/FbaInventoryApiDetailModel.js');

function num(v) {
  return Number(v) || 0;
}

/**
 * Map one FbaInventoryApiDetail row to Seller Central–style inventory buckets (per MSKU).
 * Top-level totals match how Seller Central sums rows (excludes inboundReceiving from "Inbound" line).
 */
function mapFbaDetailToAmazonInventory(detail) {
  if (!detail) return null;

  const available = num(detail.fulfillableQuantity);
  const fcTransfer = num(detail.pendingTransshipmentQuantity);
  const onHand = available + fcTransfer;

  const inboundWorking = num(detail.inboundWorkingQuantity);
  const inboundShipped = num(detail.inboundShippedQuantity);
  const inboundReceiving = num(detail.inboundReceivingQuantity);
  const inbound = inboundWorking + inboundShipped;

  const customerOrders = num(detail.pendingCustomerOrderQuantity);
  const fcProcessing = num(detail.fcProcessingQuantity);
  const reserved = customerOrders + fcProcessing;

  const unfulfillable = num(detail.totalUnfulfillableQuantity);
  const researching = num(detail.totalResearchingQuantity);

  const total = onHand + inbound + reserved + unfulfillable + researching;

  return {
    available,
    fcTransfer,
    onHand: {
      total: onHand,
      available,
      fcTransfer,
    },
    inbound: {
      total: inbound,
      working: inboundWorking,
      shipped: inboundShipped,
      receiving: inboundReceiving,
    },
    reserved: {
      total: reserved,
      customerOrders,
      fcProcessing,
    },
    unfulfillable,
    researching,
    total,
    apiTotalQuantity: num(detail.totalQuantity),
    lastUpdatedTime: detail.lastUpdatedTime || null,
    fetchedAt: detail.fetchedAt || null,
  };
}

function toObjectId(userId) {
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
    return new mongoose.Types.ObjectId(userId);
  }
  return userId;
}

/**
 * @param {mongoose.Types.ObjectId|string} userId
 * @param {string} country
 * @param {string} region NA | EU | FE
 * @param {string[]} skus
 * @returns {Promise<Map<string, object>>}
 */
async function loadAmazonInventoryBySkus(userId, country, region, skus) {
  const uniq = [...new Set(skus.map((s) => String(s || '').trim()).filter(Boolean))];
  if (uniq.length === 0) return new Map();

  const docs = await FbaInventoryApiDetail.find({
    User: toObjectId(userId),
    country: String(country || '').trim().toUpperCase(),
    region: String(region || '').trim().toUpperCase(),
    sellerSku: { $in: uniq },
  }).lean();

  const map = new Map();
  for (const doc of docs) {
    const key = String(doc.sellerSku || '').trim();
    if (key) map.set(key, mapFbaDetailToAmazonInventory(doc));
  }
  return map;
}

function enrichOneProduct(product, invBySku) {
  const sku = String(product.sku || '').trim();
  const fbaInventory = invBySku.get(sku) || null;
  return {
    ...product,
    fbaInventory,
    quantity: fbaInventory ? fbaInventory.available : num(product.quantity),
  };
}

/**
 * Attach per-SKU Amazon-style FBA inventory to Your Products rows (by sellerSku, not ASIN sum).
 */
async function enrichProductsWithFbaInventory(products, { userId, country, region }) {
  if (!Array.isArray(products) || products.length === 0) return products;
  const invBySku = await loadAmazonInventoryBySkus(
    userId,
    country,
    region,
    products.map((p) => p.sku)
  );
  return products.map((p) => enrichOneProduct(p, invBySku));
}

module.exports = {
  mapFbaDetailToAmazonInventory,
  loadAmazonInventoryBySkus,
  enrichProductsWithFbaInventory,
};

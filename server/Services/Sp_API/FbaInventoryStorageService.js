const mongoose = require('mongoose');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const FbaInventoryApiDetail = require('../../models/inventory/FbaInventoryApiDetailModel.js');
const logger = require('../../utils/Logger.js');

const BULK_CHUNK = 400;

function toUserObjectId(userId) {
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
    return new mongoose.Types.ObjectId(userId);
  }
  return userId;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function rowToDetailDoc(userObjectId, countryUpper, regionUpper, marketplaceId, row, fetchedAt) {
  return {
    User: userObjectId,
    country: countryUpper,
    region: regionUpper,
    marketplaceId: marketplaceId || '',
    asin: row.asin || '',
    fnSku: row.fnSku || '',
    sellerSku: row.sellerSku || '',
    productName: row.productName || '',
    condition: row.condition || '',
    lastUpdatedTime: row.lastUpdatedTime || '',
    totalQuantity: Number(row.totalQuantity) || 0,
    fulfillableQuantity: Number(row.fulfillableQuantity) || 0,
    inboundWorkingQuantity: Number(row.inboundWorkingQuantity) || 0,
    inboundShippedQuantity: Number(row.inboundShippedQuantity) || 0,
    inboundReceivingQuantity: Number(row.inboundReceivingQuantity) || 0,
    totalReservedQuantity: Number(row.totalReservedQuantity) || 0,
    pendingCustomerOrderQuantity: Number(row.pendingCustomerOrderQuantity) || 0,
    pendingTransshipmentQuantity: Number(row.pendingTransshipmentQuantity) || 0,
    fcProcessingQuantity: Number(row.fcProcessingQuantity) || 0,
    totalUnfulfillableQuantity: Number(row.totalUnfulfillableQuantity) || 0,
    customerDamagedQuantity: Number(row.customerDamagedQuantity) || 0,
    warehouseDamagedQuantity: Number(row.warehouseDamagedQuantity) || 0,
    distributorDamagedQuantity: Number(row.distributorDamagedQuantity) || 0,
    carrierDamagedQuantity: Number(row.carrierDamagedQuantity) || 0,
    defectiveQuantity: Number(row.defectiveQuantity) || 0,
    expiredQuantity: Number(row.expiredQuantity) || 0,
    totalResearchingQuantity: Number(row.totalResearchingQuantity) || 0,
    researchingQuantityInShortTerm: Number(row.researchingQuantityInShortTerm) || 0,
    researchingQuantityInMidTerm: Number(row.researchingQuantityInMidTerm) || 0,
    researchingQuantityInLongTerm: Number(row.researchingQuantityInLongTerm) || 0,
    fetchedAt,
  };
}

/**
 * Set products[].quantity to API fulfillableQuantity where asin + sku match a stock row (sku === sellerSku).
 */
async function updateSellerProductFulfillableQuantities(userObjectId, countryUpper, regionUpper, stockRows) {
  const seller = await Seller.findOne({ User: userObjectId }).sort({ createdAt: -1 });
  if (!seller) {
    logger.warn('[FbaInventoryStorage] Seller not found for User; skipping quantity sync');
    return 0;
  }

  const accIdx = seller.sellerAccount.findIndex(
    (a) => a?.country === countryUpper && a?.region === regionUpper
  );
  if (accIdx === -1) {
    logger.warn('[FbaInventoryStorage] Seller account not found for country/region; skipping quantity sync');
    return 0;
  }

  const byKey = new Map();
  for (const row of stockRows) {
    const asin = String(row.asin || '').trim();
    const sku = String(row.sellerSku || '').trim();
    if (asin && sku) byKey.set(`${asin}|${sku}`, row);
  }

  const account = seller.sellerAccount[accIdx];
  const products = account.products;
  if (!Array.isArray(products) || products.length === 0) {
    return 0;
  }

  let updated = 0;
  for (const p of products) {
    const asin = String(p.asin || '').trim();
    const sku = String(p.sku || '').trim();
    const row = byKey.get(`${asin}|${sku}`);
    if (row) {
      p.quantity = Number(row.fulfillableQuantity) || 0;
      updated += 1;
    }
  }

  if (updated > 0) {
    seller.markModified('sellerAccount');
    await seller.save();
  }

  return updated;
}

async function upsertInventoryDetailDocs(userObjectId, countryUpper, regionUpper, marketplaceId, stockRows) {
  const fetchedAt = new Date();
  let written = 0;

  for (const chunk of chunkArray(stockRows, BULK_CHUNK)) {
    const ops = chunk.map((row) => {
      const sellerSku = String(row.sellerSku || '').trim();
      if (!sellerSku) return null;
      const doc = rowToDetailDoc(
        userObjectId,
        countryUpper,
        regionUpper,
        marketplaceId,
        row,
        fetchedAt
      );
      return {
        updateOne: {
          filter: {
            User: userObjectId,
            country: countryUpper,
            region: regionUpper,
            sellerSku,
          },
          update: { $set: doc },
          upsert: true,
        },
      };
    }).filter(Boolean);

    if (ops.length === 0) continue;
    await FbaInventoryApiDetail.bulkWrite(ops, { ordered: false });
    written += ops.length;
  }

  return written;
}

/**
 * After a successful Inventory API fetch: update Seller product quantities and upsert per-SKU detail docs.
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @param {string} params.country  Uppercase country (e.g. IN)
 * @param {string} params.region  NA | EU | FE
 * @param {string} [params.marketplaceId]
 * @param {Object[]} params.stockRows  Normalized rows from ItemStock.parseInventorySummaries
 * @returns {Promise<{ sellerProductsUpdated: number, inventorySkuRowsWritten: number }>}
 */
async function persistFbaInventoryFromFetch({ userId, country, region, marketplaceId, stockRows }) {
  const userObjectId = toUserObjectId(userId);
  const countryUpper = String(country || '').toUpperCase();
  const regionUpper = String(region || '').toUpperCase();

  if (!Array.isArray(stockRows) || stockRows.length === 0) {
    return { sellerProductsUpdated: 0, inventorySkuRowsWritten: 0 };
  }

  const sellerProductsUpdated = await updateSellerProductFulfillableQuantities(
    userObjectId,
    countryUpper,
    regionUpper,
    stockRows
  );

  const inventorySkuRowsWritten = await upsertInventoryDetailDocs(
    userObjectId,
    countryUpper,
    regionUpper,
    marketplaceId || '',
    stockRows
  );

  logger.info(
    `[FbaInventoryStorage] Persisted FBA inventory: seller quantity rows=${sellerProductsUpdated}, detail SKUs=${inventorySkuRowsWritten}`
  );

  return { sellerProductsUpdated, inventorySkuRowsWritten };
}

const FBA_INVENTORY_LOG_NAME = 'FBA_INVENTORY_API_SYNC';

function sellerRegionToSpApiInternal(regionUpper) {
  const r = String(regionUpper || '').toUpperCase();
  if (r === 'NA') return 'na';
  if (r === 'EU') return 'eu';
  if (r === 'FE') return 'apac';
  return null;
}

/**
 * Inventory API fetch + persist (Seller quantities + FbaInventoryApiDetail).
 * Runs after GET_MERCHANT_LISTINGS_ALL_DATA in integration/schedule flows.
 * Does not throw — failures are logged only so the parent job is not broken.
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @param {string} params.country - Marketplace country (e.g. IN, US)
 * @param {string} params.region - NA | EU | FE
 * @param {string} [params.accessToken] - SP-API access token
 * @param {object} [params.loggingHelper] - LoggingHelper instance
 * @returns {Promise<{ ok: boolean, skipped?: string, error?: string, persistSummary?: object, skuRowCount?: number }>}
 */
async function runFbaInventorySyncForMarketplace({ userId, country, region, accessToken, loggingHelper }) {
  if (!accessToken) {
    loggingHelper?.logFunctionSkipped(FBA_INVENTORY_LOG_NAME, 'AccessToken not available');
    return { ok: false, skipped: 'no_token' };
  }

  const regionUpper = String(region || '').toUpperCase();
  const internalRegion = sellerRegionToSpApiInternal(regionUpper);
  if (!internalRegion) {
    loggingHelper?.logFunctionSkipped(FBA_INVENTORY_LOG_NAME, 'Invalid region for SP-API');
    return { ok: false, skipped: 'bad_region' };
  }

  const countryUpper = String(country || '').toUpperCase();

  try {
    loggingHelper?.logFunctionStart(FBA_INVENTORY_LOG_NAME, {
      hasAccessToken: true,
      country: countryUpper,
      region: regionUpper,
    });

    const { fetchInventoryStock } = require('./ItemStock.js');
    const result = await fetchInventoryStock({
      userId: String(userId),
      country: countryUpper,
      region: internalRegion,
      accessToken,
      sellerSkus: [],
    });

    let persistSummary = null;
    if (result?.hasData && Array.isArray(result.stockRows) && result.stockRows.length > 0) {
      persistSummary = await persistFbaInventoryFromFetch({
        userId,
        country: countryUpper,
        region: regionUpper,
        marketplaceId: result.marketplaceId,
        stockRows: result.stockRows,
      });
    }

    const skuRowCount = result?.stockRows?.length || 0;
    loggingHelper?.logFunctionSuccess(FBA_INVENTORY_LOG_NAME, result, {
      recordsProcessed: skuRowCount,
      recordsSuccessful: skuRowCount,
      hasData: Boolean(result?.hasData),
      marketplaceId: result?.marketplaceId || '',
      sellerProductsUpdated: persistSummary?.sellerProductsUpdated ?? 0,
      inventorySkuRowsWritten: persistSummary?.inventorySkuRowsWritten ?? 0,
    });

    return {
      ok: true,
      persistSummary,
      skuRowCount,
    };
  } catch (err) {
    logger.error(`[${FBA_INVENTORY_LOG_NAME}]`, {
      message: err?.message,
      userId: String(userId),
      country: countryUpper,
      region: regionUpper,
    });
    loggingHelper?.logFunctionError(FBA_INVENTORY_LOG_NAME, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

module.exports = {
  persistFbaInventoryFromFetch,
  updateSellerProductFulfillableQuantities,
  runFbaInventorySyncForMarketplace,
};

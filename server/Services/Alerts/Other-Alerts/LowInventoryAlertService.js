/**
 * LowInventoryAlertService.js
 *
 * Fetches the latest (and second-latest) Restock Inventory Recommendations documents.
 * Only proceeds if the latest document's createdAt is within the last 3 days (UTC).
 * Creates LowInventory alerts for:
 * - Out of stock (0 inventory): only when the ASIN had inventory > 0 in the second-latest doc
 *   and 0 in the latest doc (avoids re-alerting for ASINs already at 0).
 * - Running out: the same rule as the replenishment tasks (Inventory_.replenishmentQty,
 *   tasks-logics.xlsx "Products to Replenish"): days of supply under lead time + 14 days,
 *   or Amazon's reorder alert, on products selling 1+ unit a day. Each product is sent at
 *   most once a week (the spreadsheet's 7-day cooldown).
 */

const RestockInventoryRecommendations = require('../../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
const { LowInventoryAlert } = require('../../../models/alerts/Alert.js');
const { replenishmentQty } = require('../../Calculations/Inventory_.js');
const logger = require('../../../utils/Logger.js');

/** Days before a product still running out is emailed again (tasks-logics.xlsx cooldown). */
const LOW_STOCK_COOLDOWN_DAYS = 7;

/** Number of days within which stored data is considered fresh enough for alerts */
const ALERT_DATA_FRESH_DAYS = 3;

/**
 * Check if a date falls within the last N days (UTC).
 * @param {Date} date
 * @param {number} [days=3]
 * @returns {boolean}
 */
function isWithinLastNDays(date, days = ALERT_DATA_FRESH_DAYS) {
  if (!date) return false;
  const d = new Date(date);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d >= cutoff;
}

/**
 * Detect low inventory / out of stock from stored Restock document and create alert.
 * Only runs when the latest document was created within the last 3 days; otherwise skips (data may be old).
 *
 * @param {string|ObjectId} userId
 * @param {string} region
 * @param {string} country
 * @returns {Promise<{ created: boolean, alert?: Object, productsCount: number, skipped?: string, warning?: string }>}
 */
async function detectAndStoreLowInventoryAlerts(userId, region, country) {
  try {
    if (!userId) {
      logger.warn('[LowInventoryAlertService] No userId provided', { region, country });
      return {
        created: false,
        productsCount: 0,
        warning: 'User ID is required',
      };
    }

    const docs = await RestockInventoryRecommendations.find({
      User: userId,
      country,
      region,
    })
      .sort({ createdAt: -1 })
      .limit(2)
      .lean();

    const doc = docs[0] || null;
    const secondLastDoc = docs[1] || null;

    if (!doc) {
      logger.warn('[LowInventoryAlertService] No restock inventory data found for user', {
        userId: userId?.toString?.() || userId,
        region,
        country,
      });
      return {
        created: false,
        productsCount: 0,
        warning: 'No restock inventory data found for this user. Run scheduled integration first.',
      };
    }

    const createdAt = doc.createdAt;
    if (!isWithinLastNDays(createdAt)) {
      logger.info('[LowInventoryAlertService] Latest restock document is older than 3 days; skipping to avoid using stale data', {
        userId: userId?.toString?.() || userId,
        region,
        country,
        docCreatedAt: createdAt,
      });
      return {
        created: false,
        productsCount: 0,
        skipped: 'Latest restock data is older than 3 days. Data may be stale.',
      };
    }

    // ASINs that were already at 0 inventory in the second-latest doc (no alert for these again)
    const asinsAlreadyZeroInPrevious = new Set();
    if (secondLastDoc && Array.isArray(secondLastDoc.Products)) {
      for (const p of secondLastDoc.Products) {
        const prevAlert = (p.alert || p.Alert || '').toString().trim().toLowerCase();
        const prevAsin = (p.asin || '').toString().trim();
        if (prevAsin && prevAlert === 'out_of_stock') {
          asinsAlreadyZeroInPrevious.add(prevAsin);
        }
      }
    }

    const products = doc.Products || [];
    const alertProducts = [];

    // Running-out verdicts per SKU row, from the same rule as the tasks.
    const verdicts = new Map();
    const Seller = require('../../../models/user-auth/sellerCentralModel.js');
    const account = await Seller.findOne({ User: userId }).select('sellerAccount.country sellerAccount.region sellerAccount.replenishLeadTimeDays').lean()
      .then(s => (s?.sellerAccount || []).find(a => a.country === country && a.region === region))
      .catch(() => null);
    const leadTimeDays = Number(account?.replenishLeadTimeDays) > 0 ? Number(account.replenishLeadTimeDays) : undefined;
    for (const row of replenishmentQty(products, leadTimeDays ? { leadTimeDays } : {})) {
      if (row.status === 'Error') verdicts.set(`${row.asin}|${row.sku}`, row);
    }
    // ASINs already emailed as running out in the last week.
    const recentlySent = new Set();
    const since = new Date(Date.now() - LOW_STOCK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    const recent = await LowInventoryAlert.find({ User: userId, region, country, createdAt: { $gte: since } })
      .select('products.asin products.alert').lean().catch(() => []);
    for (const a of recent || []) {
      for (const p of a.products || []) if (p?.asin && p.alert !== 'out_of_stock') recentlySent.add(p.asin);
    }

    for (const p of products) {
      const alertVal = (p.alert || p.Alert || '').toString().trim().toLowerCase();
      const qty = Number(p.recommendedReplenishmentQty || p.RecommendedReplenishmentQty) || 0;
      const available = (p.available || p.Available || '0').toString();
      const asin = (p.asin || '').toString().trim();
      if (!asin) continue;
      const sku = (p.merchantSku || p.MerchantSku || p.sku || '').toString();

      const isOutOfStock = alertVal === 'out_of_stock';
      const running = verdicts.get(`${asin}|${sku}`);
      const isLowStock = !isOutOfStock && !!running && !recentlySent.has(asin);

      if (isOutOfStock) {
        // Only alert for 0 inventory when previous doc had > 0 (i.e. not already at 0 in second-last doc)
        if (!asinsAlreadyZeroInPrevious.has(asin)) {
          alertProducts.push({
            asin,
            sku: (p.merchantSku || p.MerchantSku || p.sku || '').toString() || undefined,
            available,
            recommendedReplenishmentQty: String(qty),
            alert: 'out_of_stock',
            message: `Out of stock. ${available} units available. Replenish ${qty} units.`,
          });
        }
      } else if (isLowStock) {
        recentlySent.add(asin); // one row per ASIN even with several SKUs
        const days = running.daysOfSupply ?? 0;
        alertProducts.push({
          asin,
          sku: sku || undefined,
          available,
          recommendedReplenishmentQty: String(qty),
          alert: alertVal || 'low_stock',
          message: `Runs out in about ${days} day${days === 1 ? '' : 's'} at the current sales rate (${running.available} available, ${running.inbound} inbound).${qty > 0 ? ` Amazon recommends sending ${qty} units.` : ''}`,
        });
      }
    }

    if (alertProducts.length === 0) {
      return { created: false, productsCount: 0 };
    }

    const alert = await LowInventoryAlert.create({
      User: userId,
      region,
      country,
      message: `${alertProducts.length} product(s) with low inventory or out of stock`,
      status: 'active',
      products: alertProducts,
      metadata: { docId: doc._id, docCreatedAt: doc.createdAt },
    });

    if (!alert || !alert._id) {
      return { created: false, productsCount: alertProducts.length };
    }

    logger.info('[LowInventoryAlertService] Low inventory alert created', {
      userId: userId?.toString?.() || userId,
      region,
      country,
      alertId: alert._id.toString(),
      productsCount: alertProducts.length,
    });

    return {
      created: true,
      alert,
      productsCount: alertProducts.length,
    };
  } catch (error) {
    logger.error('[LowInventoryAlertService] Error in detectAndStoreLowInventoryAlerts', {
      userId: userId?.toString?.() || userId,
      region,
      country,
      error: error?.message,
    });
    return {
      created: false,
      productsCount: 0,
      error: error?.message || 'Unknown error',
    };
  }
}

module.exports = {
  detectAndStoreLowInventoryAlerts,
  isWithinLastNDays,
  ALERT_DATA_FRESH_DAYS,
  LOW_STOCK_COOLDOWN_DAYS,
};

/**
 * LowInventoryAlertService.js
 *
 * Fetches the latest (and second-latest) Restock Inventory Recommendations documents.
 * Only proceeds if the latest document's createdAt is within the last 3 days (UTC).
 * Creates LowInventory alerts for:
 * - Out of stock (0 inventory): only when the ASIN had inventory > 0 in the second-latest doc
 *   and 0 in the latest doc (avoids re-alerting for ASINs already at 0).
 * - Low stock: when recommendedReplenishmentQty > 30 (based on latest doc only).
 */

const RestockInventoryRecommendations = require('../../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
const { LowInventoryAlert } = require('../../../models/alerts/Alert.js');
const logger = require('../../../utils/Logger.js');

/** Replenishment qty threshold: above this is considered "low stock" / Error (same as Inventory_.js) */
const LOW_STOCK_REPLENISHMENT_QTY_THRESHOLD = 30;

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

    for (const p of products) {
      const alertVal = (p.alert || p.Alert || '').toString().trim().toLowerCase();
      const qty = Number(p.recommendedReplenishmentQty || p.RecommendedReplenishmentQty) || 0;
      const available = (p.available || p.Available || '0').toString();
      const asin = (p.asin || '').toString().trim();
      if (!asin) continue;

      const isOutOfStock = alertVal === 'out_of_stock';
      const isLowStock = !isOutOfStock && qty > LOW_STOCK_REPLENISHMENT_QTY_THRESHOLD;

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
        alertProducts.push({
          asin,
          sku: (p.merchantSku || p.MerchantSku || p.sku || '').toString() || undefined,
          available,
          recommendedReplenishmentQty: String(qty),
          alert: alertVal || 'low_stock',
          message: `Low stock. ${available} units available. Amazon recommends replenishing ${qty} units.`,
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
  LOW_STOCK_REPLENISHMENT_QTY_THRESHOLD,
};

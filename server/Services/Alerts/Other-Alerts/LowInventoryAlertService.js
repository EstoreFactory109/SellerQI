/**
 * LowInventoryAlertService.js
 *
 * Fetches the latest Restock Inventory Recommendations document from the database.
 * Only proceeds if the document's createdAt date is today (same calendar day, UTC).
 * Creates LowInventory alerts for products that are out of stock or low stock
 * (alert === "out_of_stock" or recommendedReplenishmentQty > 30).
 */

const RestockInventoryRecommendations = require('../../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
const { LowInventoryAlert } = require('../../../models/alerts/Alert.js');
const logger = require('../../../utils/Logger.js');

/** Replenishment qty threshold: above this is considered "low stock" / Error (same as Inventory_.js) */
const LOW_STOCK_REPLENISHMENT_QTY_THRESHOLD = 30;

/**
 * Check if a date is the same calendar day as today (UTC).
 * @param {Date} date
 * @returns {boolean}
 */
function isCreatedToday(date) {
  if (!date) return false;
  const d = new Date(date);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

/**
 * Detect low inventory / out of stock from stored Restock document and create alert.
 * Only runs when the latest document was created today; otherwise skips (data may be old).
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

    const doc = await RestockInventoryRecommendations.findOne({
      User: userId,
      country,
      region,
    })
      .sort({ createdAt: -1 })
      .limit(1)
      .lean();

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
    if (!isCreatedToday(createdAt)) {
      logger.info('[LowInventoryAlertService] Latest restock document is not from today; skipping to avoid using old data', {
        userId: userId?.toString?.() || userId,
        region,
        country,
        docCreatedAt: createdAt,
      });
      return {
        created: false,
        productsCount: 0,
        skipped: 'Latest restock data is not from today. Data may be stale.',
      };
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
        alertProducts.push({
          asin,
          sku: (p.merchantSku || p.MerchantSku || p.sku || '').toString() || undefined,
          available,
          recommendedReplenishmentQty: String(qty),
          alert: 'out_of_stock',
          message: `Out of stock. ${available} units available. Replenish ${qty} units.`,
        });
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
  isCreatedToday,
  LOW_STOCK_REPLENISHMENT_QTY_THRESHOLD,
};

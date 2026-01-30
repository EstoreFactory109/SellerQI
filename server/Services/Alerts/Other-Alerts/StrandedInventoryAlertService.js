/**
 * StrandedInventoryAlertService.js
 *
 * Fetches the latest Stranded Inventory UI data document from the database.
 * Only proceeds if the document's createdAt date is today (same calendar day, UTC).
 * Creates StrandedInventory alerts for products in the stranded report.
 */

const StrandedInventoryUIData = require('../../../models/inventory/GET_STRANDED_INVENTORY_UI_DATA_MODEL.js');
const { StrandedInventoryAlert } = require('../../../models/alerts/Alert.js');
const logger = require('../../../utils/Logger.js');

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
 * Flatten strandedUIData: schema may store array of arrays or flat array of items.
 * @param {Array} raw
 * @returns {Array<{ asin: string, status_primary?: string, stranded_reason?: string }>}
 */
function flattenStrandedItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const flat = raw.flat();
  return flat.filter((item) => item && (item.asin || item.ASIN));
}

/**
 * Detect stranded inventory from stored document and create alert.
 * Only runs when the latest document was created today; otherwise skips (data may be old).
 *
 * @param {string|ObjectId} userId
 * @param {string} region
 * @param {string} country
 * @returns {Promise<{ created: boolean, alert?: Object, productsCount: number, skipped?: string, warning?: string }>}
 */
async function detectAndStoreStrandedInventoryAlerts(userId, region, country) {
  try {
    if (!userId) {
      logger.warn('[StrandedInventoryAlertService] No userId provided', { region, country });
      return {
        created: false,
        productsCount: 0,
        warning: 'User ID is required',
      };
    }

    const doc = await StrandedInventoryUIData.findOne({
      User: userId,
      country,
      region,
    })
      .sort({ createdAt: -1 })
      .limit(1)
      .lean();

    if (!doc) {
      logger.warn('[StrandedInventoryAlertService] No stranded inventory data found for user', {
        userId: userId?.toString?.() || userId,
        region,
        country,
      });
      return {
        created: false,
        productsCount: 0,
        warning: 'No stranded inventory data found for this user. Run scheduled integration first.',
      };
    }

    const createdAt = doc.createdAt;
    if (!isCreatedToday(createdAt)) {
      logger.info('[StrandedInventoryAlertService] Latest stranded document is not from today; skipping to avoid using old data', {
        userId: userId?.toString?.() || userId,
        region,
        country,
        docCreatedAt: createdAt,
      });
      return {
        created: false,
        productsCount: 0,
        skipped: 'Latest stranded inventory data is not from today. Data may be stale.',
      };
    }

    const rawData = doc.strandedUIData || doc.strandedUIdata || [];
    const items = flattenStrandedItems(rawData);

    if (items.length === 0) {
      return { created: false, productsCount: 0 };
    }

    const products = items.map((item) => {
      const asin = (item.asin || item.ASIN || '').toString().trim();
      const statusPrimary = (item.status_primary || item['status-primary'] || '').toString();
      const strandedReason = (item.stranded_reason || item['stranded-reason'] || '').toString();
      return {
        asin,
        status_primary: statusPrimary || undefined,
        stranded_reason: strandedReason || undefined,
        message: [statusPrimary, strandedReason].filter(Boolean).join(' – ') || 'Stranded inventory',
      };
    });

    const alert = await StrandedInventoryAlert.create({
      User: userId,
      region,
      country,
      message: `${products.length} product(s) with stranded inventory`,
      status: 'active',
      products,
      metadata: { docId: doc._id, docCreatedAt: doc.createdAt },
    });

    if (!alert || !alert._id) {
      return { created: false, productsCount: products.length };
    }

    logger.info('[StrandedInventoryAlertService] Stranded inventory alert created', {
      userId: userId?.toString?.() || userId,
      region,
      country,
      alertId: alert._id.toString(),
      productsCount: products.length,
    });

    return {
      created: true,
      alert,
      productsCount: products.length,
    };
  } catch (error) {
    logger.error('[StrandedInventoryAlertService] Error in detectAndStoreStrandedInventoryAlerts', {
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
  detectAndStoreStrandedInventoryAlerts,
  isCreatedToday,
  flattenStrandedItems,
};

/**
 * InboundShipmentAlertService.js
 *
 * Fetches the latest Inbound Non-Compliance document from the database.
 * Only proceeds if the document's createdAt is within the last 3 days (UTC).
 * Creates InboundShipment alerts for products in ErrorData (inbound shipment issues).
 */

const InboundNonComplianceModel = require('../../../models/inventory/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA.js');
const { InboundShipmentAlert } = require('../../../models/alerts/Alert.js');
const logger = require('../../../utils/Logger.js');

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
 * Detect inbound shipment issues from stored document and create alert.
 * Only runs when the latest document was created within the last 3 days; otherwise skips (data may be old).
 * Model uses userId (not User) for the user reference.
 *
 * @param {string|ObjectId} userId
 * @param {string} region
 * @param {string} country
 * @returns {Promise<{ created: boolean, alert?: Object, productsCount: number, skipped?: string, warning?: string }>}
 */
async function detectAndStoreInboundShipmentAlerts(userId, region, country) {
  try {
    if (!userId) {
      logger.warn('[InboundShipmentAlertService] No userId provided', { region, country });
      return {
        created: false,
        productsCount: 0,
        warning: 'User ID is required',
      };
    }

    const doc = await InboundNonComplianceModel.findOne({
      userId,
      country,
      region,
    })
      .sort({ createdAt: -1 })
      .limit(1)
      .lean();

    if (!doc) {
      logger.warn('[InboundShipmentAlertService] No inbound non-compliance data found for user', {
        userId: userId?.toString?.() || userId,
        region,
        country,
      });
      return {
        created: false,
        productsCount: 0,
        warning: 'No inbound shipment / non-compliance data found for this user. Run scheduled integration first.',
      };
    }

    const createdAt = doc.createdAt;
    if (!isWithinLastNDays(createdAt)) {
      logger.info('[InboundShipmentAlertService] Latest inbound document is older than 3 days; skipping to avoid using stale data', {
        userId: userId?.toString?.() || userId,
        region,
        country,
        docCreatedAt: createdAt,
      });
      return {
        created: false,
        productsCount: 0,
        skipped: 'Latest inbound non-compliance data is older than 3 days. Data may be stale.',
      };
    }

    const errorData = doc.ErrorData || [];
    if (!Array.isArray(errorData) || errorData.length === 0) {
      return { created: false, productsCount: 0 };
    }

    const products = errorData.map((item) => {
      const asin = (item.asin || '').toString().trim();
      const issueReportedDate = (item.issueReportedDate || '').toString();
      const shipmentCreationDate = (item.shipmentCreationDate || '').toString();
      const problemType = (item.problemType || '').toString();
      return {
        asin,
        issueReportedDate: issueReportedDate || undefined,
        shipmentCreationDate: shipmentCreationDate || undefined,
        problemType: problemType || undefined,
        message: problemType ? `Inbound issue: ${problemType}` : 'Inbound shipment issue',
      };
    }).filter((p) => p.asin);

    if (products.length === 0) {
      return { created: false, productsCount: 0 };
    }

    const alert = await InboundShipmentAlert.create({
      User: userId,
      region,
      country,
      message: `${products.length} product(s) with inbound shipment issues`,
      status: 'active',
      products,
      metadata: { docId: doc._id, docCreatedAt: doc.createdAt },
    });

    if (!alert || !alert._id) {
      return { created: false, productsCount: products.length };
    }

    logger.info('[InboundShipmentAlertService] Inbound shipment alert created', {
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
    logger.error('[InboundShipmentAlertService] Error in detectAndStoreInboundShipmentAlerts', {
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
  detectAndStoreInboundShipmentAlerts,
  isWithinLastNDays,
  ALERT_DATA_FRESH_DAYS,
};

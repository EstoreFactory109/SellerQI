/**
 * BuyBoxMissingAlertService.js
 *
 * Fetches the latest BuyBoxData document for a user/region/country and creates
 * BuyBoxMissingAlert for ASINs where buyBoxPercentage === 0.
 */

const BuyBoxData = require('../../../models/MCP/BuyBoxDataModel.js');
const { BuyBoxMissingAlert } = require('../../../models/alerts/Alert.js');
const User = require('../../../models/user-auth/userModel.js');
const { sendAlertsEmail } = require('../../Email/SendAlertsEmail.js');
const logger = require('../../../utils/Logger.js');

/**
 * Fetches latest BuyBoxData, finds ASINs with buyBoxPercentage === 0, creates BuyBoxMissingAlert.
 * @param {mongoose.Types.ObjectId} userId
 * @param {string} region
 * @param {string} country
 * @returns {Promise<{ created: boolean, alert?: Object, productsWithChanges: number, error?: string }>}
 */
async function detectAndStoreBuyBoxMissingAlerts(userId, region, country) {
  try {
    const regionNorm = (region && String(region).trim()) || '';
    const countryNorm = (country && String(country).trim()) || '';

    const buyBoxDoc = await BuyBoxData.findLatest(userId, regionNorm || undefined, countryNorm || undefined).lean();

    if (!buyBoxDoc || !buyBoxDoc.asinBuyBoxData || !Array.isArray(buyBoxDoc.asinBuyBoxData)) {
      logger.info('[BuyBoxMissingAlertService] No BuyBoxData or asinBuyBoxData', { userId, region, country });
      return { created: false, productsWithChanges: 0 };
    }

    const products = [];

    for (const item of buyBoxDoc.asinBuyBoxData) {
      const pct = item.buyBoxPercentage != null ? Number(item.buyBoxPercentage) : 0;
      if (pct > 0) continue;

      const asin = (item.childAsin || item.asin || '').trim() || null;
      if (!asin) continue;

      products.push({
        asin,
        sku: item.sku ?? undefined,
        message: 'Buy box not present (0% buy box share)',
      });
    }

    if (products.length === 0) {
      return { created: false, productsWithChanges: 0 };
    }

    const alertPayload = {
      User: userId,
      region,
      country,
      products,
      message: `${products.length} product(s) without buy box`,
      status: 'active',
      metadata: {
        sourceDocId: buyBoxDoc._id,
        sourceCreatedAt: buyBoxDoc.createdAt,
        dateRange: buyBoxDoc.dateRange,
      },
    };

    const alert = await BuyBoxMissingAlert.create(alertPayload);

    if (!alert || !alert._id) {
      return { created: false, productsWithChanges: products.length };
    }

    logger.info('[BuyBoxMissingAlert] Alert saved to database', {
      userId,
      region,
      country,
      alertId: alert._id.toString(),
      productsCount: products.length,
    });

    try {
      const user = await User.findById(userId).select('email firstName').lean();
      if (user?.email) {
        const payload = {
          productContentChange: { count: 0, products: [] },
          negativeReviews: { count: 0, products: [] },
          buyBoxMissing: {
            count: products.length,
            products: (alert.products || []).map((p) => ({ asin: p.asin, sku: p.sku, message: p.message })),
          },
        };
        const emailSent = await sendAlertsEmail(user.email, user.firstName || 'Seller', payload, undefined, userId);
        if (emailSent) {
          logger.info('[BuyBoxMissingAlert] Summary email sent after buybox missing alert', { userId });
        } else {
          logger.warn('[BuyBoxMissingAlert] Alerts email could not be sent (non-fatal)', { userId });
        }
      }
    } catch (emailErr) {
      logger.warn('[BuyBoxMissingAlert] Alerts email failed (non-fatal)', { userId, error: emailErr?.message });
    }

    return { created: true, alert, productsWithChanges: products.length };
  } catch (error) {
    logger.error('[BuyBoxMissingAlertService] Error in detectAndStoreBuyBoxMissingAlerts', {
      userId,
      region,
      country,
      error: error?.message,
    });
    return {
      created: false,
      productsWithChanges: 0,
      error: error?.message,
    };
  }
}

module.exports = {
  detectAndStoreBuyBoxMissingAlerts,
};

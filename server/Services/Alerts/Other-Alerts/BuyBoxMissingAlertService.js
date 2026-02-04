/**
 * BuyBoxMissingAlertService.js
 *
 * Fetches the latest BuyBoxData document for a user/region/country and creates
 * BuyBoxMissingAlert for ASINs where buyBoxPercentage === 0.
 *
 * Logic:
 * 1) Only consider products that are active (Seller model). Inactive products are skipped.
 * 2) Compare last and second-last BuyBoxData: if both show 0% buybox for an ASIN, skip (email already sent last time).
 *    Otherwise (only latest shows 0%, or no previous data) treat as alert.
 */

const BuyBoxData = require('../../../models/MCP/BuyBoxDataModel.js');
const { BuyBoxMissingAlert } = require('../../../models/alerts/Alert.js');
const User = require('../../../models/user-auth/userModel.js');
const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const { sendAlertsEmail } = require('../../Email/SendAlertsEmail.js');
const logger = require('../../../utils/Logger.js');

/** Build set of active ASINs from Seller account (region/country). Product is active if status is 'active' (case-insensitive). */
function getActiveAsins(seller, regionNorm, countryNorm) {
  const set = new Set();
  if (!seller?.sellerAccount?.length) return set;
  const account = seller.sellerAccount.find(
    (acc) => acc.region === regionNorm && acc.country === countryNorm
  );
  const list = account?.products || [];
  for (const p of list) {
    const status = (p.status && String(p.status).toLowerCase()) || '';
    if (status === 'active') {
      const asin = (p.asin && String(p.asin).trim()) || '';
      if (asin) set.add(asin);
    }
  }
  return set;
}

/** Get buyBoxPercentage for an ASIN from asinBuyBoxData. Returns undefined if not found. */
function getBuyBoxPctForAsin(asinBuyBoxData, asin) {
  if (!Array.isArray(asinBuyBoxData) || !asin) return undefined;
  const item = asinBuyBoxData.find(
    (x) => (x.childAsin || x.asin || '').trim() === asin
  );
  return item?.buyBoxPercentage != null ? Number(item.buyBoxPercentage) : undefined;
}

/**
 * Fetches latest BuyBoxData, finds ASINs with buyBoxPercentage === 0 (active only; skip if previous fetch also had 0%), creates BuyBoxMissingAlert.
 * @param {mongoose.Types.ObjectId} userId
 * @param {string} region
 * @param {string} country
 * @param {Object} [options] - { sendEmail: boolean } - If false, do not send email (default true)
 * @returns {Promise<{ created: boolean, alert?: Object, productsWithChanges: number, error?: string }>}
 */
async function detectAndStoreBuyBoxMissingAlerts(userId, region, country, options = {}) {
  const sendEmail = options.sendEmail !== false;
  try {
    const regionNorm = (region && String(region).trim()) || '';
    const countryNorm = (country && String(country).trim()) || '';

    // 1) Active products: load Seller and build set of active ASINs
    const seller = await Seller.findOne({ User: userId }).select('sellerAccount').lean();
    const activeAsins = getActiveAsins(seller, regionNorm, countryNorm);

    // 2) Last two BuyBoxData docs (latest and second-latest)
    const lastTwoDocs = await BuyBoxData.find({
      User: userId,
      region: regionNorm,
      country: countryNorm,
    })
      .sort({ createdAt: -1 })
      .limit(2)
      .lean();

    const buyBoxDoc = lastTwoDocs[0] || null;
    const previousDoc = lastTwoDocs[1] || null;

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

      // 1) Only consider active products (if we have Seller data; if no active list, include all so behaviour is unchanged when Seller has no products)
      if (activeAsins.size > 0 && !activeAsins.has(asin)) continue;

      // 2) If previous doc also shows 0% buybox for this ASIN, skip (already alerted last time)
      const previousPct = getBuyBoxPctForAsin(previousDoc?.asinBuyBoxData, asin);
      if (previousPct !== undefined && previousPct === 0) continue;

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

    if (sendEmail) {
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

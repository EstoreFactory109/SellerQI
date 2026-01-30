/**
 * ProductContentChangeAlertService.js
 *
 * Single flow: fetches NumberOfProductReviews once, then runs (1) product content change,
 * (2) negative reviews, and (3) A+ present or not checks. Creates ProductContentChangeAlert,
 * NegetiveReviewsAlert, and/or APlusMissingAlert as needed.
 */

const NumberOfProductReviews = require('../../../models/seller-performance/NumberOfProductReviewsModel.js');
const APlusContent = require('../../../models/seller-performance/APlusContentModel.js');
const { ProductContentChangeAlert, NegetiveReviewsAlert, APlusMissingAlert } = require('../../../models/alerts/Alert.js');
const User = require('../../../models/user-auth/userModel.js');
const { sendAlertsEmail } = require('../../Email/SendAlertsEmail.js');
const logger = require('../../../utils/Logger.js');

const NEGATIVE_REVIEW_RATING_THRESHOLD = 4;

/** Escape special regex characters in a string used for RegExp */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalize string: trim and collapse multiple whitespace/newlines to single space */
function normalizeString(str) {
  if (str == null) return '';
  return String(str)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Coerce value to array of strings (model has [String]; API/DB may return string or array). Splits string on newlines so "A\nB" matches ["A","B"]. */
function toNormalizedStringArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val.map((s) => (s == null ? '' : String(s).trim()));
  const str = String(val).trim();
  if (str === '') return [];
  return str.split(/\r?\n/).map((s) => s.trim());
}

function arraysEqual(a, b) {
  const arrA = toNormalizedStringArray(a);
  const arrB = toNormalizedStringArray(b);
  if (arrA.length !== arrB.length) return false;
  return arrA.every((val, i) => val === arrB[i]);
}

function getContentChanges(older, newer) {
  const changeTypes = [];
  const parts = [];

  const oldTitle = normalizeString(older?.product_title);
  const newTitle = normalizeString(newer?.product_title);
  if (oldTitle !== newTitle) {
    changeTypes.push('title');
    parts.push('title');
  }

  const oldDesc = older?.product_description ?? [];
  const newDesc = newer?.product_description ?? [];
  if (!arraysEqual(oldDesc, newDesc)) {
    changeTypes.push('description');
    parts.push('description');
  }

  const oldBullets = older?.about_product ?? [];
  const newBullets = newer?.about_product ?? [];
  if (!arraysEqual(oldBullets, newBullets)) {
    changeTypes.push('bullet_points');
    parts.push('bullet points');
  }

  const oldImages = toNormalizedStringArray(older?.product_photos);
  const newImages = toNormalizedStringArray(newer?.product_photos);
  if (!arraysEqual(oldImages, newImages)) {
    changeTypes.push('images');
    parts.push('images');
  }

  const message =
    parts.length > 0
      ? `Content change(s) detected: ${parts.join(', ')}`
      : '';

  return { changeTypes, message };
}

/**
 * Run product content change check on already-fetched newerDoc and olderDoc. Creates alert if needed.
 * @param {Object} newerDoc - Most recent NumberOfProductReviews doc (index 0)
 * @param {Object} olderDoc - Second most recent (index 1)
 * @param {*} userId
 * @param {string} region
 * @param {string} country
 * @returns {Promise<{ created: boolean, alert?: Object, productsWithChanges: number }>}
 */
async function runProductContentChangeCheck(newerDoc, olderDoc, userId, region, country) {
  const newerId = newerDoc._id?.toString();
  const olderId = olderDoc._id?.toString();
  if (newerId && olderId && newerId === olderId) {
    return { created: false, productsWithChanges: 0 };
  }

  const normAsin = (a) => (a == null ? '' : String(a).trim().toUpperCase());
  const olderByAsin = new Map(
    (olderDoc.Products || []).map((p) => [normAsin(p.asin), { ...p, asin: p.asin?.trim() || p.asin }])
  );
  const newerByAsin = new Map(
    (newerDoc.Products || []).map((p) => [normAsin(p.asin), { ...p, asin: p.asin?.trim() || p.asin }])
  );

  const products = [];

  for (const [normalizedAsin, newerProduct] of newerByAsin) {
    const olderProduct = olderByAsin.get(normalizedAsin);
    if (!olderProduct) continue;

    const oldTitle = normalizeString(olderProduct?.product_title);
    const newTitle = normalizeString(newerProduct?.product_title);
    const titleEqual = oldTitle === newTitle;
    const descEqual = arraysEqual(olderProduct?.product_description ?? [], newerProduct?.product_description ?? []);
    const bulletsEqual = arraysEqual(olderProduct?.about_product ?? [], newerProduct?.about_product ?? []);
    const oldPhotos = toNormalizedStringArray(olderProduct?.product_photos);
    const newPhotos = toNormalizedStringArray(newerProduct?.product_photos);
    const imagesEqual = arraysEqual(oldPhotos, newPhotos);
    const imagesReduced = newPhotos.length < oldPhotos.length;

    if (!titleEqual || !descEqual || !bulletsEqual || !imagesEqual) {
      const changeTypes = [];
      if (!titleEqual) changeTypes.push('title');
      if (!descEqual) changeTypes.push('description');
      if (!bulletsEqual) changeTypes.push('bullet_points');
      if (!imagesEqual) changeTypes.push('images');
      const message =
        changeTypes.length > 0
          ? `Content change(s) detected: ${changeTypes.map((c) => (c === 'bullet_points' ? 'bullet points' : c)).join(', ')}`
          : '';
      products.push({
        asin: newerProduct.asin,
        sku: newerProduct.sku ?? undefined,
        changeTypes,
        message: message || undefined,
      });
    }
  }

  if (products.length === 0) {
    return { created: false, productsWithChanges: 0 };
  }

  const alertPayload = {
    User: userId,
    region,
    country,
    products,
    message: `${products.length} product(s) with content changes`,
    status: 'active',
    metadata: {
      olderDocId: olderDoc._id,
      newerDocId: newerDoc._id,
      olderCreatedAt: olderDoc.createdAt,
      newerCreatedAt: newerDoc.createdAt,
    },
  };

  const alert = await ProductContentChangeAlert.create(alertPayload);
  if (!alert || !alert._id) {
    return { created: false, productsWithChanges: products.length };
  }
  logger.info('[ProductContentChangeAlert] Alert saved to database', {
    userId,
    region,
    country,
    alertId: alert._id.toString(),
    productsCount: products.length,
  });
  return { created: true, alert, productsWithChanges: products.length };
}

/**
 * Run negative reviews check on already-fetched latest doc. Creates alert for products with star rating < 4.
 * @param {Object} lastDoc - Most recent NumberOfProductReviews doc
 * @param {*} userId
 * @param {string} region
 * @param {string} country
 * @returns {Promise<{ created: boolean, alert?: Object, productsWithChanges: number }>}
 */
async function runNegativeReviewsCheck(lastDoc, userId, region, country) {
  if (!lastDoc || !lastDoc.Products || lastDoc.Products.length === 0) {
    return { created: false, productsWithChanges: 0 };
  }

  const products = [];

  for (const p of lastDoc.Products) {
    const rating = parseFloat(p.product_star_ratings);
    if (Number.isNaN(rating) || rating >= NEGATIVE_REVIEW_RATING_THRESHOLD) continue;

    const reviewCount = parseInt(p.product_num_ratings, 10) || 0;
    products.push({
      asin: p.asin?.trim() || p.asin,
      sku: p.sku ?? undefined,
      rating,
      reviewCount,
      message: `Star rating ${rating} is below ${NEGATIVE_REVIEW_RATING_THRESHOLD}`,
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
    message: `${products.length} product(s) with star rating below ${NEGATIVE_REVIEW_RATING_THRESHOLD}`,
    status: 'active',
    metadata: {
      sourceDocId: lastDoc._id,
      sourceCreatedAt: lastDoc.createdAt,
      threshold: NEGATIVE_REVIEW_RATING_THRESHOLD,
    },
  };

  const alert = await NegetiveReviewsAlert.create(alertPayload);

  if (!alert || !alert._id) {
    return { created: false, productsWithChanges: products.length };
  }

  logger.info('[NegetiveReviewsAlert] Alert saved to database', {
    userId,
    region,
    country,
    alertId: alert._id.toString(),
    productsCount: products.length,
  });

  return { created: true, alert, productsWithChanges: products.length };
}

/**
 * Run A+ present or not check: fetch latest APlusContent, find ASINs that don't have A+ (status not APPROVED/PUBLISHED/true).
 * @param {*} userId
 * @param {string} region
 * @param {string} country
 * @returns {Promise<{ created: boolean, alert?: Object, productsWithChanges: number }>}
 */
async function runAPlusMissingCheck(userId, region, country) {
  const regionNorm = (region && String(region).trim()) || '';
  const countryNorm = (country && String(country).trim()) || '';
  const query = {
    User: userId,
    region: new RegExp(`^${escapeRegex(regionNorm)}$`, 'i'),
    country: new RegExp(`^${escapeRegex(countryNorm)}$`, 'i'),
  };

  const aplusDoc = await APlusContent.findOne(query).sort({ createdAt: -1 }).lean();
  if (!aplusDoc || !Array.isArray(aplusDoc.ApiContentDetails) || aplusDoc.ApiContentDetails.length === 0) {
    return { created: false, productsWithChanges: 0 };
  }

  const products = [];
  for (const item of aplusDoc.ApiContentDetails) {
    const asin = item.Asins || item.asin;
    if (!asin || typeof asin !== 'string') continue;
    const status = item.status;
    const hasAPlus =
      status === 'APPROVED' ||
      status === 'PUBLISHED' ||
      status === 'true' ||
      status === true;
    if (hasAPlus) continue;
    products.push({
      asin: String(asin).trim(),
      sku: undefined,
      message: `A+ content not present (status: ${status || 'Not Available'})`,
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
    message: `${products.length} product(s) without A+ content`,
    status: 'active',
    metadata: {
      sourceDocId: aplusDoc._id,
      sourceCreatedAt: aplusDoc.createdAt,
    },
  };

  const alert = await APlusMissingAlert.create(alertPayload);
  if (!alert || !alert._id) {
    return { created: false, productsWithChanges: products.length };
  }
  logger.info('[APlusMissingAlert] Alert saved to database', {
    userId,
    region,
    country,
    alertId: alert._id.toString(),
    productsCount: products.length,
  });
  return { created: true, alert, productsWithChanges: products.length };
}

/**
 * Fetch NumberOfProductReviews once (last 2 docs), run product content change and negative reviews checks,
 * and run A+ missing check from APlusContent. Creates ProductContentChangeAlert, NegetiveReviewsAlert,
 * and/or APlusMissingAlert as needed. Does not handle buybox missing; use BuyBoxMissingAlertService for that.
 * @param {mongoose.Types.ObjectId} userId
 * @param {string} region
 * @param {string} country
 * @returns {Promise<{ productContentChange, negativeReviews, aplusMissing, error?: string }>}
 */
async function detectAndStoreAlerts(userId, region, country) {
  try {
    const regionNorm = (region && String(region).trim()) || '';
    const countryNorm = (country && String(country).trim()) || '';
    const query = {
      User: userId,
      region: new RegExp(`^${escapeRegex(regionNorm)}$`, 'i'),
      country: new RegExp(`^${escapeRegex(countryNorm)}$`, 'i'),
    };

    const allMatching = await NumberOfProductReviews.find(query)
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const docCount = allMatching?.length ?? 0;

    let productContentChange = { created: false, productsWithChanges: 0 };
    let negativeReviews = { created: false, productsWithChanges: 0 };
    let aplusMissing = { created: false, productsWithChanges: 0 };

    if (docCount > 0) {
      const latestDoc = allMatching[0];

      if (docCount >= 2) {
        const olderDoc = allMatching[1];
        productContentChange = await runProductContentChangeCheck(latestDoc, olderDoc, userId, region, country);
        logger.info('[Alerts] Product content change check done', {
          userId,
          region,
          country,
          created: productContentChange.created,
          productsWithChanges: productContentChange.productsWithChanges,
        });
      } else {
        logger.info('[Alerts] Skipping product content change: need at least 2 documents', {
          userId,
          region,
          country,
          count: docCount,
        });
      }

      negativeReviews = await runNegativeReviewsCheck(latestDoc, userId, region, country);
    } else {
      logger.info('[Alerts] No NumberOfProductReviews documents', { userId, region, country });
    }

    aplusMissing = await runAPlusMissingCheck(userId, region, country);
    if (aplusMissing.created) {
      logger.info('[Alerts] A+ missing check done', {
        userId,
        region,
        country,
        productsWithChanges: aplusMissing.productsWithChanges,
      });
    }

    if (productContentChange.created || negativeReviews.created || aplusMissing.created) {
      try {
        const user = await User.findById(userId).select('email firstName').lean();
        if (user?.email) {
          const payload = {
            productContentChange: {
              count: productContentChange.productsWithChanges,
              products: (productContentChange.alert?.products || []).map((p) => ({
                asin: p.asin,
                sku: p.sku,
                message: p.message,
                changeTypes: p.changeTypes,
              })),
            },
            negativeReviews: {
              count: negativeReviews.productsWithChanges,
              products: (negativeReviews.alert?.products || []).map((p) => ({
                asin: p.asin,
                sku: p.sku,
                message: p.message,
                rating: p.rating,
                reviewCount: p.reviewCount,
              })),
            },
            buyBoxMissing: { count: 0, products: [] },
            aplusMissing: {
              count: aplusMissing.productsWithChanges,
              products: (aplusMissing.alert?.products || []).map((p) => ({
                asin: p.asin,
                sku: p.sku,
                message: p.message,
              })),
            },
          };
          const emailSent = await sendAlertsEmail(user.email, user.firstName || 'Seller', payload, undefined, userId);
          if (emailSent) {
            logger.info('[Alerts] Summary email sent after product content / negative reviews / A+ missing alerts', { userId });
          } else {
            logger.warn('[Alerts] Alerts email could not be sent (non-fatal)', { userId });
          }
        }
      } catch (emailErr) {
        logger.warn('[Alerts] Alerts email failed (non-fatal)', { userId, error: emailErr?.message });
      }
    }

    return {
      productContentChange,
      negativeReviews,
      aplusMissing,
    };
  } catch (error) {
    logger.error('[Alerts] Error in detectAndStoreAlerts', {
      userId,
      region,
      country,
      error: error?.message,
    });
    return {
      productContentChange: { created: false, productsWithChanges: 0 },
      negativeReviews: { created: false, productsWithChanges: 0 },
      aplusMissing: { created: false, productsWithChanges: 0 },
      error: error?.message,
    };
  }
}

module.exports = {
  detectAndStoreAlerts,
  getContentChanges,
  arraysEqual,
};

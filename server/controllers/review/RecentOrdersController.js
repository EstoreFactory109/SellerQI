const ReviewOrder = require("../../models/review/ReviewOrderModel");
const ReviewOrderItem = require("../../models/review/ReviewOrderItemModel");
const User = require("../../models/user-auth/userModel");

const DAY_MS = 24 * 60 * 60 * 1000;
// No delivery date is stored, so the request window (5-30 days after delivery) is
// placed from the order date: it has closed for an order about 35 days old.
const WINDOW_CLOSED_AFTER_DAYS = 35;
// Eligibility goes stale as the window moves; only a recent check counts as "now".
const ELIGIBILITY_FRESH_DAYS = 3;

/**
 * Pure: new ratings between two weekly snapshots.
 * - Variations share one rating count, so each (before, after) pair counts once
 *   (seen live: 30 variations all 180 -> 193 is 13 new ratings, not 390).
 * - A product missing from either snapshot, or at 0 before, is skipped (unknown).
 * - A jump no real listing makes in a month (to over 1.5x + 50) is a scrape of a
 *   different listing (seen live: 214 -> 32,887) and is skipped.
 * @returns {number}
 */
function newRatingsBetween(base, latest) {
  const before = new Map((base?.Products || []).map((p) => [p.asin, Number(p.product_num_ratings)]));
  const pairs = new Set();
  for (const p of latest?.Products || []) {
    const now = Number(p?.product_num_ratings);
    const was = before.get(p?.asin);
    if (!Number.isFinite(now) || !Number.isFinite(was) || !(was > 0) || !(now > was)) continue;
    if (now > was * 1.5 + 50) continue;
    pairs.add(`${was}>${now}`);
  }
  let total = 0;
  for (const pair of pairs) {
    const [was, now] = pair.split('>').map(Number);
    total += now - was;
  }
  return total;
}

/**
 * GET /api/review/recent-orders
 * Query params: page, limit
 *
 * Returns paginated recent orders for the current user with minimal fields.
 * Assumes auth + location middleware have set:
 * - req.userId
 * - req.country
 * - req.region
 */
const getRecentOrders = async (req, res) => {
  try {
    const userId = req.userId;
    const { country, region } = req;

    if (!userId || !country || !region) {
      return res.status(400).json({
        success: false,
        error: "Missing user context (userId, country, region).",
      });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const skip = (page - 1) * limit;

    const filter = {
      User: userId,
      country,
      region,
      isArchived: false,
    };

    const [orders, total] = await Promise.all([
      ReviewOrder.find(filter)
        .sort({ purchaseDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select({
          amazonOrderId: 1,
          purchaseDate: 1,
          orderStatus: 1,
          orderTotalAmount: 1,
          orderTotalCurrencyCode: 1,
          itemCount: 1,
          canRequestReview: 1,
          reviewRequestStatus: 1,
          reviewRequestLastSentAt: 1,
        })
        .lean(),
      ReviewOrder.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
      orders,
    });
  } catch (error) {
    console.error("❌ Error in getRecentOrders:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch recent orders",
    });
  }
};

/**
 * GET /api/review/order-items/:amazonOrderId
 * Query params: page, limit
 *
 * Returns paginated items for a specific order.
 * Only fetches essential display fields.
 */
const getOrderItems = async (req, res) => {
  try {
    const userId = req.userId;
    const { amazonOrderId } = req.params;

    if (!userId || !amazonOrderId) {
      return res.status(400).json({
        success: false,
        error: "Missing userId or amazonOrderId.",
      });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const skip = (page - 1) * limit;

    const filter = {
      User: userId,
      amazonOrderId,
    };

    const [items, total, order] = await Promise.all([
      ReviewOrderItem.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select({
          asin: 1,
          sellerSKU: 1,
          title: 1,
          quantityOrdered: 1,
          quantityShipped: 1,
          itemPrice: 1,
        })
        .lean(),
      ReviewOrderItem.countDocuments(filter),
      ReviewOrder.findOne({ User: userId, amazonOrderId })
        .select({ itemsFetchedAt: 1 })
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      amazonOrderId,
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
      items,
      // Lets the UI distinguish "this order genuinely has no items" from "item detail has not
      // been pulled for this order yet". Item enrichment is a capped best-effort backfill
      // prioritising the 5-30 day solicitation window, so an empty list is expected for
      // orders outside it. Without this flag an empty list looks like a data bug.
      itemsFetched: !!order?.itemsFetchedAt,
    });
  } catch (error) {
    console.error("❌ Error in getOrderItems:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch order items",
    });
  }
};

/**
 * GET /api/review/review-auth-status
 * Returns the current reviewRequestAuthStatus for the logged-in user.
 */
const getReviewAuthStatus = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(400).json({ success: false, error: "Missing userId." });
    }

    const user = await User.findById(userId)
      .select({ reviewRequestAuthStatus: 1 })
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    return res.status(200).json({
      success: true,
      reviewRequestAuthStatus: !!user.reviewRequestAuthStatus,
    });
  } catch (error) {
    console.error("Error in getReviewAuthStatus:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch review auth status",
    });
  }
};

/**
 * PATCH /api/review/review-auth-status
 * Body: { enabled: boolean }
 * Toggles reviewRequestAuthStatus for the logged-in user.
 */
const toggleReviewAuthStatus = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(400).json({ success: false, error: "Missing userId." });
    }

    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "'enabled' must be a boolean (true or false).",
      });
    }

    const user = await User.findById(userId).select({
      packageType: 1,
      subscriptionStatus: 1,
      isInTrialPeriod: 1,
    });

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    // ===== PAYMENT DISABLED - free PRO for all users =====
    // The LITE gate below used to block automatic review requests. Uncomment to restore.

    // if (
      // enabled &&
      // user.packageType === "LITE" &&
      // !user.isInTrialPeriod
    // ) {
      // return res.status(403).json({
        // success: false,
        // error: "Upgrade to PRO to enable automatic review requests.",
      // });
    // }

    await User.findByIdAndUpdate(userId, {
      reviewRequestAuthStatus: enabled,
    });

    return res.status(200).json({
      success: true,
      reviewRequestAuthStatus: enabled,
    });
  } catch (error) {
    console.error("Error in toggleReviewAuthStatus:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to update review auth status",
    });
  }
};

/**
 * GET /api/review/summary
 *
 * The four numbers at the top of the Review Requests page, for this marketplace:
 * - eligibleNow: Amazon allows a request (recent eligibility check) and none was sent
 * - inWindowUnchecked: orders in the request window by date (7-33 days old) that were
 *   never checked with Amazon (eligibility is checked only for some accounts and
 *   orders), shown as "may be eligible", never as confirmed
 * - requestedThisMonth: requests sent since the 1st (UTC)
 * - ratingsThisMonth: new ratings on the seller's products since the 1st, from the
 *   weekly ratings snapshots (Amazon does not link a review to an order); null when
 *   there is no snapshot from this month and one from before it
 * - windowClosedThisMonth: orders whose window closed this month with no request,
 *   leaving out orders Amazon never allows (eligibility answered with an error)
 */
const getReviewSummary = async (req, res) => {
  try {
    const userId = req.userId;
    const { country, region } = req;
    if (!userId || !country || !region) {
      return res.status(400).json({ success: false, error: "Missing user context (userId, country, region)." });
    }
    const NumberOfProductReviews = require("../../models/seller-performance/NumberOfProductReviewsModel.js");
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const base = { User: userId, country, region, isArchived: false };
    const neverSent = { $in: ["not_requested", "queued", "failed"] };

    const [eligibleNow, inWindowUnchecked, requestedThisMonth, windowClosedThisMonth, latestSnap, baseSnap] = await Promise.all([
      ReviewOrder.countDocuments({
        ...base,
        purchaseDate: { $gte: new Date(now.getTime() - 45 * DAY_MS) },
        canRequestReview: true,
        reviewRequestStatus: neverSent,
        eligibilityLastCheckedAt: { $gte: new Date(now.getTime() - ELIGIBILITY_FRESH_DAYS * DAY_MS) },
      }),
      ReviewOrder.countDocuments({
        ...base,
        purchaseDate: { $gte: new Date(now.getTime() - 33 * DAY_MS), $lt: new Date(now.getTime() - 7 * DAY_MS) },
        reviewRequestStatus: neverSent,
        eligibilityLastCheckedAt: null,
      }),
      ReviewOrder.countDocuments({
        ...base,
        purchaseDate: { $gte: new Date(monthStart.getTime() - 60 * DAY_MS) },
        reviewRequestStatus: "sent",
        reviewRequestLastSentAt: { $gte: monthStart },
      }),
      ReviewOrder.countDocuments({
        ...base,
        purchaseDate: {
          $gte: new Date(monthStart.getTime() - WINDOW_CLOSED_AFTER_DAYS * DAY_MS),
          $lt: new Date(now.getTime() - WINDOW_CLOSED_AFTER_DAYS * DAY_MS),
        },
        reviewRequestStatus: neverSent,
        "eligibilityResponse.errors.0": { $exists: false },
      }),
      NumberOfProductReviews.findOne({ User: userId, country, region, createdAt: { $gte: monthStart } })
        .sort({ createdAt: -1 }).select({ createdAt: 1, "Products.asin": 1, "Products.product_num_ratings": 1 }).lean(),
      NumberOfProductReviews.findOne({ User: userId, country, region, createdAt: { $lt: monthStart, $gte: new Date(monthStart.getTime() - 14 * DAY_MS) } })
        .sort({ createdAt: -1 }).select({ createdAt: 1, "Products.asin": 1, "Products.product_num_ratings": 1 }).lean(),
    ]);

    return res.status(200).json({
      success: true,
      monthStart,
      eligibleNow,
      inWindowUnchecked,
      requestedThisMonth,
      windowClosedThisMonth,
      ratingsThisMonth: latestSnap && baseSnap
        ? { count: newRatingsBetween(baseSnap, latestSnap), asOf: latestSnap.createdAt }
        : null,
    });
  } catch (error) {
    console.error("❌ Error in getReviewSummary:", error.message);
    return res.status(500).json({ success: false, error: error.message || "Failed to fetch review summary" });
  }
};

module.exports = {
  getReviewSummary,
  newRatingsBetween,
  getRecentOrders,
  getOrderItems,
  getReviewAuthStatus,
  toggleReviewAuthStatus,
};


const ReviewOrder = require("../../models/review/ReviewOrderModel");
const ReviewOrderItem = require("../../models/review/ReviewOrderItemModel");
const User = require("../../models/user-auth/userModel");

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

    const [items, total] = await Promise.all([
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

    if (
      enabled &&
      user.packageType === "LITE" &&
      !user.isInTrialPeriod
    ) {
      return res.status(403).json({
        success: false,
        error: "Upgrade to PRO to enable automatic review requests.",
      });
    }

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

module.exports = {
  getRecentOrders,
  getOrderItems,
  getReviewAuthStatus,
  toggleReviewAuthStatus,
};


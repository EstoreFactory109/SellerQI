const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/Auth/auth.js");
const { getLocation } = require("../middlewares/Auth/getLocation.js");
const {
  getRecentOrders,
  getOrderItems,
  getReviewAuthStatus,
  toggleReviewAuthStatus,
} = require("../controllers/review/RecentOrdersController");

// Protected routes: require auth + location context
router.get("/recent-orders", authMiddleware, getLocation, getRecentOrders);
router.get("/order-items/:amazonOrderId", authMiddleware, getLocation, getOrderItems);

// Review request auto-send toggle (auth only, no location needed)
router.get("/review-auth-status", authMiddleware, getReviewAuthStatus);
router.patch("/review-auth-status", authMiddleware, toggleReviewAuthStatus);

module.exports = router;


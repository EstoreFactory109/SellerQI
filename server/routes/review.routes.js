const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/Auth/auth.js");
const { getLocation } = require("../middlewares/Auth/getLocation.js");
const { getRecentOrders, getOrderItems } = require("../controllers/review/RecentOrdersController");

// Protected routes: require auth + location context
router.get("/recent-orders", authMiddleware, getLocation, getRecentOrders);
router.get("/order-items/:amazonOrderId", authMiddleware, getLocation, getOrderItems);

module.exports = router;


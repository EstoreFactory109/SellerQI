/**
 * Total Sales Filter Routes
 * 
 * Routes for filtering total sales component data from EconomicsMetrics model
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const { filterTotalSales } = require('../controllers/analytics/TotalSalesFilterController.js');

/**
 * GET /api/total-sales/filter
 * Query params:
 *   - startDate: YYYY-MM-DD (required for custom range)
 *   - endDate: YYYY-MM-DD (required for custom range)
 *   - periodType: last30|last7|custom (default: last30)
 */
router.get('/filter', auth, getLocation, filterTotalSales);

module.exports = router;


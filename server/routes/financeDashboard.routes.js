const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const {
  getFinanceDateRange,
  getFinanceDashboard,
  getFinanceAsinDetail,
  getFinanceAsinSnapshot,
  getFinanceSyncStatus,
} = require('../controllers/finance/FinanceDashboardController.js');

// Default date range from DataFetchTracking (profitability bootstrap)
router.get('/date-range', auth, getLocation, getFinanceDateRange);

// Full dashboard: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get('/', auth, getLocation, getFinanceDashboard);

// Single ASIN snapshot (product details page): /asin/:asin/snapshot?startDate=...&endDate=...
router.get('/asin/:asin/snapshot', auth, getLocation, getFinanceAsinSnapshot);

// Single ASIN day-by-day: /asin/:asin?startDate=...&endDate=...
router.get('/asin/:asin', auth, getLocation, getFinanceAsinDetail);

// Sync status (available date range)
router.get('/sync-status', auth, getLocation, getFinanceSyncStatus);

module.exports = router;

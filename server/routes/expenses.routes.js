const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const {
  getTotalExpensesByPeriod,
  getTotalExpensesByDateRange,
  getTotalAmazonFeesByPeriod,
  getTotalAmazonFeesByDateRange,
  getAsinWiseExpensesByPeriod,
  getAsinWiseExpensesByDateRange,
  getRefundsByPeriod,
  getRefundsByDateRange,
  getExpenseReportSnapshot,
} = require('../controllers/finance/ExpenseController.js');

// Pre-calculated expense report (latest ExpenseReportRun + aggregates)
router.get('/snapshot', auth, getLocation, getExpenseReportSnapshot);

// 1) Total expenses (last 7/14/30 days): ?period=7|14|30
router.get('/total', auth, getLocation, getTotalExpensesByPeriod);

// 2) Total expenses (custom date range): ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/total/date-range', auth, getLocation, getTotalExpensesByDateRange);

// 3) Total Amazon fees (last 7/14/30 days): ?period=7|14|30
router.get('/amazon-fees', auth, getLocation, getTotalAmazonFeesByPeriod);

// 4) Total Amazon fees (custom date range): ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/amazon-fees/date-range', auth, getLocation, getTotalAmazonFeesByDateRange);

// 5) ASIN-wise expenses (last 7/14/30 days): ?period=7|14|30
router.get('/asin-wise', auth, getLocation, getAsinWiseExpensesByPeriod);

// 6) ASIN-wise expenses (custom date range): ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/asin-wise/date-range', auth, getLocation, getAsinWiseExpensesByDateRange);

// 7) Refunds (last 7/14/30 days): ?period=7|14|30
router.get('/refunds', auth, getLocation, getRefundsByPeriod);

// 8) Refunds (custom date range): ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/refunds/date-range', auth, getLocation, getRefundsByDateRange);

module.exports = router;


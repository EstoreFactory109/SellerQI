const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const {
  getSummaryByPeriod,
  getSummaryByDateRange,
  getChartByPeriod,
  getChartByDateRange,
  getTableByPeriod,
  getTableByDateRange,
  getAsinTableSnapshot,
} = require('../controllers/finance/ProfitabilityController.js');

router.get('/asin/:asin/snapshot', auth, getLocation, getAsinTableSnapshot);

router.get('/summary', auth, getLocation, getSummaryByPeriod);
router.get('/summary/date-range', auth, getLocation, getSummaryByDateRange);

router.get('/chart', auth, getLocation, getChartByPeriod);
router.get('/chart/date-range', auth, getLocation, getChartByDateRange);

router.get('/table', auth, getLocation, getTableByPeriod);
router.get('/table/date-range', auth, getLocation, getTableByDateRange);

module.exports = router;

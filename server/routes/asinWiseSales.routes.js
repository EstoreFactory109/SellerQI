const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const {
  getAsinWiseSalesByPeriod,
  getAsinWiseSalesByDateRange,
} = require('../controllers/finance/AsinWiseSalesController.js');

// 1) ASIN-wise sales for fixed periods: ?period=7|14|30
router.get('/', auth, getLocation, getAsinWiseSalesByPeriod);

// 2) ASIN-wise sales for custom date range: ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/date-range', auth, getLocation, getAsinWiseSalesByDateRange);

module.exports = router;


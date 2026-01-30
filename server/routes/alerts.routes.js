/**
 * alerts.routes.js
 *
 * Alerts API for the frontend. All alert types live in one collection (alerts);
 * these routes return a unified list.
 *
 * - GET /api/alerts - List alerts for the current user/location (auth + getLocation required)
 * - GET /api/alerts/latest?limit=N - Get last N alerts (auth + getLocation required)
 * - PATCH /api/alerts/:id/viewed - Mark alert as viewed (auth required)
 * - POST /api/alerts/test - Run full alerts detection (body: userId, country, region)
 * - POST /api/alerts/testProductContentChange - Run product content change + negative reviews only (body: userId, country, region)
 * - POST /api/alerts/testBuyBoxMissing - Run buybox missing detection only (body: userId, country, region)
 * - POST /api/alerts/testSalesDrop - Run sales drop detection (body: userId, country, region; optional: startDate, endDate, unitsDropThresholdPct, revenueDropThresholdPct)
 * - POST /api/alerts/testConversionRates - Get conversion rates for last 7 days (body: userId, country, region; optional: startDate, endDate)
 * - POST /api/alerts/testLowInventory - Run low inventory / out of stock detection (body: userId, country, region)
 * - POST /api/alerts/testStrandedInventory - Run stranded inventory detection (body: userId, country, region)
 * - POST /api/alerts/testInboundShipment - Run inbound shipment issues detection (body: userId, country, region)
 * - POST /api/alerts/testInventoryAlerts - Run all three inventory alerts (body: userId, country, region)
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const {
  getAlerts,
  getLatestAlerts,
  updateAlertViewed,
  testAlerts,
  testProductContentChangeAlerts,
  testBuyBoxMissingAlerts,
  testSalesDrop,
  testConversionRates,
  testLowInventoryAlerts,
  testStrandedInventoryAlerts,
  testInboundShipmentAlerts,
  testInventoryAlerts,
} = require('../controllers/alerts/AlertsController.js');

router.get('/', auth, getLocation, getAlerts);
router.get('/latest', auth, getLocation, getLatestAlerts);
router.patch('/:id/viewed', auth, updateAlertViewed);

// Test endpoints (body: userId, country, region)
router.post('/test', testAlerts);
router.post('/testProductContentChange', testProductContentChangeAlerts);
router.post('/testBuyBoxMissing', testBuyBoxMissingAlerts);
router.post('/testSalesDrop', testSalesDrop);
router.post('/testConversionRates', testConversionRates);
router.post('/testLowInventory', testLowInventoryAlerts);
router.post('/testStrandedInventory', testStrandedInventoryAlerts);
router.post('/testInboundShipment', testInboundShipmentAlerts);
router.post('/testInventoryAlerts', testInventoryAlerts);

module.exports = router;

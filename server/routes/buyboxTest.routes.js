/**
 * BuyBox Test Routes
 * 
 * REST routes for testing BuyBox functionality
 * All routes accept POST requests with data in request body
 * No authentication required (for testing purposes)
 */

const express = require('express');
const router = express.Router();

const {
    testFetchBuyBoxData,
    testGetBuyBoxData,
    testGetBuyBoxSummary
} = require('../controllers/mcp/BuyBoxTestController.js');

// Test route to verify routing is working
router.get('/test', (req, res) => {
    res.json({
        statusCode: 200,
        message: 'BuyBox test route is working',
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/test/buybox/fetch
 * Fetch and store BuyBox data from MCP Data Kiosk API
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc",
 *   "startDate": "YYYY-MM-DD" (optional, defaults to 30 days ago),
 *   "endDate": "YYYY-MM-DD" (optional, defaults to today)
 * }
 * 
 * Example:
 * POST /api/test/buybox/fetch
 * Body: {
 *   "userId": "507f1f77bcf86cd799439011",
 *   "region": "FE",
 *   "country": "AU",
 *   "startDate": "2024-11-01",
 *   "endDate": "2024-11-30"
 * }
 */
router.post('/fetch', testFetchBuyBoxData);

/**
 * POST /api/test/buybox/get
 * Get BuyBox data from database
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc",
 *   "startDate": "YYYY-MM-DD" (optional),
 *   "endDate": "YYYY-MM-DD" (optional)
 * }
 * 
 * If startDate and endDate are provided, returns all records in that range.
 * Otherwise, returns the latest record.
 * 
 * Example:
 * POST /api/test/buybox/get
 * Body: {
 *   "userId": "507f1f77bcf86cd799439011",
 *   "region": "FE",
 *   "country": "AU"
 * }
 */
router.post('/get', testGetBuyBoxData);

/**
 * POST /api/test/buybox/summary
 * Get BuyBox summary (products without buybox count)
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc"
 * }
 * 
 * Returns a summary with:
 * - totalProducts
 * - productsWithBuyBox
 * - productsWithoutBuyBox
 * - productsWithLowBuyBox
 * 
 * Example:
 * POST /api/test/buybox/summary
 * Body: {
 *   "userId": "507f1f77bcf86cd799439011",
 *   "region": "FE",
 *   "country": "AU"
 * }
 */
router.post('/summary', testGetBuyBoxSummary);

module.exports = router;


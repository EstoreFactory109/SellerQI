/**
 * MCP Economics Test Routes
 * No auth – intended for manual testing.
 */

const express = require('express');
const router = express.Router();

const {
    testFetchEconomicsData
} = require('../controllers/mcp/EconomicsTestController.js');

// Health check
router.get('/test', (req, res) => {
    res.json({
        statusCode: 200,
        message: 'MCP economics test route is working',
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/test/mcp-economics/fetch
 * Body: { userId, region, country, refreshToken? }
 */
router.post('/fetch', testFetchEconomicsData);

module.exports = router;


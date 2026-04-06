/**
 * MCP Sales-only Test Routes
 * No auth – intended for manual testing.
 */

const express = require('express');
const router = express.Router();

const {
  testGetSalesOnlyByDateRange,
} = require('../controllers/mcp/SalesOnlyTestController.js');

// Health check
router.get('/test', (req, res) => {
  res.json({
    statusCode: 200,
    message: 'MCP sales-only test route is working',
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/test/mcp-sales-only/date-range
 * Body: { userId, country, region, startDate, endDate }
 */
router.post('/date-range', testGetSalesOnlyByDateRange);

module.exports = router;


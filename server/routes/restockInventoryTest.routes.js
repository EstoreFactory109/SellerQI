/**
 * Restock Inventory Recommendations Test Routes
 *
 * POST /api/test/restock-inventory
 *
 * Accepts: { userId, region, country }
 */

const express = require('express');
const router = express.Router();

const {
    testRestockInventoryReport
} = require('../controllers/test/RestockInventoryTestController.js');

// Health check
router.get('/test', (req, res) => {
    res.json({
        statusCode: 200,
        message: 'Restock Inventory test route is working',
        endpoint: 'POST /api/test/restock-inventory',
        body: {
            userId: 'string (required)',
            region: 'string (required) - NA, EU, FE',
            country: 'string (required) - US, CA, UK, etc.'
        },
        timestamp: new Date().toISOString()
    });
});

// Main endpoint
router.post('/', testRestockInventoryReport);

module.exports = router;


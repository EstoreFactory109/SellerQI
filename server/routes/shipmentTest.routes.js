/**
 * Shipment Test Routes
 *
 * POST /api/test/shipment - Test shipment data fetching with new date filtering
 *
 * Accepts: { userId, region, country }
 */

const express = require('express');
const router = express.Router();

const {
    testShipmentData
} = require('../controllers/test/ShipmentTestController.js');

// Health check
router.get('/test', (req, res) => {
    res.json({
        statusCode: 200,
        message: 'Shipment test route is working',
        endpoint: 'POST /api/test/shipment',
        description: 'Test endpoint to fetch shipment data using new API date filtering (last 30 days)',
        body: {
            userId: 'string (required) - MongoDB user ID',
            region: 'string (required) - NA, EU, or FE',
            country: 'string (required) - US, CA, UK, AU, etc.'
        },
        features: [
            'Fetches CLOSED shipments from last 30 days using DATE_RANGE query',
            'Uses UTC date format with Z suffix (ISO 8601)',
            'Includes pagination support for large result sets',
            'Validates and filters shipments before storage',
            'Prevents duplicate shipments'
        ],
        timestamp: new Date().toISOString()
    });
});

// Main endpoint - Test shipment data fetching
router.post('/', testShipmentData);

module.exports = router;


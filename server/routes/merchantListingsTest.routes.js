/**
 * MerchantListingsTest Routes
 * 
 * REST routes for testing GET_MERCHANT_LISTINGS_ALL_DATA API functionality
 * 
 * Endpoints:
 * - POST /api/test/merchant-listings/test - Test fetching merchant listings report
 * - GET /api/test/merchant-listings/view/:userId - View merchant listings data stored in database
 */

const express = require('express');
const router = express.Router();

const {
    testMerchantListings,
    viewMerchantListings
} = require('../controllers/test/MerchantListingsTestController.js');

// Test route to verify routing is working
router.get('/test', (req, res) => {
    res.json({
        statusCode: 200,
        message: 'Merchant Listings test routes are working',
        availableEndpoints: [
            'POST /test - Test fetching merchant listings report',
            'GET /view/:userId?country=US&region=NA - View merchant listings data stored in database'
        ],
        timestamp: new Date().toISOString()
    });
});

// Test fetching merchant listings report
router.post('/test', testMerchantListings);

// View merchant listings data stored in database
router.get('/view/:userId', viewMerchantListings);

module.exports = router;

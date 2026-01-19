/**
 * ActiveProductsTest Routes
 * 
 * REST routes for testing active products listing API functionality
 * 
 * Endpoints:
 * - POST /api/test/active-products/test-single - Test fetching listing data for a single active SKU
 * - POST /api/test/active-products/process-all - Process all active SKUs for a user
 * - GET /api/test/active-products/view/:userId - View active products with listing data
 * - POST /api/test/active-products/check - Check if B2B pricing is stored in database
 */

const express = require('express');
const router = express.Router();

const {
    testSingleActiveProduct,
    testProcessAllActiveProducts,
    viewActiveProducts,
    checkB2BPricingInDatabase
} = require('../controllers/test/ActiveProductsTestController.js');

// Test route to verify routing is working
router.get('/test', (req, res) => {
    res.json({
        statusCode: 200,
        message: 'Active Products test routes are working',
        availableEndpoints: [
            'POST /test-single - Test fetching listing data for a single active SKU',
            'POST /process-all - Process all active SKUs for a user',
            'GET /view/:userId?country=US&region=NA - View active products with listing data',
            'POST /check - Check if B2B pricing is stored in database'
        ],
        timestamp: new Date().toISOString()
    });
});

// Test fetching listing data for a single active SKU
router.post('/test-single', testSingleActiveProduct);

// Process all active SKUs
router.post('/process-all', testProcessAllActiveProducts);

// View active products with listing data
router.get('/view/:userId', viewActiveProducts);

// Check if B2B pricing is stored in database
router.post('/check', checkB2BPricingInDatabase);

module.exports = router;

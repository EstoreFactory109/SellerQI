/**
 * InactiveSKUIssuesTest Routes
 * 
 * REST routes for testing inactive SKU issues functionality
 * 
 * Endpoints:
 * - POST /api/test/inactive-sku-issues/test-single - Test fetching issues for a single SKU
 * - POST /api/test/inactive-sku-issues/process-all - Process all inactive SKUs for a user
 * - GET /api/test/inactive-sku-issues/view/:userId - View inactive products with issues
 * - POST /api/test/inactive-sku-issues/check - Check if issues are stored in database
 */

const express = require('express');
const router = express.Router();

const {
    testSingleSKUIssues,
    testProcessAllInactiveSKUs,
    viewInactiveProductsWithIssues,
    checkIssuesInDatabase
} = require('../controllers/test/InactiveSKUIssuesTestController.js');

// Test route to verify routing is working
router.get('/test', (req, res) => {
    res.json({
        statusCode: 200,
        message: 'Inactive SKU Issues test routes are working',
        availableEndpoints: [
            'POST /test-single - Test fetching issues for a single SKU',
            'POST /process-all - Process all inactive SKUs for a user',
            'GET /view/:userId?country=US&region=NA - View inactive products with issues',
            'POST /check - Check if issues are stored in database'
        ],
        timestamp: new Date().toISOString()
    });
});

// Test fetching issues for a single SKU
router.post('/test-single', testSingleSKUIssues);

// Process all inactive SKUs
router.post('/process-all', testProcessAllInactiveSKUs);

// View inactive products with issues
router.get('/view/:userId', viewInactiveProductsWithIssues);

// Check if issues are stored in database
router.post('/check', checkIssuesInDatabase);

module.exports = router;

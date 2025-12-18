/**
 * Search Terms Test Routes
 * 
 * REST routes for testing Search Terms functionality with adGroup support
 * All routes accept POST requests with data in request body
 * No authentication required (for Postman testing)
 */

const express = require('express');
const router = express.Router();

const {
    testGetSearchTerms,
    testFilterSearchTerms,
    testGetSearchTermsStats,
    testFetchSearchTerms
} = require('../controllers/test/SearchTermsTestController.js');

// Test route to verify routing is working
router.get('/test', (req, res) => {
    console.log('✅ [Route] GET /test endpoint hit');
    res.json({
        statusCode: 200,
        message: 'Search Terms test route is working',
        timestamp: new Date().toISOString()
    });
});

// Test POST route to verify POST requests work
router.post('/test', (req, res) => {
    console.log('✅ [Route] POST /test endpoint hit', { body: req.body });
    res.json({
        statusCode: 200,
        message: 'Search Terms POST test route is working',
        receivedBody: req.body,
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/test/search-terms/fetch
 * Fetch new search terms data from Amazon Ads API
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc",
 *   "refreshToken": "optional_refresh_token",
 *   "accessToken": "optional_access_token",
 *   "profileId": "optional_profile_id"
 * }
 * 
 * Example:
 * POST /api/test/search-terms/fetch
 * Body: {
 *   "userId": "507f1f77bcf86cd799439011",
 *   "region": "NA",
 *   "country": "US"
 * }
 * 
 * Note: If refreshToken, accessToken, or profileId are not provided,
 * they will be fetched from the seller account.
 * 
 * Returns:
 * - Success status
 * - Number of search terms fetched
 * - Sample of saved data
 */
router.post('/fetch', (req, res, next) => {
    console.log('🔵 [Route] /fetch endpoint hit', {
        method: req.method,
        url: req.url,
        path: req.path,
        bodyKeys: Object.keys(req.body || {}),
        timestamp: new Date().toISOString()
    });
    next();
}, testFetchSearchTerms);

/**
 * POST /api/test/search-terms/get
 * Get search terms data from database
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc"
 * }
 * 
 * Example:
 * POST /api/test/search-terms/get
 * Body: {
 *   "userId": "507f1f77bcf86cd799439011",
 *   "region": "NA",
 *   "country": "US"
 * }
 * 
 * Returns:
 * - All search terms with adGroup information
 * - Statistics about adGroup coverage
 * - Sample of first 5 search terms
 */
router.post('/get', testGetSearchTerms);

/**
 * POST /api/test/search-terms/filter
 * Filter search terms with various criteria
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc",
 *   "filters": {
 *     "minClicks": 10,
 *     "maxClicks": null,
 *     "zeroSales": true,
 *     "hasAdGroup": true,
 *     "campaignId": "campaign_id",
 *     "adGroupId": "adgroup_id",
 *     "searchTerm": "keyword to search"
 *   }
 * }
 * 
 * Example:
 * POST /api/test/search-terms/filter
 * Body: {
 *   "userId": "507f1f77bcf86cd799439011",
 *   "region": "NA",
 *   "country": "US",
 *   "filters": {
 *     "minClicks": 10,
 *     "zeroSales": true,
 *     "hasAdGroup": true
 *   }
 * }
 * 
 * Returns filtered search terms based on criteria
 */
router.post('/filter', testFilterSearchTerms);

/**
 * POST /api/test/search-terms/stats
 * Get statistics about search terms with adGroup breakdown
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc"
 * }
 * 
 * Example:
 * POST /api/test/search-terms/stats
 * Body: {
 *   "userId": "507f1f77bcf86cd799439011",
 *   "region": "NA",
 *   "country": "US"
 * }
 * 
 * Returns:
 * - Overall statistics (total, clicks, sales, spend, etc.)
 * - AdGroup coverage statistics
 * - AdGroup breakdown with performance metrics
 */
router.post('/stats', testGetSearchTermsStats);

module.exports = router;


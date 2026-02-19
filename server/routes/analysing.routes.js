const express=require('express');
const router=express.Router();

const {
    analysingController, 
    getDataFromDate,
    getUserLoggingSessions,
    getLoggingSessionDetails,
    getUserLoggingStats,
    getUserErrorLogs,
    getUserEmailLogs,
    getMyPaymentLogs,
    createSampleLoggingData,
    getKeywordRecommendations,
    getKeywordRecommendationsAsins,
    getKeywordRecommendationsByAsin,
    // New optimized keyword opportunities endpoints
    getKeywordOpportunitiesInitial,
    getKeywordOpportunitiesForAsin,
    searchKeywordOpportunitiesAsins,
    getKeywordOpportunitiesAsinsList
} = require('../controllers/analytics/AnalysingController.js')
const auth=require('../middlewares/Auth/auth.js')
const {getLocation}=require('../middlewares/Auth/getLocation.js')
const {analyseDataCache}=require('../middlewares/redisCache.js')

router.get('/getData',auth,getLocation,analyseDataCache(3600),analysingController)
router.get('/getDataFromDate',auth,getLocation,getDataFromDate)

// ===== USER LOGGING DATA ROUTES =====
router.get('/logging/sessions', auth, getUserLoggingSessions)
router.get('/logging/session/:sessionId', auth, getLoggingSessionDetails)
router.get('/logging/stats', auth, getUserLoggingStats)
router.get('/logging/errors', auth, getUserErrorLogs)
router.get('/logging/emails', auth, getUserEmailLogs)
router.get('/logging/payment-logs', auth, getMyPaymentLogs)
router.post('/logging/create-sample', auth, createSampleLoggingData)

// ===== KEYWORD RECOMMENDATIONS ROUTES (Legacy) =====
// Cache TTL: 1 hour for keyword data (data doesn't change frequently)
router.get('/keywordRecommendations', auth, getLocation, analyseDataCache(3600, 'keyword-recs'), getKeywordRecommendations)
router.get('/keywordRecommendations/asins', auth, getLocation, analyseDataCache(3600, 'keyword-asins'), getKeywordRecommendationsAsins)
router.get('/keywordRecommendations/byAsin', auth, getLocation, getKeywordRecommendationsByAsin) // Not cached as ASIN is dynamic

// ===== KEYWORD OPPORTUNITIES ROUTES (Optimized v2) =====
// Initial page load - returns first ASIN with summary and paginated keywords
router.get('/keywordOpportunities/initial', auth, getLocation, analyseDataCache(3600, 'kw-opp-initial'), getKeywordOpportunitiesInitial)
// Get paginated keywords for specific ASIN (with filter support)
router.get('/keywordOpportunities/keywords', auth, getLocation, getKeywordOpportunitiesForAsin) // Not cached - dynamic params
// Search ASINs by ASIN, SKU, or product name
router.get('/keywordOpportunities/search', auth, getLocation, searchKeywordOpportunitiesAsins) // Not cached - search queries
// Get all ASINs list with summary (for dropdown)
router.get('/keywordOpportunities/asins', auth, getLocation, analyseDataCache(3600, 'kw-opp-asins'), getKeywordOpportunitiesAsinsList)

module.exports=router;
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
    getKeywordRecommendationsByAsin
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

// ===== KEYWORD RECOMMENDATIONS ROUTES =====
// Cache TTL: 1 hour for keyword data (data doesn't change frequently)
router.get('/keywordRecommendations', auth, getLocation, analyseDataCache(3600, 'keyword-recs'), getKeywordRecommendations)
router.get('/keywordRecommendations/asins', auth, getLocation, analyseDataCache(3600, 'keyword-asins'), getKeywordRecommendationsAsins)
router.get('/keywordRecommendations/byAsin', auth, getLocation, getKeywordRecommendationsByAsin) // Not cached as ASIN is dynamic

module.exports=router;
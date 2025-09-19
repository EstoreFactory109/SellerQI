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
    createSampleLoggingData
} = require('../controllers/AnalysingController.js')
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
router.post('/logging/create-sample', auth, createSampleLoggingData)


module.exports=router;
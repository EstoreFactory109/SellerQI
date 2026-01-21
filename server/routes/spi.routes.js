const express=require('express');
const auth=require('../middlewares/Auth/auth.js')
const {getSpApiData}=require('../controllers/analytics/SpApiDataController.js')
const {getLocation}=require('../middlewares/Auth/getLocation.js')
// Import subscription middleware for premium features
const { requirePaid, getSubscriptionInfo } = require('../middlewares/Auth/checkSubscription.js');
const { analyticsRateLimiter } = require('../middlewares/rateLimiting.js');

const router=express.Router();

// Updated: Allow all authenticated users to access SP API data
router.get('/getSpApiData', analyticsRateLimiter, auth, getLocation, getSubscriptionInfo, getSpApiData)

module.exports=router;
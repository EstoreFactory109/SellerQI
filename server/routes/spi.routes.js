const express=require('express');
const auth=require('../middlewares/Auth/auth.js')
const {getSpApiData}=require('../controllers/SpApiDataController.js')
const {getLocation}=require('../middlewares/Auth/getLocation.js')
// Import subscription middleware for premium features
const { requirePaid, getSubscriptionInfo } = require('../middlewares/Auth/checkSubscription.js');

const router=express.Router();

// Updated: Allow all authenticated users to access SP API data
// Since competitive pricing is disabled, this endpoint is now available to all users
router.get('/getSpApiData',auth,getLocation,getSpApiData)

module.exports=router;
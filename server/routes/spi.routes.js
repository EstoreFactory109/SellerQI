const express=require('express');
const auth=require('../middlewares/Auth/auth.js')
const {getSpApiData}=require('../controllers/SpApiDataController.js')
const {getLocation}=require('../middlewares/Auth/getLocation.js')
// Import subscription middleware for premium features
const { requirePaid } = require('../middlewares/Auth/checkSubscription.js');

const router=express.Router();

// Example: Protect SP API data route with paid subscription requirement
// This route now requires PRO or AGENCY subscription
router.get('/getSpApiData',auth,requirePaid,getLocation,getSpApiData)

module.exports=router;
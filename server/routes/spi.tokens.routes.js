const {generateSPAPITokens,SaveAllDetails,generateAmazonAdsTokens}=require('../controllers/TokenControllers');
const auth =require('../middlewares/Auth/auth.js')
const {getLocation}=require('../middlewares/Auth/getLocation.js');
const express=require('express');
const router=express.Router();

router.post('/generateSPAPITokens',auth,getLocation,generateSPAPITokens);
router.post('/SaveAllDetails',auth,SaveAllDetails);
router.post('/generateAdsTokens',auth,getLocation,generateAmazonAdsTokens);

module.exports=router;
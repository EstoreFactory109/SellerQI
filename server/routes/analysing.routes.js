const express=require('express');
const router=express.Router();

const {analysingController, getDataFromDate}=require('../controllers/AnalysingController.js')
const {auth}=require('../middlewares/Auth/auth.js')
const {getLocation}=require('../middlewares/Auth/getLocation.js')
const {analyseDataCache}=require('../middlewares/redisCache.js')

router.get('/getData',auth,getLocation,analyseDataCache(3600),analysingController)
router.get('/getDataFromDate',auth,getLocation,getDataFromDate)


module.exports=router;
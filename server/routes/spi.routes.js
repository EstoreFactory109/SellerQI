const express=require('express');
const auth=require('../middlewares/Auth/auth.js')
const {getSpApiData}=require('../controllers/SpApiDataController.js')
const {getLocation}=require('../middlewares/Auth/getLocation.js')

const router=express.Router();



router.get('/getSpApiData',auth,getLocation,getSpApiData)

module.exports=router;
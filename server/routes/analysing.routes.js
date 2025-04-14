const express=require('express');
const router=express.Router();

const {analysingController}=require('../controllers/AnalysingController.js')
const auth=require('../middlewares/Auth/auth.js')
const {getLocation}=require('../middlewares/Auth/getLocation.js')

router.get('/getData',auth,getLocation,analysingController)


module.exports=router;
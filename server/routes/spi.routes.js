const express=require('express');
const auth=require('../middlewares/Auth/auth.js')
const {getSpApiData}=require('../controllers/SpApiDataController.js')

const router=express.Router();



router.get('/getSpApiData',auth,getSpApiData)

module.exports=router;
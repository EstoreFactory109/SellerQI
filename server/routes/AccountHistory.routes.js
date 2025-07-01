const express=require('express');
const {AddAccountHistory,getAccountHistory}=require('../controllers/AccountHistoryController.js')
const {auth}=require('../middlewares/Auth/auth.js')
const {getLocation}=require('../middlewares/Auth/getLocation.js')
const router=express.Router();


router.post('/addAccountHistory',auth,getLocation,AddAccountHistory);
router.get('/getAccountHistory',auth,getLocation,getAccountHistory);

module.exports=router


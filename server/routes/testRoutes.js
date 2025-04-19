const express=require('express');
const router=express.Router();
const {testReport,getTotalSales,getReviewData}=require('../controllers/TestController.js')
router.post('/testreport',testReport);
router.get('/totalsales',getTotalSales);
router.get('/getReviewData',getReviewData)
module.exports=router
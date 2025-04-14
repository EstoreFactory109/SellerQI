const express=require('express');
const router=express.Router();
const {testReport,getTotalSales}=require('../controllers/TestController.js')
router.post('/testreport',testReport);
router.get('/totalsales',getTotalSales);
module.exports=router
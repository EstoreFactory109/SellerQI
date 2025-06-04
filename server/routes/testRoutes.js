const express=require('express');
const router=express.Router();
const {testReport,getTotalSales,getReviewData,testAmazonAds,
    testPPCSpendsSalesUnitsSold,testGetCampaigns,testCampaignPerformanceReport,
    testGetAdGroups,testGetKeywords,testGetPPCSpendsBySKU,testListFinancialEvents}=require('../controllers/TestController.js')

    
router.post('/testreport',testReport);
router.get('/totalsales',getTotalSales);
router.get('/getReviewData',getReviewData)
router.post('/testAmazonAds',testAmazonAds)
router.post('/testPPCSpendsSalesUnitsSold',testPPCSpendsSalesUnitsSold)
router.post('/testGetCampaigns',testGetCampaigns)
router.post('/testCampaignPerformanceReport',testCampaignPerformanceReport)
router.post('/testGetAdGroups',testGetAdGroups)
router.post('/testGetKeywords',testGetKeywords)
router.post('/testGetPPCSpendsBySKU',testGetPPCSpendsBySKU)
router.get('/testListFinancialEvents',testListFinancialEvents)


module.exports=router
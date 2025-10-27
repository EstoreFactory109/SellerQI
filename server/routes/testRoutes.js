const express=require('express');
const router=express.Router();
const {testReport,getTotalSales,getReviewData,testAmazonAds,
    testPPCSpendsSalesUnitsSold,testGetCampaigns,
    testGetAdGroups,testGetKeywords,testGetPPCSpendsBySKU,testListFinancialEvents,
    testGetBrand,testSendEmailOnRegistered,testKeywordDataIntegration}=require('../controllers/TestController.js')

    
router.post('/testreport',testReport);
router.get('/totalsales',getTotalSales);
router.get('/getReviewData',getReviewData)
router.post('/testAmazonAds',testAmazonAds)
router.post('/testPPCSpendsSalesUnitsSold',testPPCSpendsSalesUnitsSold)
router.post('/testGetCampaigns',testGetCampaigns)
router.post('/testGetAdGroups',testGetAdGroups)
router.post('/testGetKeywords',testGetKeywords)
router.post('/testGetPPCSpendsBySKU',testGetPPCSpendsBySKU)
router.get('/testListFinancialEvents',testListFinancialEvents)
router.post('/testGetBrand',testGetBrand)
router.post('/testSendEmailOnRegistered',testSendEmailOnRegistered)
router.post('/testKeywordDataIntegration',testKeywordDataIntegration)

module.exports=router
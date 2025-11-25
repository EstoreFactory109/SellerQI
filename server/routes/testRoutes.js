const express=require('express');
const router=express.Router();
const {testReport,getTotalSales,getReviewData,testAmazonAds,
    testPPCSpendsSalesUnitsSold,testGetCampaigns,
    testGetAdGroups,testGetKeywords,testGetPPCSpendsBySKU,testListFinancialEvents,
    testGetBrand,testSendEmailOnRegistered,testKeywordDataIntegration,testLedgerSummaryReport,testGetProductWiseFBAData,testCalculateBackendLostInventory,testGetBackendLostInventory,testAllReimbursementAPIs,getAllReimbursementData,testGetWastedSpendKeywords,testSearchKeywords,testFbaInventoryPlanningData}=require('../controllers/TestController.js')

    
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
router.post('/testLedgerSummaryReport',testLedgerSummaryReport)
router.post('/testGetProductWiseFBAData',testGetProductWiseFBAData)
router.post('/testCalculateBackendLostInventory',testCalculateBackendLostInventory)
router.post('/testGetBackendLostInventory',testGetBackendLostInventory)
router.post('/testAllReimbursementAPIs',testAllReimbursementAPIs)
router.get('/getAllReimbursementData',getAllReimbursementData)
router.post('/testGetWastedSpendKeywords',testGetWastedSpendKeywords)
router.post('/testSearchKeywords',testSearchKeywords)
router.post('/testFbaInventoryPlanningData',testFbaInventoryPlanningData)

module.exports=router
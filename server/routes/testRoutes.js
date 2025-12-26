const express=require('express');
const router=express.Router();
const {testReport,getTotalSales,getReviewData,testAmazonAds,
    testGetCampaigns,
    testGetAdGroups,testGetKeywords,testGetPPCSpendsBySKU,
    testGetBrand,testSendEmailOnRegistered,testLedgerSummaryReport,testGetProductWiseFBAData,testGetWastedSpendKeywords,testSearchKeywords,testFbaInventoryPlanningData,testKeywordRecommendations,
    testKeywordRecommendationsFromDB,getStoredKeywordRecommendations,testPPCMetrics}=require('../controllers/test/TestController.js')

    
router.post('/testreport',testReport);
router.get('/totalsales',getTotalSales);
router.get('/getReviewData',getReviewData)
router.post('/testAmazonAds',testAmazonAds)
router.post('/testGetCampaigns',testGetCampaigns)
router.post('/testGetAdGroups',testGetAdGroups)
router.post('/testGetKeywords',testGetKeywords)
router.post('/testGetPPCSpendsBySKU',testGetPPCSpendsBySKU)
router.post('/testGetBrand',testGetBrand)
router.post('/testSendEmailOnRegistered',testSendEmailOnRegistered)
router.post('/testLedgerSummaryReport',testLedgerSummaryReport)
router.post('/testGetProductWiseFBAData',testGetProductWiseFBAData)
router.post('/testGetWastedSpendKeywords',testGetWastedSpendKeywords)
router.post('/testSearchKeywords',testSearchKeywords)
router.post('/testFbaInventoryPlanningData',testFbaInventoryPlanningData)
router.post('/testKeywordRecommendations',testKeywordRecommendations)

// NEW: ASIN-wise keyword recommendations routes
router.post('/testKeywordRecommendationsFromDB',testKeywordRecommendationsFromDB)  // Fetch ASINs from DB and process
router.get('/getStoredKeywordRecommendations',getStoredKeywordRecommendations)      // Get stored keywords

// PPC Metrics - Aggregated PPC data (sales, spend, ACOS, date-wise metrics)
router.post('/testPPCMetrics',testPPCMetrics)  // Fetch aggregated PPC metrics from SP, SB, SD campaigns

module.exports=router
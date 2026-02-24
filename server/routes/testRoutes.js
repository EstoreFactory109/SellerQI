const express=require('express');
const router=express.Router();
const {testReport,getTotalSales,getReviewData,testAmazonAds,
    testGetCampaigns,
    testGetAdGroups,testGetKeywords,testGetPPCSpendsBySKU,
    testGetBrand,testSendEmailOnRegistered,testLedgerSummaryReport,testGetProductWiseFBAData,testGetWastedSpendKeywords,testSearchKeywords,testFbaInventoryPlanningData,testKeywordRecommendations,
    testKeywordRecommendationsFromDB,getStoredKeywordRecommendations,testPPCMetrics,testNumberOfProductReviews,getLastAdsKeywordsPerformanceDocument,testAllAdsServices,testStoreIssueSummary}=require('../controllers/test/TestController.js')
const { testAlerts } = require('../controllers/alerts/AlertsController.js')

// PPC Units Sold Controller - Fetches units sold data date-wise
const { testGetPPCUnitsSold, getUnitsMetricsInfo } = require('../controllers/test/PPCUnitsSoldTestController.js')

    
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
router.post('/getLastAdsKeywordsPerformanceDocument', getLastAdsKeywordsPerformanceDocument)
router.post('/testSearchKeywords',testSearchKeywords)
router.post('/testFbaInventoryPlanningData',testFbaInventoryPlanningData)
router.post('/testKeywordRecommendations',testKeywordRecommendations)

// NEW: ASIN-wise keyword recommendations routes
router.post('/testKeywordRecommendationsFromDB',testKeywordRecommendationsFromDB)  // Fetch ASINs from DB and process
router.get('/getStoredKeywordRecommendations',getStoredKeywordRecommendations)      // Get stored keywords

// PPC Metrics - Aggregated PPC data (sales, spend, ACOS, date-wise metrics)
router.post('/testPPCMetrics',testPPCMetrics)  // Fetch aggregated PPC metrics from SP, SB, SD campaigns

// PPC Units Sold - Date-wise units sold data with attribution windows
router.post('/testPPCUnitsSold', testGetPPCUnitsSold)  // Fetch units sold data date-wise from SP, SB, SD campaigns
router.get('/ppc-units-sold/info', getUnitsMetricsInfo)  // Get info about available units sold metrics

// NumberOfProductReviews - Fetches product review data from RapidAPI
router.post('/testNumberOfProductReviews', testNumberOfProductReviews)  // Fetch ASINs from DB and fetch product reviews data

// Alerts - Fetches NumberOfProductReviews once; runs product content change + negative reviews (rating < 4)
router.post('/testAlerts', testAlerts)  // Body: { userId, country, region }

// All Ads Services - Calls all Amazon Ads APIs in one request (PPC Spends, Keywords Performance, Campaigns, Ad Groups, Search Keywords, etc.)
router.post('/testAllAdsServices', testAllAdsServices)  // Body: { userId, country, region }

// Issue Summary - Calculate and store issue summary for a particular user (same as integration/schedule)
router.post('/testStoreIssueSummary', testStoreIssueSummary)  // Body: { userId, country, region }

module.exports=router
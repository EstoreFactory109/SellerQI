const express=require('express');
const router=express.Router();
const {testReport,getTotalSales,testAmazonAds,
    testGetCampaigns,
    testGetAdGroups,testGetKeywords,testGetRegularKeywords,testGetPPCSpendsBySKU,
    testGetBrand,testSendEmailOnRegistered,testLedgerSummaryReport,testGetProductWiseFBAData,testGetWastedSpendKeywords,testSearchKeywords,testFbaInventoryPlanningData,testKeywordRecommendations,
    testKeywordRecommendationsFromDB,getStoredKeywordRecommendations,testPPCMetrics,testNumberOfProductReviews,getLastAdsKeywordsPerformanceDocument,testAllAdsServices,testStoreIssueSummary,testStoreIssuesSummaryAndChunks,testSendTrialToProSupportEmail}=require('../controllers/test/TestController.js')
const { testAlerts } = require('../controllers/alerts/AlertsController.js')
const { testExpenseReport } = require('../controllers/test/ExpenseReportTestController.js')
const { testAsinWiseSales } = require('../controllers/test/AsinWiseSalesTestController.js')
const { testAsinWiseSalesFromDb } = require('../controllers/test/AsinWiseSalesDbTestController.js')
const { testItemStock } = require('../controllers/test/ItemStockTestController.js')
const { testFinanceDashboardSync, testFinanceDashboardRead } = require('../controllers/test/FinanceDashboardTestController.js')

// PPC Units Sold Controller - Fetches units sold data date-wise
const { testGetPPCUnitsSold, getUnitsMetricsInfo } = require('../controllers/test/PPCUnitsSoldTestController.js')

// Pause / Archive Keywords - Test controller for pausing or archiving Amazon Ads keywords
const { testPauseKeywords, testArchiveKeywords, getPauseArchiveKeywordsInfo } = require('../controllers/test/PauseArchiveKeywordsTestController.js')

// Review Orders - Fetch orders + Send review requests
const { testGetLast30DaysOrders, testSendReviewRequests } = require('../controllers/test/ReviewOrdersTestController.js')

    
router.post('/testreport',testReport);
router.get('/totalsales',getTotalSales);
router.post('/testAmazonAds',testAmazonAds)
router.post('/testGetCampaigns',testGetCampaigns)
router.post('/testGetAdGroups',testGetAdGroups)
router.post('/testGetKeywords',testGetKeywords)
// Regular / manual keywords (SP) — populates the Keyword collection used by Auto Campaign Insights
router.post('/testGetRegularKeywords',testGetRegularKeywords)
router.post('/testGetPPCSpendsBySKU',testGetPPCSpendsBySKU)
router.post('/testGetBrand',testGetBrand)
router.post('/testSendEmailOnRegistered',testSendEmailOnRegistered)
router.post('/testSendTrialToProSupportEmail', testSendTrialToProSupportEmail)
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

// Pause / Archive Keywords - Pause or archive Amazon Ads keywords (SP, SB, SD)
router.post('/pause-keywords', testPauseKeywords)   // Body: userId, country, region, adType, keywordId | keywordIds | keywordText [, matchType]
router.post('/archive-keywords', testArchiveKeywords)  // Same body as pause-keywords
router.get('/pause-archive-keywords/info', getPauseArchiveKeywordsInfo)  // API info

// NumberOfProductReviews - Fetches product review data from RapidAPI
router.post('/testNumberOfProductReviews', testNumberOfProductReviews)  // Fetch ASINs from DB and fetch product reviews data

// Alerts - Fetches NumberOfProductReviews once; runs product content change + negative reviews (rating < 4)
router.post('/testAlerts', testAlerts)  // Body: { userId, country, region }

// Review Orders - Fetch last 30 days Shipped orders via SP-API
router.post('/testLast30DaysOrders', testGetLast30DaysOrders)  // Body: { userId, country, region }

// Review Requests - Process unsent review requests from last 2 fetch batches
router.post('/testSendReviewRequests', testSendReviewRequests)  // Body: { userId, country, region }

// All Ads Services - Calls all Amazon Ads APIs in one request (PPC Spends, Keywords Performance, Campaigns, Ad Groups, Search Keywords, etc.)
router.post('/testAllAdsServices', testAllAdsServices)  // Body: { userId, country, region }

// Issue Summary - Calculate and store issue summary for a particular user (same as integration/schedule)
router.post('/testStoreIssueSummary', testStoreIssueSummary)  // Body: { userId, country, region }

// Issue Summary + Chunks - Store issues in BOTH IssueSummary and IssuesDataChunks (same as integration finalize)
router.post('/testStoreIssuesSummaryAndChunks', testStoreIssuesSummaryAndChunks)  // Body: { userId, country, region }

// Expense report (Settlement reports -> expense analysis)
router.post('/testExpenseReport', testExpenseReport)  // Body: { userId, country, region, daysBack? }

// ASIN-wise Sales report
router.post('/testAsinWiseSales', testAsinWiseSales)  // Body: { userId, country, region, days?, dataSource? }

// ASIN-wise Sales — read persisted data from MongoDB (no SP-API)
router.post('/testAsinWiseSalesFromDb', testAsinWiseSalesFromDb)  // Body: { userId, country, region, period? } | { userId, country, region, from, to }

// FBA inventory summaries (Inventory API)
router.post('/testItemStock', testItemStock)  // Body: { userId, country, region, sellerSkus? }

// Finance Dashboard — Fetch from SP-API Finance v2024 and store in DailySkuFinance + DailyOverheadFinance
router.post('/testFinanceDashboardSync', testFinanceDashboardSync)  // Body: { userId, country, region, startDate, endDate }

// Finance Dashboard — Read-only: total sales + ASIN-wise sales (same calc as frontend profitability page)
router.post('/testFinanceDashboardRead', testFinanceDashboardRead)  // Body: { userId, country, region, startDate, endDate }

module.exports=router
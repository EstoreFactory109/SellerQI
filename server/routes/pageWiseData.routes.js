/**
 * Page-wise Data Routes
 * 
 * These routes provide separate endpoints for each dashboard page.
 * Data is calculated in the backend and sent to the frontend ready for display.
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const { analyseDataCache } = require('../middlewares/redisCache.js');
const { validateAsinParam, validateTaskStatusBody } = require('../middlewares/validator/pageWiseDataValidate.js');
// Rate limiters disabled except for authentication
// const { analyticsRateLimiter } = require('../middlewares/rateLimiting.js');

const {
    getDashboardData,
    getDashboardSummary,
    getProductCheckerData,
    getTop4ProductsOptimized,
    getProfitabilityData,
    getProfitabilitySummary,
    getPPCData,
    getIssuesData,
    getIssuesByProductData,
    getKeywordAnalysisData,
    getReimbursementData,
    getTasksData,
    updateTaskStatus,
    getInventoryData,
    getAsinWiseSalesData,
    getYourProductsData,
    getNavbarData,
    getAccountHistoryData,
    getProductHistory,
    getComparisonDebugInfo,
    // v2 optimized endpoints
    getYourProductsInitialV2,
    getYourProductsByStatusV2,
    // v3 highly optimized endpoints
    getYourProductsSummaryV3,
    getYourProductsActiveV3,
    getYourProductsInactiveV3,
    getYourProductsIncompleteV3,
    getYourProductsWithoutAPlusV3,
    getYourProductsNotTargetedInAdsV3,
    getOptimizationProductsV3,
    // Multi-phase dashboard endpoints
    getDashboardPhase1,
    getDashboardPhase2,
    getDashboardPhase3,
    // Phased profitability endpoints (parallel loading)
    getProfitabilityMetrics,
    getProfitabilityChart,
    getProfitabilityTable,
    // Profitability issues endpoints
    getProfitabilityIssues,
    getProfitabilityIssuesSummary
} = require('../controllers/analytics/PageWiseDataController.js');

const {
    getLatestPPCMetrics,
    getPPCMetricsByDateRange,
    getPPCMetricsForGraph,
    getPPCMetricsHistory
} = require('../controllers/analytics/PPCMetricsController.js');

const {
    getLatestPPCUnitsSold,
    getPPCUnitsSoldByDateRange,
    getPPCUnitsSoldSummary
} = require('../controllers/analytics/PPCUnitsSoldController.js');

const {
    getPPCKPISummary,
    getHighAcosCampaigns,
    getWastedSpendKeywords,
    getCampaignsWithoutNegatives,
    getTopPerformingKeywords,
    getSearchTermsZeroSales,
    getAutoCampaignInsights,
    getTabCounts
} = require('../controllers/analytics/PPCCampaignAnalysisController.js');

const {
    getIssuesSummary,
    getRankingIssues,
    getConversionIssues,
    getInventoryIssues,
    getAccountIssues,
    getProductsWithIssues
} = require('../controllers/analytics/IssuesPaginatedController.js');

// ===== NAVBAR DATA =====
// Returns minimal data for top navigation bar (user info, accounts, brand, health)
// Cache TTL: 5 minutes (shorter as it's lightweight)
router.get('/navbar', auth, getLocation, analyseDataCache(300, 'navbar'), getNavbarData);

// ===== MAIN DASHBOARD =====
// Returns full calculated dashboard data
// Cache TTL: 1 hour, page-specific cache key
router.get('/dashboard', auth, getLocation, analyseDataCache(3600, 'dashboard'), getDashboardData);

// ===== DASHBOARD SUMMARY (Fast, lightweight) =====
// Returns minimal data for first-load performance (Phase 1)
// Only loads: account health, total sales, orders, quick stats
// Cache TTL: 1 hour
router.get('/dashboard-summary', auth, getLocation, analyseDataCache(3600, 'dashboard-summary'), getDashboardSummary);

// ===== PRODUCT CHECKER DATA (Phase 2 - Full) =====
// Returns full error analysis for Product Checker component
// Call after dashboard-summary for progressive loading
// Cache TTL: 1 hour
router.get('/product-checker', auth, getLocation, analyseDataCache(3600, 'product-checker'), getProductCheckerData);

// ===== TOP 4 PRODUCTS (Phase 4 - Optimized) =====
// LIGHTWEIGHT: Returns ONLY top 4 products for main dashboard
// Does NOT run full Analyse service - single MongoDB aggregation
// Expected response time: 50-200ms (vs 2-5s for /product-checker)
// Cache TTL: 1 hour
router.get('/top4-products', auth, getLocation, analyseDataCache(3600, 'top4-products'), getTop4ProductsOptimized);

// ===== MULTI-PHASE DASHBOARD (Progressive Loading) =====
// Phase 1: Instant (~50ms) - precomputed error counts, product counts, date range
router.get('/dashboard-phase1', auth, getLocation, analyseDataCache(3600, 'dashboard-phase1'), getDashboardPhase1);

// Phase 2: Core (~150ms) - sales totals, account health, finance summary, PPC summary
router.get('/dashboard-phase2', auth, getLocation, analyseDataCache(3600, 'dashboard-phase2'), getDashboardPhase2);

// Phase 3: Charts (~200ms) - datewiseSales, ppcDateWiseMetrics, orders, products, adsKeywordsData
router.get('/dashboard-phase3', auth, getLocation, analyseDataCache(3600, 'dashboard-phase3'), getDashboardPhase3);

// ===== PROFITABILITY DASHBOARD =====
// OPTIMIZED: Returns profitability-specific calculated data (3-4x faster than before)
// Uses ProfitabilityService which fetches only 5-8 collections instead of 24+
router.get('/profitability', auth, getLocation, analyseDataCache(3600, 'profitability'), getProfitabilityData);

// ===== PROFITABILITY SUMMARY (PHASE 1 - FAST) =====
// Returns only metrics and chart data for instant rendering (~100-200ms)
// Use this for initial load, then fetch full data for table
router.get('/profitability-summary', auth, getLocation, analyseDataCache(3600, 'profitability-summary'), getProfitabilitySummary);

// ===== PHASED PROFITABILITY (PARALLEL LOADING) =====
// These 3 endpoints are designed to be called in parallel for fastest page load
// Each endpoint can complete independently and display as soon as ready

// Phase 1: Metrics (KPI boxes) - Total Sales, PPC Sales, Ad Spend, ACOS%, Amazon Fees, Gross Profit
// Expected time: ~50-100ms | Cache TTL: 1 hour
router.get('/profitability/metrics', auth, getLocation, analyseDataCache(3600, 'profitability-metrics'), getProfitabilityMetrics);

// Phase 2: Chart data - Datewise gross profit and total sales
// Expected time: ~50-100ms | Cache TTL: 1 hour
router.get('/profitability/chart', auth, getLocation, analyseDataCache(3600, 'profitability-chart'), getProfitabilityChart);

// Phase 3: Table data - PAGINATED profitability table (10 items per page)
// Query params: page (default: 1), limit (default: 10)
// Expected time: ~100-300ms | Cache TTL: 1 hour (only page 1 cached)
router.get('/profitability/table', auth, getLocation, analyseDataCache(3600, 'profitability-table'), getProfitabilityTable);

// ===== PROFITABILITY ISSUES ENDPOINTS =====
// Returns detailed profitability issues with recommendations
// Uses SAME calculation logic as DashboardCalculation.calculateProfitabilityErrors

// Issues list - Paginated list of products with profitability issues
// Query params: page (default: 1), limit (default: 10)
// Expected time: ~100-200ms | Cache TTL: 1 hour (only page 1 cached)
router.get('/profitability/issues', auth, getLocation, analyseDataCache(3600, 'profitability-issues'), getProfitabilityIssues);

// Issues summary - Fast endpoint for counts only
// Expected time: ~50-100ms | Cache TTL: 1 hour
router.get('/profitability/issues/summary', auth, getLocation, analyseDataCache(3600, 'profitability-issues-summary'), getProfitabilityIssuesSummary);

// ===== ASIN-WISE SALES DATA =====
// Returns ASIN-wise sales data for profitability table
// Separate endpoint to handle big accounts where data is stored in separate collection
router.get('/asin-wise-sales', auth, getLocation, getAsinWiseSalesData);

// ===== PPC/SPONSORED ADS DASHBOARD =====
// Returns PPC/sponsored ads specific calculated data (LEGACY - kept for backward compatibility)
router.get('/ppc', auth, getLocation, analyseDataCache(3600, 'ppc'), getPPCData);

// ===== PPC CAMPAIGN ANALYSIS (OPTIMIZED - PAGINATED) =====
// These endpoints replace the monolithic /ppc endpoint for the Campaign Audit page
// Each endpoint fetches only the data needed for its specific tab

// PPC KPI Summary (lightweight - for top boxes: spend, sales, acos, tacos, units, issues)
// Cache TTL: 5 minutes
router.get('/ppc/summary', auth, getLocation, analyseDataCache(300, 'ppc-summary'), getPPCKPISummary);

// Tab counts for all campaign analysis tabs (lightweight - for tab badges)
// Cache TTL: 10 minutes
router.get('/ppc/tab-counts', auth, getLocation, analyseDataCache(600, 'ppc-tab-counts'), getTabCounts);

// High ACOS Campaigns (Tab 0) - ACOS > 40% and sales > 0
// Query params: page, limit, startDate, endDate
// Cache TTL: 10 minutes (only page 1 cached)
router.get('/ppc/high-acos', auth, getLocation, analyseDataCache(600, 'ppc-high-acos'), getHighAcosCampaigns);

// Wasted Spend Keywords (Tab 1) - cost > 0 and sales < 0.01
// Query params: page, limit, startDate, endDate
// Cache TTL: 10 minutes (only page 1 cached)
router.get('/ppc/wasted-spend', auth, getLocation, analyseDataCache(600, 'ppc-wasted-spend'), getWastedSpendKeywords);

// Campaigns Without Negative Keywords (Tab 2)
// Query params: page, limit
// Cache TTL: 10 minutes (only page 1 cached)
router.get('/ppc/no-negatives', auth, getLocation, analyseDataCache(600, 'ppc-no-negatives'), getCampaignsWithoutNegatives);

// Top Performing Keywords (Tab 3) - ACOS < 20%, sales > 100, impressions > 1000
// Query params: page, limit, startDate, endDate
// Cache TTL: 10 minutes (only page 1 cached)
router.get('/ppc/top-keywords', auth, getLocation, analyseDataCache(600, 'ppc-top-keywords'), getTopPerformingKeywords);

// Search Terms with Zero Sales (Tab 4) - clicks >= 10 and sales < 0.01
// Query params: page, limit, startDate, endDate
// Cache TTL: 10 minutes (only page 1 cached)
router.get('/ppc/zero-sales', auth, getLocation, analyseDataCache(600, 'ppc-zero-sales'), getSearchTermsZeroSales);

// Auto Campaign Insights (Tab 5) - sales > 30, auto campaign, not in manual campaigns
// Query params: page, limit, startDate, endDate
// Cache TTL: 10 minutes (only page 1 cached)
router.get('/ppc/auto-insights', auth, getLocation, analyseDataCache(600, 'ppc-auto-insights'), getAutoCampaignInsights);

// ===== ISSUES PAGE =====
// Returns issues summary data
router.get('/issues', auth, getLocation, analyseDataCache(3600, 'issues'), getIssuesData);

// ===== ISSUES BY PRODUCT PAGE =====
// Returns detailed issues by product data
router.get('/issues-by-product', auth, getLocation, analyseDataCache(3600, 'issues-by-product'), getIssuesByProductData);

// ===== ISSUES PAGINATED ENDPOINTS (OPTIMIZED) =====
// These endpoints replace the monolithic /issues and /issues-by-product endpoints
// Each endpoint fetches only the data needed for its specific tab/section

// Issues Summary - Fast endpoint for counts only (uses pre-computed IssueSummary)
// Returns: totalRankingErrors, totalConversionErrors, totalInventoryErrors, totalAccountErrors, etc.
// Expected time: ~10-50ms | Cache TTL: 1 hour
router.get('/issues/summary', auth, getLocation, analyseDataCache(3600, 'issues-summary'), getIssuesSummary);

// Ranking Issues - Paginated list for Ranking tab
// Query params: page (default: 1), limit (default: 10)
// Expected time: ~50-100ms | Cache TTL: 10 minutes (only page 1 cached)
router.get('/issues/ranking', auth, getLocation, analyseDataCache(600, 'issues-ranking'), getRankingIssues);

// Conversion Issues - Paginated list for Conversion tab (includes buy box data)
// Query params: page (default: 1), limit (default: 10)
// Expected time: ~50-100ms | Cache TTL: 10 minutes (only page 1 cached)
router.get('/issues/conversion', auth, getLocation, analyseDataCache(600, 'issues-conversion'), getConversionIssues);

// Inventory Issues - Paginated list for Inventory tab
// Query params: page (default: 1), limit (default: 10)
// Expected time: ~50-100ms | Cache TTL: 10 minutes (only page 1 cached)
router.get('/issues/inventory', auth, getLocation, analyseDataCache(600, 'issues-inventory'), getInventoryIssues);

// Account Issues - Account health and issues (no pagination - small data set)
// Expected time: ~20-50ms | Cache TTL: 1 hour
router.get('/issues/account', auth, getLocation, analyseDataCache(3600, 'issues-account'), getAccountIssues);

// Products with Issues - Paginated list for Issues by Product page
// Query params: page (default: 1), limit (default: 6), sort, sortOrder, priority, search
// Sort options: issues, sessions, conversion, sales, acos, name, asin, price
// Priority filter: high (>=5), medium (2-4), low (1)
// Expected time: ~50-150ms | Cache TTL: 10 minutes (only page 1 cached)
router.get('/issues/products', auth, getLocation, analyseDataCache(600, 'issues-products'), getProductsWithIssues);

// ===== PRODUCT HISTORY (for single product trend graphs) =====
// Returns historical performance data for a specific ASIN
router.get('/product-history/:asin', auth, getLocation, validateAsinParam, getProductHistory);

// ===== COMPARISON DEBUG (for checking WoW/MoM data availability) =====
// Returns counts of BuyBoxData and EconomicsMetrics documents
router.get('/comparison-debug', auth, getLocation, getComparisonDebugInfo);

// ===== KEYWORD ANALYSIS PAGE =====
// Returns keyword analysis data
router.get('/keyword-analysis', auth, getLocation, analyseDataCache(3600, 'keyword-analysis'), getKeywordAnalysisData);

// ===== REIMBURSEMENT DASHBOARD =====
// Returns reimbursement data
router.get('/reimbursement', auth, getLocation, analyseDataCache(3600, 'reimbursement'), getReimbursementData);

// ===== INVENTORY PAGE =====
// Returns inventory data
router.get('/inventory', auth, getLocation, analyseDataCache(3600, 'inventory'), getInventoryData);

// ===== YOUR PRODUCTS PAGE =====
// Returns all products with status, ratings, A+ content info
// Cache TTL: 15 minutes (shorter than other pages due to frequent product updates)
// Only page 1 is cached - Load More requests (page > 1) bypass cache for data consistency
router.get('/your-products', auth, getLocation, analyseDataCache(900, 'your-products'), getYourProductsData);

// ===== YOUR PRODUCTS V2 (OPTIMIZED) =====
// Uses MongoDB aggregation - does NOT load full Seller document
// Much faster for large product catalogs

// Initial load - returns summary counts + first 20 Active products in ONE call
// This is the ONLY call needed on first render
// Cache TTL: 15 minutes
router.get('/your-products-v2/initial', auth, getLocation, analyseDataCache(900, 'your-products-v2-initial'), getYourProductsInitialV2);

// Products by status - called on tab switch (Inactive/Incomplete) or Load More
// Query params: status (required: Active|Inactive|Incomplete), page, limit
// Cache TTL: 15 minutes, keyed by status + page + limit
router.get('/your-products-v2/products', auth, getLocation, analyseDataCache(900, 'your-products-v2-products'), getYourProductsByStatusV2);

// ===== YOUR PRODUCTS V3 (HIGHLY OPTIMIZED - SEPARATE ENDPOINTS) =====
// Each endpoint is minimal and fast - returns only what's needed

// Summary endpoint - counts only (for summary boxes)
// Returns: totalProducts, activeProducts, inactiveProducts, incompleteProducts, productsWithoutAPlus, hasBrandStory
// Cache TTL: 15 minutes
router.get('/your-products-v3/summary', auth, getLocation, analyseDataCache(900, 'your-products-v3-summary'), getYourProductsSummaryV3);

// Active products - paginated (NO A+ or Ads columns)
// Query params: page, limit (default: page=1, limit=20)
// Cache TTL: 15 minutes (only page 1 cached)
router.get('/your-products-v3/active', auth, getLocation, analyseDataCache(900, 'your-products-v3-active'), getYourProductsActiveV3);

// Inactive products - paginated (from Seller model only)
// Query params: page, limit
// Cache TTL: 15 minutes (only page 1 cached)
router.get('/your-products-v3/inactive', auth, getLocation, analyseDataCache(900, 'your-products-v3-inactive'), getYourProductsInactiveV3);

// Incomplete products - paginated (from Seller model only)
// Query params: page, limit
// Cache TTL: 15 minutes (only page 1 cached)
router.get('/your-products-v3/incomplete', auth, getLocation, analyseDataCache(900, 'your-products-v3-incomplete'), getYourProductsIncompleteV3);

// Products without A+ content - paginated
// Query params: page, limit
// Cache TTL: 15 minutes (only page 1 cached)
router.get('/your-products-v3/without-aplus', auth, getLocation, analyseDataCache(900, 'your-products-v3-without-aplus'), getYourProductsWithoutAPlusV3);

// Products not targeted in ads - paginated (Active products only)
// Query params: page, limit
// Cache TTL: 15 minutes (only page 1 cached)
router.get('/your-products-v3/not-targeted-in-ads', auth, getLocation, analyseDataCache(900, 'your-products-v3-not-targeted-in-ads'), getYourProductsNotTargetedInAdsV3);

// ===== V3 OPTIMIZATION TAB (LIGHTWEIGHT) =====
// Dedicated fast endpoint for optimization tab - skips full Analyse/analyseData
// Only fetches: active products + BuyBoxData + EconomicsMetrics + SponsoredAds
// Frontend generates recommendations client-side
// Query params: page, limit
// Cache TTL: 10 minutes (only page 1 cached)
router.get('/your-products-v3/optimization', auth, getLocation, analyseDataCache(600, 'your-products-v3-optimization'), getOptimizationProductsV3);

// ===== ACCOUNT HISTORY PAGE =====
// Returns historical account metrics data
router.get('/account-history', auth, getLocation, analyseDataCache(3600, 'account-history'), getAccountHistoryData);

// ===== TASKS PAGE =====
// Returns tasks data
router.get('/tasks', auth, getTasksData);

// Update task status
router.put('/tasks/status', auth, validateTaskStatusBody, updateTaskStatus);

// ===== PPC METRICS (from PPCMetrics Model) =====
// Get latest PPC metrics for dashboards
router.get('/ppc-metrics/latest', auth, getLocation, getLatestPPCMetrics);

// Get PPC metrics filtered by date range
router.get('/ppc-metrics/filter', auth, getLocation, getPPCMetricsByDateRange);

// Get PPC metrics for graph/chart display
router.get('/ppc-metrics/graph', auth, getLocation, getPPCMetricsForGraph);

// Get PPC metrics history
router.get('/ppc-metrics/history', auth, getLocation, getPPCMetricsHistory);

// ===== PPC UNITS SOLD (from PPCUnitsSold Model) =====
// Get latest PPC units sold data (default: 30 days)
router.get('/ppc-units-sold/latest', auth, getLocation, getLatestPPCUnitsSold);

// Get PPC units sold filtered by date range
router.get('/ppc-units-sold/filter', auth, getLocation, getPPCUnitsSoldByDateRange);

// Get PPC units sold summary for KPI display
router.get('/ppc-units-sold/summary', auth, getLocation, getPPCUnitsSoldSummary);

module.exports = router;


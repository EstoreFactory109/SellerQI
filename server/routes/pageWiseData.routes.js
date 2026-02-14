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
// Rate limiters disabled except for authentication
// const { analyticsRateLimiter } = require('../middlewares/rateLimiting.js');

const {
    getDashboardData,
    getProfitabilityData,
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
    getComparisonDebugInfo
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

// ===== NAVBAR DATA =====
// Returns minimal data for top navigation bar (user info, accounts, brand, health)
// Cache TTL: 5 minutes (shorter as it's lightweight)
router.get('/navbar', auth, getLocation, analyseDataCache(300, 'navbar'), getNavbarData);

// ===== MAIN DASHBOARD =====
// Returns full calculated dashboard data
// Cache TTL: 1 hour, page-specific cache key
router.get('/dashboard', auth, getLocation, analyseDataCache(3600, 'dashboard'), getDashboardData);

// ===== PROFITABILITY DASHBOARD =====
// Returns profitability-specific calculated data
router.get('/profitability', auth, getLocation, analyseDataCache(3600, 'profitability'), getProfitabilityData);

// ===== ASIN-WISE SALES DATA =====
// Returns ASIN-wise sales data for profitability table
// Separate endpoint to handle big accounts where data is stored in separate collection
router.get('/asin-wise-sales', auth, getLocation, getAsinWiseSalesData);

// ===== PPC/SPONSORED ADS DASHBOARD =====
// Returns PPC/sponsored ads specific calculated data
router.get('/ppc', auth, getLocation, analyseDataCache(3600, 'ppc'), getPPCData);

// ===== ISSUES PAGE =====
// Returns issues summary data
router.get('/issues', auth, getLocation, analyseDataCache(3600, 'issues'), getIssuesData);

// ===== ISSUES BY PRODUCT PAGE =====
// Returns detailed issues by product data
router.get('/issues-by-product', auth, getLocation, analyseDataCache(3600, 'issues-by-product'), getIssuesByProductData);

// ===== PRODUCT HISTORY (for single product trend graphs) =====
// Returns historical performance data for a specific ASIN
router.get('/product-history/:asin', auth, getLocation, getProductHistory);

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

// ===== ACCOUNT HISTORY PAGE =====
// Returns historical account metrics data
router.get('/account-history', auth, getLocation, analyseDataCache(3600, 'account-history'), getAccountHistoryData);

// ===== TASKS PAGE =====
// Returns tasks data
router.get('/tasks', auth, getTasksData);

// Update task status
router.put('/tasks/status', auth, updateTaskStatus);

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


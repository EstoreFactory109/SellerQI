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
const { analyticsRateLimiter } = require('../middlewares/rateLimiting.js');

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
    getYourProductsData
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

// ===== MAIN DASHBOARD =====
// Returns full calculated dashboard data
// Cache TTL: 1 hour, page-specific cache key
router.get('/dashboard', analyticsRateLimiter, auth, getLocation, analyseDataCache(3600, 'dashboard'), getDashboardData);

// ===== PROFITABILITY DASHBOARD =====
// Returns profitability-specific calculated data
router.get('/profitability', analyticsRateLimiter, auth, getLocation, analyseDataCache(3600, 'profitability'), getProfitabilityData);

// ===== ASIN-WISE SALES DATA =====
// Returns ASIN-wise sales data for profitability table
// Separate endpoint to handle big accounts where data is stored in separate collection
router.get('/asin-wise-sales', analyticsRateLimiter, auth, getLocation, getAsinWiseSalesData);

// ===== PPC/SPONSORED ADS DASHBOARD =====
// Returns PPC/sponsored ads specific calculated data
router.get('/ppc', analyticsRateLimiter, auth, getLocation, analyseDataCache(3600, 'ppc'), getPPCData);

// ===== ISSUES PAGE =====
// Returns issues summary data
router.get('/issues', analyticsRateLimiter, auth, getLocation, analyseDataCache(3600, 'issues'), getIssuesData);

// ===== ISSUES BY PRODUCT PAGE =====
// Returns detailed issues by product data
router.get('/issues-by-product', analyticsRateLimiter, auth, getLocation, analyseDataCache(3600, 'issues-by-product'), getIssuesByProductData);

// ===== KEYWORD ANALYSIS PAGE =====
// Returns keyword analysis data
router.get('/keyword-analysis', analyticsRateLimiter, auth, getLocation, analyseDataCache(3600, 'keyword-analysis'), getKeywordAnalysisData);

// ===== REIMBURSEMENT DASHBOARD =====
// Returns reimbursement data
router.get('/reimbursement', analyticsRateLimiter, auth, getLocation, analyseDataCache(3600, 'reimbursement'), getReimbursementData);

// ===== INVENTORY PAGE =====
// Returns inventory data
router.get('/inventory', analyticsRateLimiter, auth, getLocation, analyseDataCache(3600, 'inventory'), getInventoryData);

// ===== YOUR PRODUCTS PAGE =====
// Returns all products with status, ratings, A+ content info
// Cache TTL: 15 minutes (shorter than other pages due to frequent product updates)
// Only page 1 is cached - Load More requests (page > 1) bypass cache for data consistency
router.get('/your-products', analyticsRateLimiter, auth, getLocation, analyseDataCache(900, 'your-products'), getYourProductsData);

// ===== TASKS PAGE =====
// Returns tasks data
router.get('/tasks', analyticsRateLimiter, auth, getTasksData);

// Update task status
router.put('/tasks/status', analyticsRateLimiter, auth, updateTaskStatus);

// ===== PPC METRICS (from PPCMetrics Model) =====
// Get latest PPC metrics for dashboards
router.get('/ppc-metrics/latest', analyticsRateLimiter, auth, getLocation, getLatestPPCMetrics);

// Get PPC metrics filtered by date range
router.get('/ppc-metrics/filter', analyticsRateLimiter, auth, getLocation, getPPCMetricsByDateRange);

// Get PPC metrics for graph/chart display
router.get('/ppc-metrics/graph', analyticsRateLimiter, auth, getLocation, getPPCMetricsForGraph);

// Get PPC metrics history
router.get('/ppc-metrics/history', analyticsRateLimiter, auth, getLocation, getPPCMetricsHistory);

// ===== PPC UNITS SOLD (from PPCUnitsSold Model) =====
// Get latest PPC units sold data (default: 30 days)
router.get('/ppc-units-sold/latest', analyticsRateLimiter, auth, getLocation, getLatestPPCUnitsSold);

// Get PPC units sold filtered by date range
router.get('/ppc-units-sold/filter', analyticsRateLimiter, auth, getLocation, getPPCUnitsSoldByDateRange);

// Get PPC units sold summary for KPI display
router.get('/ppc-units-sold/summary', analyticsRateLimiter, auth, getLocation, getPPCUnitsSoldSummary);

module.exports = router;


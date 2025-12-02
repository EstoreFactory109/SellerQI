/**
 * mcp.routes.js
 * 
 * Routes for MCP/Data Kiosk API integration
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const {
    listQueries,
    createQuery,
    checkQueryStatus,
    cancelQuery,
    getDocumentDetails,
    downloadDocument,
    createSalesAndTrafficByDateQuery,
    createSalesAndTrafficByAsinQuery,
    createEconomicsQuery,
    waitForQueryCompletion,
    getEconomicsMetrics
} = require('../controllers/mcp/DataKioskController.js');

// Economics metrics endpoint - can work with refreshToken OR auth cookies
router.post('/economics/metrics', getEconomicsMetrics);

// All other routes require authentication and location middleware
router.use(auth);
router.use(getLocation);

// Query management routes
router.get('/queries', listQueries);
router.post('/queries', createQuery);
router.get('/queries/:queryId/status', checkQueryStatus);
router.delete('/queries/:queryId', cancelQuery);
router.post('/queries/:queryId/wait', waitForQueryCompletion);

// Document routes
router.get('/documents/:documentId', getDocumentDetails);
router.get('/documents/:documentId/download', downloadDocument);

// Pre-built query routes
router.post('/queries/sales-traffic/date', createSalesAndTrafficByDateQuery);
router.post('/queries/sales-traffic/asin', createSalesAndTrafficByAsinQuery);
router.post('/queries/economics', createEconomicsQuery);

module.exports = router;


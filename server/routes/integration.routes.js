/**
 * integration.routes.js
 * 
 * Routes for first-time integration job management
 * 
 * These routes are SEPARATE from existing routes and
 * do NOT affect any existing functionality.
 * 
 * Endpoints:
 * - POST /api/integration/trigger - Trigger a new integration job
 * - GET /api/integration/status/:jobId - Get job status by ID
 * - GET /api/integration/active - Get user's active job (if any)
 * - GET /api/integration/history - Get user's job history
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const { integrationRateLimiter } = require('../middlewares/rateLimiting.js');
const {
    triggerIntegrationJob,
    getJobStatus,
    getActiveJob,
    getJobHistory
} = require('../controllers/integration/IntegrationJobController.js');

// All routes require authentication
// Trigger a new integration job (requires auth + location for country/region)
router.post('/trigger', integrationRateLimiter, auth, getLocation, triggerIntegrationJob);

// Get job status by job ID (requires auth only)
router.get('/status/:jobId', auth, getJobStatus);

// Get user's active job (requires auth + location)
router.get('/active', auth, getLocation, getActiveJob);

// Get user's job history (requires auth only)
router.get('/history', auth, getJobHistory);

module.exports = router;


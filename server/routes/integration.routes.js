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
const { validateJobIdParam, validateAdminTriggerBody } = require('../middlewares/validator/integrationValidate.js');
// Rate limiters disabled except for authentication
// const { integrationRateLimiter } = require('../middlewares/rateLimiting.js');
const {
    triggerIntegrationJob,
    getJobStatus,
    getActiveJob,
    getJobHistory,
    adminTriggerIntegrationJob
} = require('../controllers/integration/IntegrationJobController.js');
const superAdminAuth = require('../middlewares/Auth/superAdminAuth.js');

// All routes require authentication
// Trigger a new integration job (requires auth + location for country/region)
router.post('/trigger', auth, getLocation, triggerIntegrationJob);

// Get job status by job ID (requires auth only)
router.get('/status/:jobId', auth, validateJobIdParam, getJobStatus);

// Get user's active job (requires auth + location)
router.get('/active', auth, getLocation, getActiveJob);

// Get user's job history (requires auth only)
router.get('/history', auth, getJobHistory);

// Admin route - Trigger integration job for any user (requires super admin auth)
router.post('/admin/trigger', superAdminAuth, validateAdminTriggerBody, adminTriggerIntegrationJob);

module.exports = router;


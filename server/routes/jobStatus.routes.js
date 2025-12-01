/**
 * jobStatus.routes.js
 * 
 * Routes for job status and queue monitoring
 */

const express = require('express');
const router = express.Router();

const {
    getJobStatusByUserId,
    getJobStatusByJobId,
    getRecentJobs,
    getQueueStatistics,
    getFailedJobs
} = require('../controllers/system/JobStatusController.js');

const auth = require('../middlewares/Auth/auth.js');
const adminAuth = require('../middlewares/Auth/adminAuth.js');

// User routes (require authentication)
// Users can check their own job status
router.get('/status/user/:userId', auth, getJobStatusByUserId);

// Admin routes (require admin access)
// Admins can check any job status and view queue statistics
router.get('/status/job/:jobId', auth, adminAuth, getJobStatusByJobId);
router.get('/recent', auth, adminAuth, getRecentJobs);
router.get('/queue/stats', auth, adminAuth, getQueueStatistics);
router.get('/failed', auth, adminAuth, getFailedJobs);

module.exports = router;


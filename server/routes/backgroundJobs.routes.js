const express = require('express');
const router = express.Router();

const {
    getSystemStats,
    getJobStatus,
    triggerJob,
    controlJob,
    manualUserUpdate,
    initializeUserScheduling,
    updateUserAccounts,
    getUserSchedule,
    getUpdateStats,
    initializeAllSchedules,
    getScheduleStats,
    cleanupCache,
    emergencyStop,
    restartJobs,
    rebalanceUsers,
    getDetailedScheduleStats
} = require('../controllers/BackgroundJobController.js');

const auth = require('../middlewares/Auth/auth.js');
const adminAuth = require('../middlewares/Auth/adminAuth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');

// User routes (require authentication)
router.get('/user/schedule', auth, getUserSchedule);
router.post('/user/manual-update', auth, getLocation, manualUserUpdate);
router.put('/user/update-accounts', auth, updateUserAccounts);

// Admin routes (require admin access)
router.get('/admin/system-stats', auth, adminAuth, getSystemStats);
router.get('/admin/job-status', auth, adminAuth, getJobStatus);
router.get('/admin/update-stats', auth, adminAuth, getUpdateStats);
router.get('/admin/schedule-stats', auth, adminAuth, getScheduleStats);

router.post('/admin/trigger/:jobName', auth, adminAuth, triggerJob);
router.put('/admin/control/:jobName', auth, adminAuth, controlJob);

router.post('/admin/initialize-schedules', auth, adminAuth, initializeAllSchedules);
router.post('/admin/initialize-user/:userId', auth, adminAuth, initializeUserScheduling);

router.post('/admin/cleanup-cache', auth, adminAuth, cleanupCache);
router.post('/admin/emergency-stop', auth, adminAuth, emergencyStop);
router.post('/admin/restart-jobs', auth, adminAuth, restartJobs);

// New optimization endpoints
router.post('/admin/rebalance-users', auth, adminAuth, rebalanceUsers);
router.get('/admin/detailed-stats', auth, adminAuth, getDetailedScheduleStats);

module.exports = router; 
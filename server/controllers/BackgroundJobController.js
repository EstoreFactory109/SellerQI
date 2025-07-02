const asyncHandler = require('../utils/AsyncHandler.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const { ApiError } = require('../utils/ApiError.js');
const { jobScheduler } = require('../Services/BackgroundJobs/JobScheduler.js');
const { DataUpdateService } = require('../Services/BackgroundJobs/DataUpdateService.js');
const { UserSchedulingService } = require('../Services/BackgroundJobs/UserSchedulingService.js');
const logger = require('../utils/Logger.js');

/**
 * Get system statistics for background jobs
 */
const getSystemStats = asyncHandler(async (req, res) => {
    try {
        const stats = await jobScheduler.getSystemStats();
        
        res.status(200).json(
            new ApiResponse(200, stats, "System statistics retrieved successfully")
        );
    } catch (error) {
        logger.error('Error getting system stats:', error);
        throw new ApiError(500, "Failed to retrieve system statistics");
    }
});

/**
 * Get job status for all background jobs
 */
const getJobStatus = asyncHandler(async (req, res) => {
    try {
        const status = jobScheduler.getJobsStatus();
        
        res.status(200).json(
            new ApiResponse(200, status, "Job status retrieved successfully")
        );
    } catch (error) {
        logger.error('Error getting job status:', error);
        throw new ApiError(500, "Failed to retrieve job status");
    }
});

/**
 * Manually trigger a specific background job
 */
const triggerJob = asyncHandler(async (req, res) => {
    const { jobName } = req.params;
    
    const validJobs = ['dailyUpdates', 'cacheCleanup', 'healthCheck'];
    if (!validJobs.includes(jobName)) {
        throw new ApiError(400, `Invalid job name. Valid jobs: ${validJobs.join(', ')}`);
    }

    try {
        const result = await jobScheduler.triggerJob(jobName);
        
        res.status(200).json(
            new ApiResponse(200, result, `Job ${jobName} triggered successfully`)
        );
    } catch (error) {
        logger.error(`Error triggering job ${jobName}:`, error);
        throw new ApiError(500, `Failed to trigger job ${jobName}`);
    }
});

/**
 * Start or stop a specific job
 */
const controlJob = asyncHandler(async (req, res) => {
    const { jobName } = req.params;
    const { action } = req.body; // 'start' or 'stop'
    
    if (!['start', 'stop'].includes(action)) {
        throw new ApiError(400, "Action must be 'start' or 'stop'");
    }

    try {
        let success;
        if (action === 'start') {
            success = jobScheduler.startJob(jobName);
        } else {
            success = jobScheduler.stopJob(jobName);
        }

        if (!success) {
            throw new ApiError(404, `Job ${jobName} not found`);
        }
        
        res.status(200).json(
            new ApiResponse(200, { jobName, action, success }, `Job ${jobName} ${action}ed successfully`)
        );
    } catch (error) {
        logger.error(`Error controlling job ${jobName}:`, error);
        throw new ApiError(500, `Failed to ${action} job ${jobName}`);
    }
});

/**
 * Manually update a specific user's data
 */
const manualUserUpdate = asyncHandler(async (req, res) => {
    const userId = req.userId; // From auth middleware
    const { country, region } = req.body;

    if (!country || !region) {
        throw new ApiError(400, "Country and region are required");
    }

    try {
        const results = await DataUpdateService.manualUpdateUser(userId, country, region);
        
        res.status(200).json(
            new ApiResponse(200, results, `Manual comprehensive update completed for user data`)
        );
    } catch (error) {
        logger.error(`Error in manual user update for ${userId}:`, error);
        throw new ApiError(500, "Failed to update user data");
    }
});

/**
 * Initialize scheduling for a new user (called when user registers)
 */
const initializeUserScheduling = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
        throw new ApiError(400, "User ID is required");
    }

    // Validate ObjectId format
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new ApiError(400, "Invalid User ID format");
    }

    try {
        const schedule = await UserSchedulingService.initializeUserSchedule(userId);
        
        res.status(200).json(
            new ApiResponse(200, schedule, "User scheduling initialized successfully")
        );
    } catch (error) {
        logger.error(`Error initializing user scheduling for ${userId}:`, error);
        throw new ApiError(500, "Failed to initialize user scheduling");
    }
});

/**
 * Update seller accounts for a user in the scheduling system
 */
const updateUserAccounts = asyncHandler(async (req, res) => {
    const userId = req.userId; // From auth middleware

    try {
        await UserSchedulingService.updateUserSellerAccounts(userId);
        
        res.status(200).json(
            new ApiResponse(200, null, "User seller accounts updated in scheduling system")
        );
    } catch (error) {
        logger.error(`Error updating user accounts for ${userId}:`, error);
        throw new ApiError(500, "Failed to update user accounts in scheduling system");
    }
});

/**
 * Get user's scheduling information
 */
const getUserSchedule = asyncHandler(async (req, res) => {
    const userId = req.userId; // From auth middleware

    try {
        const UserUpdateSchedule = require('../models/UserUpdateScheduleModel.js');
        const schedule = await UserUpdateSchedule.findOne({ userId }).populate('userId', 'firstName lastName email');
        
        if (!schedule) {
            throw new ApiError(404, "User schedule not found");
        }
        
        res.status(200).json(
            new ApiResponse(200, schedule, "User schedule retrieved successfully")
        );
    } catch (error) {
        logger.error(`Error getting user schedule for ${userId}:`, error);
        throw new ApiError(500, "Failed to retrieve user schedule");
    }
});

/**
 * Get update statistics for monitoring
 */
const getUpdateStats = asyncHandler(async (req, res) => {
    try {
        const stats = await DataUpdateService.getUpdateStats();
        
        res.status(200).json(
            new ApiResponse(200, stats, "Update statistics retrieved successfully")
        );
    } catch (error) {
        logger.error('Error getting update stats:', error);
        throw new ApiError(500, "Failed to retrieve update statistics");
    }
});

/**
 * Initialize all user schedules (admin function)
 */
const initializeAllSchedules = asyncHandler(async (req, res) => {
    try {
        const initialized = await UserSchedulingService.initializeAllUserSchedules();
        
        res.status(200).json(
            new ApiResponse(200, { initialized }, "All user schedules initialized successfully")
        );
    } catch (error) {
        logger.error('Error initializing all schedules:', error);
        throw new ApiError(500, "Failed to initialize all user schedules");
    }
});

/**
 * Get scheduling distribution statistics (admin function)
 */
const getScheduleStats = asyncHandler(async (req, res) => {
    try {
        const stats = await UserSchedulingService.getScheduleStats();
        
        res.status(200).json(
            new ApiResponse(200, stats, "Schedule statistics retrieved successfully")
        );
    } catch (error) {
        logger.error('Error getting schedule stats:', error);
        throw new ApiError(500, "Failed to retrieve schedule statistics");
    }
});

/**
 * Clear old cache entries manually
 */
const cleanupCache = asyncHandler(async (req, res) => {
    try {
        const deletedCount = await DataUpdateService.cleanupOldCache();
        
        res.status(200).json(
            new ApiResponse(200, { deletedCount }, "Cache cleanup completed successfully")
        );
    } catch (error) {
        logger.error('Error cleaning up cache:', error);
        throw new ApiError(500, "Failed to cleanup cache");
    }
});

/**
 * Emergency stop all background jobs
 */
const emergencyStop = asyncHandler(async (req, res) => {
    try {
        jobScheduler.stopAllJobs();
        
        res.status(200).json(
            new ApiResponse(200, null, "All background jobs stopped successfully")
        );
    } catch (error) {
        logger.error('Error stopping all jobs:', error);
        throw new ApiError(500, "Failed to stop all jobs");
    }
});

/**
 * Restart all background jobs
 */
const restartJobs = asyncHandler(async (req, res) => {
    try {
        jobScheduler.startAllJobs();
        
        res.status(200).json(
            new ApiResponse(200, null, "All background jobs restarted successfully")
        );
    } catch (error) {
        logger.error('Error restarting all jobs:', error);
        throw new ApiError(500, "Failed to restart all jobs");
    }
});

/**
 * Rebalance all users for optimal distribution (Admin function)
 */
const rebalanceUsers = asyncHandler(async (req, res) => {
    try {
        const rebalanced = await UserSchedulingService.rebalanceAllUsers();
        
        res.status(200).json(
            new ApiResponse(200, { rebalanced }, "User rebalancing completed successfully")
        );
    } catch (error) {
        logger.error('Error rebalancing users:', error);
        throw new ApiError(500, "Failed to rebalance users");
    }
});

/**
 * Get detailed distribution statistics with balance metrics
 */
const getDetailedScheduleStats = asyncHandler(async (req, res) => {
    try {
        const detailedStats = await UserSchedulingService.getScheduleStats();
        
        res.status(200).json(
            new ApiResponse(200, detailedStats, "Detailed schedule statistics retrieved successfully")
        );
    } catch (error) {
        logger.error('Error getting detailed schedule stats:', error);
        throw new ApiError(500, "Failed to retrieve detailed schedule statistics");
    }
});

module.exports = {
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
}; 
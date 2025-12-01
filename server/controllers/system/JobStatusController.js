/**
 * JobStatusController.js
 * 
 * API endpoints for querying job status
 * 
 * Provides endpoints to:
 * - Get job status by userId
 * - Get job status by jobId
 * - Get recent jobs
 * - Get queue statistics
 */

const JobStatus = require('../../models/system/JobStatusModel.js');
const { getQueueStats } = require('../../Services/BackgroundJobs/producer.js');
const { getQueue } = require('../../Services/BackgroundJobs/queue.js');
const logger = require('../../utils/Logger.js');
const ApiResponse = require('../../utils/ApiResponse.js');
const ApiError = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');

/**
 * Get job status by userId
 * 
 * Returns the most recent job status for a user
 * 
 * GET /api/jobs/status/user/:userId
 */
const getJobStatusByUserId = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
        return res.status(400).json(
            new ApiError(400, 'User ID is required')
        );
    }

    try {
        // Get the most recent job for this user
        const jobStatus = await JobStatus.findOne({ userId })
            .sort({ createdAt: -1 })
            .lean();

        if (!jobStatus) {
            return res.status(200).json(
                new ApiResponse(200, {
                    userId,
                    status: 'not_found',
                    message: 'No jobs found for this user'
                }, 'No job status found')
            );
        }

        // Get current job state from BullMQ if job exists
        let currentState = jobStatus.status;
        try {
            const queue = getQueue();
            const job = await queue.getJob(jobStatus.jobId);
            
            if (job) {
                const state = await job.getState();
                currentState = state; // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
            }
        } catch (error) {
            logger.warn(`Failed to get current job state for ${jobStatus.jobId}:`, error);
        }

        return res.status(200).json(
            new ApiResponse(200, {
                ...jobStatus,
                currentState
            }, 'Job status retrieved successfully')
        );

    } catch (error) {
        logger.error(`Error getting job status for user ${userId}:`, error);
        return res.status(500).json(
            new ApiError(500, `Failed to get job status: ${error.message}`)
        );
    }
});

/**
 * Get job status by jobId
 * 
 * Returns detailed job status for a specific job
 * 
 * GET /api/jobs/status/job/:jobId
 */
const getJobStatusByJobId = asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    if (!jobId) {
        return res.status(400).json(
            new ApiError(400, 'Job ID is required')
        );
    }

    try {
        // Get job status from database
        const jobStatus = await JobStatus.findOne({ jobId }).lean();

        if (!jobStatus) {
            return res.status(404).json(
                new ApiError(404, 'Job not found')
            );
        }

        // Get current job state from BullMQ
        let currentState = jobStatus.status;
        let jobData = null;
        try {
            const queue = getQueue();
            const job = await queue.getJob(jobId);
            
            if (job) {
                currentState = await job.getState();
                jobData = {
                    id: job.id,
                    name: job.name,
                    data: job.data,
                    opts: job.opts,
                    progress: job.progress,
                    attemptsMade: job.attemptsMade,
                    timestamp: job.timestamp,
                    processedOn: job.processedOn,
                    finishedOn: job.finishedOn
                };
            }
        } catch (error) {
            logger.warn(`Failed to get BullMQ job data for ${jobId}:`, error);
        }

        return res.status(200).json(
            new ApiResponse(200, {
                ...jobStatus,
                currentState,
                bullmqJob: jobData
            }, 'Job status retrieved successfully')
        );

    } catch (error) {
        logger.error(`Error getting job status for job ${jobId}:`, error);
        return res.status(500).json(
            new ApiError(500, `Failed to get job status: ${error.message}`)
        );
    }
});

/**
 * Get recent jobs
 * 
 * Returns a list of recent jobs with optional filtering
 * 
 * GET /api/jobs/recent?limit=50&status=completed
 */
const getRecentJobs = asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit || '50', 10);
    const status = req.query.status; // Optional filter by status
    const userId = req.query.userId; // Optional filter by userId

    try {
        const query = {};
        if (status) {
            query.status = status;
        }
        if (userId) {
            query.userId = userId;
        }

        const jobs = await JobStatus.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return res.status(200).json(
            new ApiResponse(200, {
                jobs,
                count: jobs.length,
                limit
            }, 'Recent jobs retrieved successfully')
        );

    } catch (error) {
        logger.error('Error getting recent jobs:', error);
        return res.status(500).json(
            new ApiError(500, `Failed to get recent jobs: ${error.message}`)
        );
    }
});

/**
 * Get queue statistics
 * 
 * Returns current queue state (waiting, active, completed, failed counts)
 * 
 * GET /api/jobs/queue/stats
 */
const getQueueStatistics = asyncHandler(async (req, res) => {
    try {
        const stats = await getQueueStats();

        return res.status(200).json(
            new ApiResponse(200, stats, 'Queue statistics retrieved successfully')
        );

    } catch (error) {
        logger.error('Error getting queue statistics:', error);
        return res.status(500).json(
            new ApiError(500, `Failed to get queue statistics: ${error.message}`)
        );
    }
});

/**
 * Get failed jobs for inspection
 * 
 * Returns failed jobs with error details for debugging
 * 
 * GET /api/jobs/failed?limit=100
 */
const getFailedJobs = asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit || '100', 10);

    try {
        const failedJobs = await JobStatus.find({ status: 'failed' })
            .sort({ failedAt: -1 })
            .limit(limit)
            .lean();

        return res.status(200).json(
            new ApiResponse(200, {
                jobs: failedJobs,
                count: failedJobs.length
            }, 'Failed jobs retrieved successfully')
        );

    } catch (error) {
        logger.error('Error getting failed jobs:', error);
        return res.status(500).json(
            new ApiError(500, `Failed to get failed jobs: ${error.message}`)
        );
    }
});

module.exports = {
    getJobStatusByUserId,
    getJobStatusByJobId,
    getRecentJobs,
    getQueueStatistics,
    getFailedJobs
};


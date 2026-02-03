/**
 * IntegrationJobController.js
 * 
 * Controller for managing first-time integration jobs
 * 
 * This controller provides endpoints to:
 * - Trigger a new integration job (non-blocking)
 * - Check the status of an integration job
 * - Get user's active integration job
 * 
 * These endpoints are SEPARATE from existing endpoints and
 * do NOT affect any existing functionality.
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { addIntegrationJob, getIntegrationJobStatus } = require('../../Services/BackgroundJobs/integrationQueue.js');
const JobStatus = require('../../models/system/JobStatusModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Trigger a new integration job for the user
 * 
 * This endpoint:
 * 1. Checks if user already has an active job
 * 2. If not, creates a new job and returns immediately
 * 3. Returns job ID for status polling
 * 
 * @route POST /api/integration/trigger
 */
const triggerIntegrationJob = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;

    if (!userId) {
        logger.error('[IntegrationJob] Missing userId in request');
        return res.status(400).json(
            new ApiError(400, 'User ID is required')
        );
    }

    if (!country || !region) {
        logger.error('[IntegrationJob] Missing country or region in request');
        return res.status(400).json(
            new ApiError(400, 'Country and region are required')
        );
    }

    try {
        logger.info(`[IntegrationJob] Triggering integration job for user ${userId}, ${country}-${region}`);

        // Add job to the integration queue
        const result = await addIntegrationJob(userId, country, region);

        if (result.isExisting) {
            // Job already exists
            logger.info(`[IntegrationJob] Existing job found for user ${userId}. State: ${result.state}`);
            return res.status(200).json(
                new ApiResponse(200, {
                    jobId: result.jobId,
                    status: result.state,
                    isExisting: true,
                    message: 'An integration job is already in progress for this account'
                }, 'Integration job already in progress')
            );
        }

        // New job created
        logger.info(`[IntegrationJob] Created new integration job ${result.jobId} for user ${userId}`);
        return res.status(202).json(
            new ApiResponse(202, {
                jobId: result.jobId,
                status: 'waiting',
                isExisting: false,
                message: 'Integration job has been queued. Poll the status endpoint for updates.'
            }, 'Integration job queued successfully')
        );

    } catch (error) {
        logger.error('[IntegrationJob] Error triggering integration job:', error);
        return res.status(500).json(
            new ApiError(500, `Failed to trigger integration job: ${error.message}`)
        );
    }
});

/**
 * Get the status of an integration job
 * 
 * @route GET /api/integration/status/:jobId
 */
const getJobStatus = asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    if (!jobId) {
        return res.status(400).json(
            new ApiError(400, 'Job ID is required')
        );
    }

    try {
        // Get job status from queue
        const queueStatus = await getIntegrationJobStatus(jobId);

        if (!queueStatus.found) {
            // Try to get from database (for completed/failed jobs that may have been removed from queue)
            const dbStatus = await JobStatus.findOne({ jobId }).lean();
            
            if (dbStatus) {
                return res.status(200).json(
                    new ApiResponse(200, {
                        jobId: dbStatus.jobId,
                        status: dbStatus.status,
                        progress: dbStatus.status === 'completed' ? 100 : (dbStatus.status === 'failed' ? 0 : 50),
                        startedAt: dbStatus.startedAt,
                        completedAt: dbStatus.completedAt,
                        failedAt: dbStatus.failedAt,
                        duration: dbStatus.duration,
                        error: dbStatus.error,
                        metadata: dbStatus.metadata
                    }, 'Job status retrieved from database')
                );
            }

            return res.status(404).json(
                new ApiError(404, 'Job not found')
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                jobId: queueStatus.jobId,
                status: queueStatus.status,
                progress: queueStatus.progress,
                processedOn: queueStatus.processedOn,
                finishedOn: queueStatus.finishedOn,
                attemptsMade: queueStatus.attemptsMade,
                result: queueStatus.returnvalue,
                error: queueStatus.failedReason
            }, 'Job status retrieved')
        );

    } catch (error) {
        logger.error('[IntegrationJob] Error getting job status:', error);
        return res.status(500).json(
            new ApiError(500, `Failed to get job status: ${error.message}`)
        );
    }
});

/**
 * Get user's active integration job (if any)
 * 
 * @route GET /api/integration/active
 */
const getActiveJob = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;

    if (!userId) {
        return res.status(400).json(
            new ApiError(400, 'User ID is required')
        );
    }

    try {
        // Construct the expected job ID
        const expectedJobId = `integration-${userId}-${country}-${region}`;
        
        // Get job status from queue
        const queueStatus = await getIntegrationJobStatus(expectedJobId);

        // If job is in queue and active/waiting/delayed, return it
        if (queueStatus.found && (queueStatus.status === 'waiting' || queueStatus.status === 'active' || queueStatus.status === 'delayed')) {
            return res.status(200).json(
                new ApiResponse(200, {
                    hasActiveJob: true,
                    jobId: queueStatus.jobId,
                    status: queueStatus.status,
                    progress: queueStatus.progress
                }, 'Active job found')
            );
        }
        
        // If job is completed in queue, return it as completed
        if (queueStatus.found && queueStatus.status === 'completed') {
            return res.status(200).json(
                new ApiResponse(200, {
                    hasActiveJob: true,
                    jobId: queueStatus.jobId,
                    status: 'completed',
                    progress: 100
                }, 'Job already completed')
            );
        }

        // Check database for recent jobs (including recently completed within 2 hours)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const recentJob = await JobStatus.findOne({
            userId,
            'metadata.country': country,
            'metadata.region': region,
            'metadata.jobType': 'integration',
            $or: [
                { status: { $in: ['pending', 'running'] } },
                { status: 'completed', completedAt: { $gte: twoHoursAgo } }
            ]
        }).sort({ createdAt: -1 }).lean();

        if (recentJob) {
            return res.status(200).json(
                new ApiResponse(200, {
                    hasActiveJob: true,
                    jobId: recentJob.jobId,
                    status: recentJob.status,
                    progress: recentJob.status === 'completed' ? 100 : (recentJob.status === 'running' ? 50 : 0)
                }, recentJob.status === 'completed' ? 'Job already completed' : 'Active job found')
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                hasActiveJob: false,
                message: 'No active integration job'
            }, 'No active job')
        );

    } catch (error) {
        logger.error('[IntegrationJob] Error getting active job:', error);
        return res.status(500).json(
            new ApiError(500, `Failed to get active job: ${error.message}`)
        );
    }
});

/**
 * Get user's integration job history
 * 
 * @route GET /api/integration/history
 */
const getJobHistory = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 10;

    if (!userId) {
        return res.status(400).json(
            new ApiError(400, 'User ID is required')
        );
    }

    try {
        const jobs = await JobStatus.find({
            userId,
            'metadata.jobType': 'integration'
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

        return res.status(200).json(
            new ApiResponse(200, {
                jobs: jobs.map(job => ({
                    jobId: job.jobId,
                    status: job.status,
                    country: job.metadata?.country,
                    region: job.metadata?.region,
                    startedAt: job.startedAt,
                    completedAt: job.completedAt,
                    duration: job.duration,
                    error: job.error
                })),
                total: jobs.length
            }, 'Job history retrieved')
        );

    } catch (error) {
        logger.error('[IntegrationJob] Error getting job history:', error);
        return res.status(500).json(
            new ApiError(500, `Failed to get job history: ${error.message}`)
        );
    }
});

/**
 * Admin endpoint to trigger integration job for any user
 * 
 * This endpoint allows super admins to manually trigger integration
 * for a specific user, useful for debugging or re-running failed integrations.
 * 
 * @route POST /api/integration/admin/trigger
 */
const adminTriggerIntegrationJob = asyncHandler(async (req, res) => {
    const { userId, country, region } = req.body;

    if (!userId) {
        logger.error('[IntegrationJob] Admin trigger: Missing userId in request body');
        return res.status(400).json(
            new ApiError(400, 'User ID is required in request body')
        );
    }

    if (!country || !region) {
        logger.error('[IntegrationJob] Admin trigger: Missing country or region in request body');
        return res.status(400).json(
            new ApiError(400, 'Country and region are required in request body')
        );
    }

    try {
        logger.info(`[IntegrationJob] Admin triggering integration job for user ${userId}, ${country}-${region}`, {
            triggeredBy: req.SuperAdminId || 'unknown'
        });

        // Add job to the integration queue
        const result = await addIntegrationJob(userId, country, region);

        if (result.isExisting) {
            // Job already exists
            logger.info(`[IntegrationJob] Admin trigger: Existing job found for user ${userId}. State: ${result.state}`);
            return res.status(200).json(
                new ApiResponse(200, {
                    jobId: result.jobId,
                    status: result.state,
                    isExisting: true,
                    userId,
                    country,
                    region,
                    message: 'An integration job is already in progress for this user'
                }, 'Integration job already in progress')
            );
        }

        // New job created
        logger.info(`[IntegrationJob] Admin trigger: Created new integration job ${result.jobId} for user ${userId}`);
        return res.status(202).json(
            new ApiResponse(202, {
                jobId: result.jobId,
                status: 'waiting',
                isExisting: false,
                userId,
                country,
                region,
                message: 'Integration job has been queued successfully'
            }, 'Integration job queued successfully')
        );

    } catch (error) {
        logger.error('[IntegrationJob] Admin trigger: Error triggering integration job:', error);
        return res.status(500).json(
            new ApiError(500, `Failed to trigger integration job: ${error.message}`)
        );
    }
});

module.exports = {
    triggerIntegrationJob,
    getJobStatus,
    getActiveJob,
    getJobHistory,
    adminTriggerIntegrationJob
};


/**
 * integrationWorker.js
 * 
 * BullMQ Worker for First-Time User Integration
 * 
 * This worker handles the 'user-integration' queue SEPARATELY from
 * the existing 'user-data-processing' queue and its workers.
 * 
 * IMPORTANT:
 * - This is a SEPARATE worker that only processes integration jobs
 * - It does NOT affect the existing worker.js or processUserData
 * - It can run in the same process as the existing worker (different queue)
 * - Or it can run as a completely separate process
 * 
 * Usage:
 *   node server/Services/BackgroundJobs/integrationWorker.js
 *   OR
 *   pm2 start server/Services/BackgroundJobs/integrationWorker.js --name integration-worker
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { Worker } = require('bullmq');
const { getQueueRedisConnection } = require('../../config/queueRedisConn.js');
const { Integration } = require('../main/Integration.js');
const { INTEGRATION_QUEUE_NAME } = require('./integrationQueue.js');
const JobStatus = require('../../models/system/JobStatusModel.js');
const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');
const { connectRedis } = require('../../config/redisConn.js');

// Worker configuration
const WORKER_CONCURRENCY = parseInt(process.env.INTEGRATION_WORKER_CONCURRENCY || '2', 10); // Process 2 jobs concurrently (API rate limits)
const WORKER_NAME = process.env.INTEGRATION_WORKER_NAME || `integration-worker-${process.pid}`;

// Initialize database and cache connections
let isInitialized = false;

async function initializeConnections() {
    if (isInitialized) {
        return;
    }

    try {
        // Connect to MongoDB (required for database queries)
        await dbConnect();
        logger.info(`[IntegrationWorker:${WORKER_NAME}] Connected to MongoDB`);

        // Connect to Redis Cloud (for cache operations)
        await connectRedis();
        logger.info(`[IntegrationWorker:${WORKER_NAME}] Connected to Redis Cloud (for cache)`);

        isInitialized = true;
    } catch (error) {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Failed to initialize connections:`, error);
        throw error;
    }
}

// Redis connection for worker
const connection = getQueueRedisConnection();

/**
 * Update job status in database for tracking
 * 
 * @param {string} jobId - BullMQ job ID
 * @param {string} userId - User ID
 * @param {string} status - Job status
 * @param {Object} metadata - Additional metadata
 */
async function updateJobStatus(jobId, userId, status, metadata = {}) {
    try {
        await JobStatus.findOneAndUpdate(
            { jobId },
            {
                jobId,
                userId,
                status,
                ...metadata,
                updatedAt: new Date()
            },
            {
                upsert: true,
                new: true
            }
        );
    } catch (error) {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Failed to update job status for ${jobId}:`, error);
    }
}

/**
 * Process an integration job
 * Calls Integration.getSpApiData() to fetch all data for a user
 * 
 * @param {Object} job - BullMQ job object
 * @returns {Object} Result object
 */
async function processIntegrationJob(job) {
    const { userId, country, region } = job.data;
    const jobStartTime = Date.now();

    logger.info(`[IntegrationWorker:${WORKER_NAME}] Starting integration job ${job.id} for user ${userId}, ${country}-${region}`);

    try {
        // Update job status to 'running'
        await updateJobStatus(job.id, userId, 'running', {
            startedAt: new Date().toISOString(),
            workerName: WORKER_NAME,
            metadata: { country, region, jobType: 'integration' }
        });

        // Update job progress
        await job.updateProgress(10);

        // Call the Integration service to fetch all data
        // This is the comprehensive first-time fetch
        logger.info(`[IntegrationWorker:${WORKER_NAME}] Calling Integration.getSpApiData for user ${userId}`);
        const result = await Integration.getSpApiData(userId, region, country);

        // Update job progress
        await job.updateProgress(90);

        const duration = Date.now() - jobStartTime;

        if (result.success) {
            // Update job status to 'completed'
            await updateJobStatus(job.id, userId, 'completed', {
                completedAt: new Date().toISOString(),
                duration,
                metadata: {
                    country,
                    region,
                    jobType: 'integration',
                    successRate: result.summary?.successRate,
                    totalServices: result.summary?.totalServices,
                    successfulServices: result.summary?.successfulServices,
                    failedServices: result.summary?.failedServices
                }
            });

            // Update final progress
            await job.updateProgress(100);

            logger.info(`[IntegrationWorker:${WORKER_NAME}] Integration job ${job.id} completed successfully for user ${userId}`, {
                duration,
                successRate: result.summary?.successRate
            });

            return {
                success: true,
                duration,
                summary: result.summary
            };
        } else {
            // Integration returned failure
            throw new Error(result.error || 'Integration failed');
        }

    } catch (error) {
        const duration = Date.now() - jobStartTime;

        logger.error(`[IntegrationWorker:${WORKER_NAME}] Integration job ${job.id} failed for user ${userId}:`, error);

        // Update job status to 'failed'
        await updateJobStatus(job.id, userId, 'failed', {
            failedAt: new Date().toISOString(),
            duration,
            error: error.message,
            stack: error.stack,
            attemptNumber: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts,
            metadata: { country, region, jobType: 'integration' }
        });

        // Re-throw to trigger BullMQ retry mechanism
        throw error;
    }
}

/**
 * Initialize connections and create worker
 */
async function startIntegrationWorker() {
    // Initialize MongoDB and Redis connections first
    await initializeConnections();

    // Create and configure the worker for the integration queue
    const worker = new Worker(
        INTEGRATION_QUEUE_NAME,
        async (job) => {
            return await processIntegrationJob(job);
        },
        {
            connection,
            prefix: 'bullmq', // Same prefix as other queues
            concurrency: WORKER_CONCURRENCY, // Process N jobs concurrently
            // Stall detection: Set to 4 hours to accommodate long-running report API jobs
            // Jobs can take hours waiting for report API responses, so we need a longer interval
            stallInterval: 4 * 60 * 60 * 1000, // 4 hours in milliseconds
            maxStalledCount: 2, // Allow 2 stalls before failing (handles worker restarts)
            limiter: {
                // Rate limiting for API calls
                max: 5, // Max 5 jobs
                duration: 60000 // Per minute
            },
            // Job retention settings
            removeOnComplete: {
                age: 4 * 3600, // 4 hours
                count: 100
            },
            removeOnFail: {
                age: 24 * 3600, // 1 day
                count: 500
            }
        }
    );

    // Worker event listeners
    worker.on('active', (job) => {
        logger.info(`[IntegrationWorker:${WORKER_NAME}] Job ${job.id} is now ACTIVE`, {
            userId: job.data.userId,
            country: job.data.country,
            region: job.data.region
        });
    });

    worker.on('completed', (job, result) => {
        logger.info(`[IntegrationWorker:${WORKER_NAME}] Job ${job.id} completed`, {
            userId: job.data.userId,
            country: job.data.country,
            region: job.data.region,
            duration: result?.duration
        });
    });

    worker.on('failed', (job, err) => {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Job ${job?.id || 'unknown'} failed`, {
            userId: job?.data?.userId,
            country: job?.data?.country,
            region: job?.data?.region,
            error: err.message,
            attemptsMade: job?.attemptsMade,
            maxAttempts: job?.opts?.attempts
        });
    });

    worker.on('error', (err) => {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Worker error:`, err);
    });

    worker.on('stalled', (jobId) => {
        logger.warn(`[IntegrationWorker:${WORKER_NAME}] Job ${jobId} stalled`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        logger.info(`[IntegrationWorker:${WORKER_NAME}] Received SIGTERM, closing worker gracefully...`);
        await worker.close();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        logger.info(`[IntegrationWorker:${WORKER_NAME}] Received SIGINT, closing worker gracefully...`);
        await worker.close();
        process.exit(0);
    });

    // Log worker startup
    logger.info(`[IntegrationWorker:${WORKER_NAME}] Integration worker started with concurrency: ${WORKER_CONCURRENCY}`);

    // Debug: Check queue status every 10 seconds
    const { getIntegrationQueue } = require('./integrationQueue.js');
    let statusCheckCount = 0;
    setInterval(async () => {
        try {
            const queue = getIntegrationQueue();
            const waiting = await queue.getWaitingCount();
            const active = await queue.getActiveCount();
            const completed = await queue.getCompletedCount();
            const failed = await queue.getFailedCount();
            
            statusCheckCount++;
            // Log every 6 checks (every minute) or immediately if there are jobs
            if (waiting > 0 || active > 0 || statusCheckCount % 6 === 0) {
                logger.info(`[IntegrationWorker:${WORKER_NAME}] Queue status - Waiting: ${waiting}, Active: ${active}, Completed: ${completed}, Failed: ${failed}`);
            }
        } catch (error) {
            logger.error(`[IntegrationWorker:${WORKER_NAME}] Error checking queue status:`, error.message);
        }
    }, 10000);

    return worker;
}

// Start the worker
startIntegrationWorker()
    .then((worker) => {
        // Export for testing
        module.exports = { worker };
    })
    .catch((error) => {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Failed to start worker:`, error);
        process.exit(1);
    });


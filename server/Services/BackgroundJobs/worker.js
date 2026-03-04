/**
 * worker.js
 * 
 * BullMQ Worker - Processes jobs from the queue
 * 
 * This worker runs in a SEPARATE process and:
 * - Pulls jobs from the queue
 * - Calls processUserData(userId) for each job
 * - Handles retries automatically
 * - Tracks progress and updates job status
 * - Implements controlled concurrency
 * 
 * IMPORTANT: This file should be run as a separate process (via PM2)
 * and should NEVER be imported by the API server.
 * 
 * Usage:
 *   node server/Services/BackgroundJobs/worker.js
 *   OR
 *   pm2 start server/Services/BackgroundJobs/worker.js
 */

require('dotenv').config();

const { Worker } = require('bullmq');
const { getQueueRedisConnection } = require('../../config/queueRedisConn.js');
const { processUserData } = require('./processUserData.js');
const { QUEUE_NAME } = require('./queue.js');
const JobStatus = require('../../models/system/JobStatusModel.js');
const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');
const { connectRedis } = require('../../config/redisConn.js');

// Worker configuration
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '3', 10); // Process 3 jobs concurrently
// Debug: Log what WORKER_NAME will be set to
const envWorkerName = process.env.WORKER_NAME;
const pidBasedName = `worker-${process.pid}`;
const WORKER_NAME = envWorkerName || pidBasedName;

// Lock configuration for long-running jobs (prevents stalling)
// These settings match integrationWorker.js for consistency
const LOCK_DURATION = 2 * 60 * 60 * 1000; // 2 hours - job lock duration
const LOCK_EXTENSION_INTERVAL = 15 * 60 * 1000; // Extend lock every 15 minutes
const LOCK_EXTENSION_AMOUNT = 60 * 60 * 1000; // Extend by 1 hour each time

// Log worker name source for debugging (only on startup)
if (!global.workerNameLogged) {
    console.log(`[Worker Debug] process.env.WORKER_NAME: ${envWorkerName || 'undefined'}`);
    console.log(`[Worker Debug] process.pid: ${process.pid}`);
    console.log(`[Worker Debug] Final WORKER_NAME: ${WORKER_NAME}`);
    global.workerNameLogged = true;
}

// Initialize database and cache connections
let isInitialized = false;

async function initializeConnections() {
    if (isInitialized) {
        return;
    }

    try {
        // Connect to MongoDB (required for database queries)
        await dbConnect();
        logger.info('[Worker] Connected to MongoDB');

        // Connect to Redis Cloud (for cache operations)
        await connectRedis();
        logger.info('[Worker] Connected to Redis Cloud (for cache)');

        isInitialized = true;
    } catch (error) {
        logger.error('[Worker] Failed to initialize connections:', error);
        throw error;
    }
}

// Redis connection for worker (local Redis for queue)
const connection = getQueueRedisConnection();

/**
 * Update job status in database for tracking
 * 
 * @param {string} jobId - BullMQ job ID
 * @param {string} userId - User ID
 * @param {string} status - Job status (pending|running|completed|failed)
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
        // Don't fail the job if status update fails
        logger.error(`[Worker:${WORKER_NAME}] Failed to update job status for ${jobId}:`, error);
    }
}

/**
 * Extend job lock with retry logic for transient failures.
 * Uses exponential backoff to handle temporary network issues.
 * 
 * @param {Object} job - BullMQ job object
 * @param {number} extensionAmount - Lock extension duration in ms
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @returns {Promise<boolean>} True if extension succeeded, false otherwise
 */
async function extendLockWithRetry(job, extensionAmount, maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await job.extendLock(job.token, extensionAmount);
            return true;
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt - 1) * 1000;
                logger.warn(`[Worker:${WORKER_NAME}] Lock extension attempt ${attempt}/${maxRetries} failed for job ${job.id}, retrying in ${delay}ms:`, error.message);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    logger.error(`[Worker:${WORKER_NAME}] Lock extension failed after ${maxRetries} attempts for job ${job.id}:`, lastError?.message);
    return false;
}

/**
 * Run an async function with periodic lock extension to prevent job stalling.
 * This is critical for jobs that can run for hours (e.g., SP-API reports, Amazon Ads).
 * 
 * @param {Object} job - BullMQ job object
 * @param {Function} asyncFn - Async function to execute
 * @returns {Promise} Result of the async function
 */
async function runWithLockExtension(job, asyncFn) {
    let extensionCount = 0;
    let failedExtensions = 0;
    let isRunning = true;

    const lockExtensionTimer = setInterval(async () => {
        if (!isRunning) return;
        
        const success = await extendLockWithRetry(job, LOCK_EXTENSION_AMOUNT);
        if (success) {
            extensionCount++;
            failedExtensions = 0;
            logger.info(`[Worker:${WORKER_NAME}] Extended lock for job ${job.id} (extension #${extensionCount})`);
        } else {
            failedExtensions++;
            if (failedExtensions >= 2) {
                logger.error(`[Worker:${WORKER_NAME}] Multiple consecutive lock extension failures (${failedExtensions}) for job ${job.id} - job may be at risk of stalling`);
            }
        }
    }, LOCK_EXTENSION_INTERVAL);

    try {
        return await asyncFn();
    } finally {
        isRunning = false;
        clearInterval(lockExtensionTimer);
        if (extensionCount > 0 || failedExtensions > 0) {
            logger.info(`[Worker:${WORKER_NAME}] Lock extension timer cleared for job ${job.id} - ${extensionCount} successful extensions, ${failedExtensions} final failures`);
        }
    }
}

/**
 * Initialize connections and create worker
 */
async function startWorker() {
    // Initialize MongoDB and Redis connections first
    await initializeConnections();

    // Create and configure the worker
    const worker = new Worker(
        QUEUE_NAME,
        async (job) => {
            const { userId } = job.data;
            const jobStartTime = Date.now();

            logger.info(`[Worker:${WORKER_NAME}] Starting job ${job.id} for user ${userId}`);

            try {
                // Update job status to 'running'
                await updateJobStatus(job.id, userId, 'running', {
                    startedAt: new Date().toISOString(),
                    workerName: WORKER_NAME
                });

                // Update job progress
                await job.updateProgress(10);

                // Call the core business logic function with lock extension
                // This prevents job stalling during long-running API calls
                // The lock is extended every 15 minutes to keep the job alive
                const result = await runWithLockExtension(job, async () => {
                    return await processUserData(userId);
                });

                // Update job progress
                await job.updateProgress(90);

                // Update job status to 'completed'
                await updateJobStatus(job.id, userId, 'completed', {
                    completedAt: new Date().toISOString(),
                    duration: Date.now() - jobStartTime,
                    accountsProcessed: result.accountsProcessed,
                    accountsSucceeded: result.accountsSucceeded,
                    accountsFailed: result.accountsFailed,
                    errors: result.errors
                });

                // Update final progress
                await job.updateProgress(100);

                logger.info(`[Worker:${WORKER_NAME}] Job ${job.id} completed successfully for user ${userId}`, {
                    duration: Date.now() - jobStartTime,
                    accountsProcessed: result.accountsProcessed,
                    accountsSucceeded: result.accountsSucceeded
                });

                // Return result for job completion tracking
                return {
                    success: result.success,
                    accountsProcessed: result.accountsProcessed,
                    accountsSucceeded: result.accountsSucceeded,
                    accountsFailed: result.accountsFailed,
                    duration: Date.now() - jobStartTime
                };

            } catch (error) {
                const duration = Date.now() - jobStartTime;

                logger.error(`[Worker:${WORKER_NAME}] Job ${job.id} failed for user ${userId}:`, error);

                // Update job status to 'failed'
                await updateJobStatus(job.id, userId, 'failed', {
                    failedAt: new Date().toISOString(),
                    duration,
                    error: error.message,
                    stack: error.stack,
                    attemptNumber: job.attemptsMade + 1,
                    maxAttempts: job.opts.attempts
                });

                // Re-throw to trigger BullMQ retry mechanism
                throw error;
            }
        },
        {
            connection,
            prefix: 'bullmq', // Same prefix as queue
            concurrency: WORKER_CONCURRENCY, // Process N jobs concurrently
            // Lock duration: 2 hours - prevents immediate stalling when worker crashes
            // Without this, BullMQ uses default 30 seconds which causes stalls on worker restart
            lockDuration: LOCK_DURATION,
            // Stall detection: Set to 4 hours to accommodate long-running report API jobs
            // Jobs can take hours waiting for report API responses, so we need a longer interval
            stallInterval: 4 * 60 * 60 * 1000, // 4 hours in milliseconds
            maxStalledCount: 2, // Allow 2 stalls before failing (handles worker restarts)
            limiter: {
                // Optional: Rate limiting
                max: 10, // Max 10 jobs
                duration: 60000 // Per minute
            },
            // Remove completed jobs after shorter period (optimized for memory)
            removeOnComplete: {
                age: 2 * 3600, // 2 hours (matches queue config)
                count: 100 // Keep last 100 (matches queue config)
            },
            // Remove failed jobs after shorter period
            removeOnFail: {
                age: 24 * 3600, // 1 day (matches queue config)
                count: 500 // Keep last 500 (matches queue config)
            }
        }
    );

    // Worker event listeners
    worker.on('completed', (job, result) => {
        logger.info(`[Worker:${WORKER_NAME}] Job ${job.id} completed`, {
            userId: job.data.userId,
            duration: result?.duration,
            accountsProcessed: result?.accountsProcessed
        });
    });

    worker.on('failed', (job, err) => {
        logger.error(`[Worker:${WORKER_NAME}] Job ${job?.id || 'unknown'} failed`, {
            userId: job?.data?.userId,
            error: err.message,
            attemptsMade: job?.attemptsMade,
            maxAttempts: job?.opts?.attempts
        });
    });

    worker.on('error', (err) => {
        logger.error(`[Worker:${WORKER_NAME}] Worker error:`, err);
    });

    worker.on('stalled', (jobId) => {
        logger.warn(`[Worker:${WORKER_NAME}] Job ${jobId} stalled`);
    });

    // Graceful shutdown with timeout
    // Give current job time to finish, but don't wait forever
    // Increased to 30 minutes to allow long-running jobs to complete
    const SHUTDOWN_GRACE_MS = 30 * 60 * 1000; // 30 minutes
    let isShuttingDown = false;

    const gracefulShutdown = (signal) => {
        if (isShuttingDown) {
            logger.warn(`[Worker:${WORKER_NAME}] Already shutting down, ignoring ${signal}`);
            return;
        }
        isShuttingDown = true;

        logger.info(`[Worker:${WORKER_NAME}] Received ${signal}, closing worker gracefully (max ${SHUTDOWN_GRACE_MS / 60000} min)...`);

        let hasExited = false;
        const forceExit = () => {
            if (!hasExited) {
                hasExited = true;
                logger.warn(`[Worker:${WORKER_NAME}] Shutdown timeout reached - forcing exit. Active job will be retried after lock expiry.`);
                process.exit(1);
            }
        };

        // Set timeout for force exit
        const shutdownTimeout = setTimeout(forceExit, SHUTDOWN_GRACE_MS);

        // Try graceful close
        worker.close()
            .then(() => {
                clearTimeout(shutdownTimeout);
                if (!hasExited) {
                    hasExited = true;
                    logger.info(`[Worker:${WORKER_NAME}] Worker closed gracefully`);
                    process.exit(0);
                }
            })
            .catch((err) => {
                clearTimeout(shutdownTimeout);
                if (!hasExited) {
                    hasExited = true;
                    logger.error(`[Worker:${WORKER_NAME}] Error during graceful shutdown:`, err.message);
                    process.exit(1);
                }
            });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Log worker startup
    logger.info(`[Worker:${WORKER_NAME}] Worker started with concurrency: ${WORKER_CONCURRENCY}`);

    return worker;
}

// Start the worker
startWorker()
    .then((worker) => {
        // Export for testing (but should not be imported by API server)
        module.exports = { worker };
    })
    .catch((error) => {
        logger.error(`[Worker:${WORKER_NAME}] Failed to start worker:`, error);
        process.exit(1);
    });


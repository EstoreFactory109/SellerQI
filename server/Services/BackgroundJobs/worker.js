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
const { QUEUE_NAME, getQueue } = require('./queue.js');
const JobStatus = require('../../models/system/JobStatusModel.js');
const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');
const { connectRedis } = require('../../config/redisConn.js');
const { ScheduledIntegration } = require('../schedule/ScheduledIntegration.js');
const scheduledPhases = require('./scheduledPhases.js');

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
 * Process a phased scheduled job (new architecture).
 * Executes one phase, then enqueues the next phase as a separate BullMQ job.
 */
async function processScheduledPhase(job) {
    const { userId, phase, country, region, parentJobId, phaseData } = job.data;
    const jobStartTime = Date.now();
    const effectiveParentJobId = parentJobId || job.id;

    logger.info(`[Worker:${WORKER_NAME}] Starting scheduled phase ${phase} for user ${userId}, ${country}-${region}`);

    await updateJobStatus(job.id, userId, 'running', {
        startedAt: new Date().toISOString(),
        workerName: WORKER_NAME,
        metadata: { country, region, phase, parentJobId: effectiveParentJobId }
    });

    let result;
    switch (phase) {
        case scheduledPhases.PHASES.INIT:
            result = await ScheduledIntegration.executeScheduledInitPhase(userId, region, country);
            break;
        case scheduledPhases.PHASES.BATCH_1_2:
            result = await ScheduledIntegration.executeScheduledBatch1And2Phase(userId, region, country, phaseData || {});
            break;
        case scheduledPhases.PHASES.BATCH_3_4:
            result = await ScheduledIntegration.executeScheduledBatch3And4Phase(userId, region, country, phaseData || {});
            break;
        case scheduledPhases.PHASES.CALC_REVIEW:
            result = await ScheduledIntegration.executeScheduledCalcReviewPhase(userId, region, country, phaseData || {});
            break;
        case scheduledPhases.PHASES.FINALIZE:
            result = await ScheduledIntegration.executeScheduledFinalizePhase(userId, region, country, phaseData || {});
            break;
        default:
            throw new Error(`Unknown scheduled phase: ${phase}`);
    }

    if (!result.success) {
        throw new Error(result.error || `Phase ${phase} failed`);
    }

    const duration = Date.now() - jobStartTime;
    const nextPhase = scheduledPhases.getNextPhase(phase);

    if (nextPhase) {
        const nextJobData = scheduledPhases.createNextPhaseJobData(nextPhase, job.data, result);
        const nextJobId = scheduledPhases.generatePhaseJobId(effectiveParentJobId, nextPhase);

        const queue = getQueue();
        await queue.add('process-user-data', nextJobData, {
            jobId: nextJobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60000 },
            timeout: 2 * 60 * 60 * 1000
        });

        logger.info(`[Worker:${WORKER_NAME}] Phase ${phase} completed, enqueued next: ${nextPhase}`, { userId, duration, nextJobId });
    } else {
        logger.info(`[Worker:${WORKER_NAME}] All scheduled phases completed for user ${userId}, ${country}-${region}`, { duration });
    }

    await updateJobStatus(job.id, userId, 'completed', {
        completedAt: new Date().toISOString(),
        duration,
        metadata: { country, region, phase, nextPhase, parentJobId: effectiveParentJobId }
    });

    return { success: true, phase, nextPhase, duration, completed: !nextPhase };
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
            const { userId, phase, country, region } = job.data;
            const jobStartTime = Date.now();

            // Phased scheduled job (new architecture)
            if (phase && scheduledPhases.isValidPhase(phase)) {
                try {
                    return await runWithLockExtension(job, () => processScheduledPhase(job));
                } catch (phaseError) {
                    const duration = Date.now() - jobStartTime;
                    logger.error(`[Worker:${WORKER_NAME}] Scheduled phase ${phase} failed for user ${userId}, ${country}-${region}:`, phaseError);

                    await updateJobStatus(job.id, userId, 'failed', {
                        failedAt: new Date().toISOString(),
                        duration,
                        error: phaseError.message,
                        stack: phaseError.stack,
                        attemptNumber: job.attemptsMade + 1,
                        maxAttempts: job.opts.attempts,
                        metadata: { country, region, phase, parentJobId: job.data.parentJobId }
                    });

                    throw phaseError;
                }
            }

            // Legacy monolithic job (backward compatible)
            logger.info(`[Worker:${WORKER_NAME}] Starting legacy job ${job.id} for user ${userId}`);

            try {
                await updateJobStatus(job.id, userId, 'running', {
                    startedAt: new Date().toISOString(),
                    workerName: WORKER_NAME
                });

                await job.updateProgress(10);

                const result = await runWithLockExtension(job, async () => {
                    return await processUserData(userId);
                });

                await job.updateProgress(90);

                await updateJobStatus(job.id, userId, 'completed', {
                    completedAt: new Date().toISOString(),
                    duration: Date.now() - jobStartTime,
                    accountsProcessed: result.accountsProcessed,
                    accountsSucceeded: result.accountsSucceeded,
                    accountsFailed: result.accountsFailed,
                    errors: result.errors
                });

                await job.updateProgress(100);

                logger.info(`[Worker:${WORKER_NAME}] Job ${job.id} completed successfully for user ${userId}`, {
                    duration: Date.now() - jobStartTime,
                    accountsProcessed: result.accountsProcessed,
                    accountsSucceeded: result.accountsSucceeded
                });

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

                await updateJobStatus(job.id, userId, 'failed', {
                    failedAt: new Date().toISOString(),
                    duration,
                    error: error.message,
                    stack: error.stack,
                    attemptNumber: job.attemptsMade + 1,
                    maxAttempts: job.opts.attempts
                });

                throw error;
            }
        },
        {
            connection,
            prefix: 'bullmq',
            concurrency: WORKER_CONCURRENCY,
            lockDuration: LOCK_DURATION,
            // Reduced from 4 hours to 10 minutes: phased jobs are shorter and
            // stall detection needs to be fast enough to recover orphaned jobs
            stallInterval: 10 * 60 * 1000,
            maxStalledCount: 3,
            limiter: {
                max: 10,
                duration: 60000
            },
            removeOnComplete: {
                age: 2 * 3600,
                count: 100
            },
            removeOnFail: {
                age: 24 * 3600,
                count: 500
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


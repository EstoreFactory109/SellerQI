/**
 * integrationWorker.js
 * 
 * BullMQ Worker for First-Time User Integration with Chained Phases
 * 
 * This worker handles the 'user-integration' queue and processes jobs in phases:
 * 1. INIT - Validate user, generate tokens, fetch merchant listings
 * 2. BATCH_1_2 - First and second batch API calls
 * 3. BATCH_3_4 - Third and fourth batch API calls
 * 4. LISTING_ITEMS - Process individual listing items
 * 5. FINALIZE - Clear cache, send notifications, update history
 * 
 * Each phase is a separate job that chains to the next, preventing lock expiry
 * on long-running integrations.
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
const { 
    INTEGRATION_QUEUE_NAME, 
    getCurrentAccountStatus,
    addPhaseJob,
    getIntegrationQueue 
} = require('./integrationQueue.js');
const {
    PHASES,
    PHASE_ORDER,
    getNextPhase,
    isFirstPhase,
    isLastPhase,
    calculateOverallProgress,
    createNextPhaseJobData,
    generatePhaseJobId,
    parseParentJobId,
    getPhaseDescription,
    isValidPhase
} = require('./integrationPhases.js');
const JobStatus = require('../../models/system/JobStatusModel.js');
const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');
const { connectRedis } = require('../../config/redisConn.js');

// Worker configuration
const WORKER_CONCURRENCY = parseInt(process.env.INTEGRATION_WORKER_CONCURRENCY || '2', 10);
const WORKER_NAME = process.env.INTEGRATION_WORKER_NAME || `integration-worker-${process.pid}`;

// Lock configuration for long-running phases
// Lock duration: 2 hours - phases can run longer with periodic extension
const PHASE_LOCK_DURATION = 2 * 60 * 60 * 1000; // 2 hours
// Lock extension interval: extend every 15 minutes to prevent stalling
const LOCK_EXTENSION_INTERVAL = 15 * 60 * 1000; // 15 minutes
// Lock extension amount: extend by 1 hour each time
const LOCK_EXTENSION_AMOUNT = 60 * 60 * 1000; // 1 hour

// Initialize database and cache connections
let isInitialized = false;

async function initializeConnections() {
    if (isInitialized) {
        return;
    }

    try {
        await dbConnect();
        logger.info(`[IntegrationWorker:${WORKER_NAME}] Connected to MongoDB`);

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
 * Update the parent job status based on phase progress
 */
async function updateParentJobStatus(parentJobId, userId, phase, phaseStatus, metadata = {}) {
    try {
        const progress = calculateOverallProgress(phase, phaseStatus === 'completed' ? 100 : 50);
        
        await JobStatus.findOneAndUpdate(
            { jobId: parentJobId },
            {
                jobId: parentJobId,
                userId,
                status: phaseStatus === 'failed' ? 'failed' : (isLastPhase(phase) && phaseStatus === 'completed' ? 'completed' : 'running'),
                progress,
                currentPhase: phase,
                currentPhaseStatus: phaseStatus,
                ...metadata,
                updatedAt: new Date()
            },
            {
                upsert: true,
                new: true
            }
        );
    } catch (error) {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Failed to update parent job status:`, error);
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
                // Exponential backoff: 1s, 2s, 4s
                const delay = Math.pow(2, attempt - 1) * 1000;
                logger.warn(`[IntegrationWorker:${WORKER_NAME}] Lock extension attempt ${attempt}/${maxRetries} failed for job ${job.id}, retrying in ${delay}ms:`, error.message);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    logger.error(`[IntegrationWorker:${WORKER_NAME}] Lock extension failed after ${maxRetries} attempts for job ${job.id}:`, lastError?.message);
    return false;
}

/**
 * Run an async function with periodic lock extension to prevent job stalling.
 * This is critical for phases that can run for hours (e.g., product reviews, listing items).
 * 
 * @param {Object} job - BullMQ job object
 * @param {Function} asyncFn - Async function to execute
 * @returns {Promise} Result of the async function
 */
async function runWithLockExtension(job, asyncFn) {
    let extensionCount = 0;
    let failedExtensions = 0;
    let isRunning = true;

    const lockExtensionInterval = setInterval(async () => {
        if (!isRunning) return;
        
        const success = await extendLockWithRetry(job, LOCK_EXTENSION_AMOUNT);
        if (success) {
            extensionCount++;
            failedExtensions = 0; // Reset consecutive failures
            logger.info(`[IntegrationWorker:${WORKER_NAME}] Extended lock for job ${job.id} (extension #${extensionCount})`);
        } else {
            failedExtensions++;
            // Log warning if multiple consecutive failures (might indicate a bigger issue)
            if (failedExtensions >= 2) {
                logger.error(`[IntegrationWorker:${WORKER_NAME}] Multiple consecutive lock extension failures (${failedExtensions}) for job ${job.id} - job may be at risk of stalling`);
            }
        }
    }, LOCK_EXTENSION_INTERVAL);

    try {
        return await asyncFn();
    } finally {
        isRunning = false;
        clearInterval(lockExtensionInterval);
        if (extensionCount > 0 || failedExtensions > 0) {
            logger.info(`[IntegrationWorker:${WORKER_NAME}] Lock extension timer cleared for job ${job.id} - ${extensionCount} successful extensions, ${failedExtensions} final failures`);
        }
    }
}

/**
 * Execute a specific phase
 */
async function executePhase(phase, userId, region, country, phaseData) {
    logger.info(`[IntegrationWorker:${WORKER_NAME}] Executing phase ${phase} for user ${userId}`);

    switch (phase) {
        case PHASES.INIT:
            return await Integration.executeInitPhase(userId, region, country);
        
        case PHASES.BATCH_1_2:
            return await Integration.executeBatch1And2Phase(userId, region, country, phaseData);
        
        case PHASES.BATCH_3_4:
            return await Integration.executeBatch3And4Phase(userId, region, country, phaseData);
        
        case PHASES.LISTING_ITEMS:
            return await Integration.executeListingItemsPhase(userId, region, country, phaseData);
        
        case PHASES.FINALIZE:
            return await Integration.executeFinalizePhase(userId, region, country, phaseData);
        
        default:
            throw new Error(`Unknown phase: ${phase}`);
    }
}

/**
 * Process an integration job (supports both legacy and phased modes)
 * 
 * @param {Object} job - BullMQ job object
 * @returns {Object} Result object
 */
async function processIntegrationJob(job) {
    const { userId, country, region, phase, parentJobId, phaseData, triggeredAt } = job.data;
    const jobStartTime = Date.now();

    // Determine if this is a phased job or legacy job
    const currentPhase = phase || PHASES.INIT;
    const isLegacyJob = !phase;
    const effectiveParentJobId = parentJobId || job.id;

    logger.info(`[IntegrationWorker:${WORKER_NAME}] Starting job ${job.id}`, {
        userId,
        country,
        region,
        phase: currentPhase,
        isLegacyJob,
        parentJobId: effectiveParentJobId
    });

    // Get account status for metadata
    let accountStatus = { hasSpApiAccount: false, hasAdsAccount: false, tokenUpdatedAt: null };
    try {
        accountStatus = await getCurrentAccountStatus(userId, country, region);
    } catch (error) {
        logger.warn(`[IntegrationWorker:${WORKER_NAME}] Could not fetch account status:`, error.message);
    }

    try {
        // Update job status
        await updateJobStatus(job.id, userId, 'running', {
            startedAt: new Date().toISOString(),
            workerName: WORKER_NAME,
            metadata: {
                country,
                region,
                jobType: 'integration',
                phase: currentPhase,
                parentJobId: effectiveParentJobId,
                hasSpApiAccount: accountStatus.hasSpApiAccount,
                hasAdsAccount: accountStatus.hasAdsAccount
            }
        });

        // Update parent job status
        await updateParentJobStatus(effectiveParentJobId, userId, currentPhase, 'running', {
            workerName: WORKER_NAME,
            metadata: { country, region }
        });

        // Calculate and update progress
        const progress = calculateOverallProgress(currentPhase, 50);
        await job.updateProgress(progress);

        // Execute the phase with lock extension to prevent stalling on long-running phases
        const result = await runWithLockExtension(job, async () => {
            return await executePhase(currentPhase, userId, region, country, phaseData || {});
        });

        if (!result.success) {
            throw new Error(result.error || `Phase ${currentPhase} failed`);
        }

        const duration = Date.now() - jobStartTime;

        // Check if there's a next phase
        const nextPhase = getNextPhase(currentPhase);

        if (nextPhase) {
            // Enqueue the next phase
            logger.info(`[IntegrationWorker:${WORKER_NAME}] Enqueueing next phase: ${nextPhase}`);
            
            const nextJobData = createNextPhaseJobData(nextPhase, {
                userId,
                country,
                region,
                parentJobId: effectiveParentJobId,
                triggeredAt,
                phaseData: phaseData || {}
            }, result);

            await addPhaseJob(nextJobData);

            // Update current phase job as completed
            await updateJobStatus(job.id, userId, 'completed', {
                completedAt: new Date().toISOString(),
                duration,
                metadata: {
                    country,
                    region,
                    phase: currentPhase,
                    nextPhase,
                    parentJobId: effectiveParentJobId
                }
            });

            // Update parent job progress
            await updateParentJobStatus(effectiveParentJobId, userId, currentPhase, 'completed', {
                metadata: { country, region, nextPhase }
            });

            const finalProgress = calculateOverallProgress(currentPhase, 100);
            await job.updateProgress(finalProgress);

            logger.info(`[IntegrationWorker:${WORKER_NAME}] Phase ${currentPhase} completed, next: ${nextPhase}`, {
                userId,
                duration
            });

            return {
                success: true,
                phase: currentPhase,
                nextPhase,
                duration
            };

        } else {
            // This is the final phase - integration complete!
            await updateJobStatus(job.id, userId, 'completed', {
                completedAt: new Date().toISOString(),
                duration,
                metadata: {
                    country,
                    region,
                    phase: currentPhase,
                    parentJobId: effectiveParentJobId,
                    summary: result.summary
                }
            });

            await updateParentJobStatus(effectiveParentJobId, userId, currentPhase, 'completed', {
                completedAt: new Date().toISOString(),
                duration,
                metadata: {
                    country,
                    region,
                    summary: result.summary,
                    hasSpApiAccount: accountStatus.hasSpApiAccount,
                    hasAdsAccount: accountStatus.hasAdsAccount
                }
            });

            await job.updateProgress(100);

            logger.info(`[IntegrationWorker:${WORKER_NAME}] Integration completed for user ${userId}`, {
                duration,
                summary: result.summary
            });

            return {
                success: true,
                phase: currentPhase,
                completed: true,
                duration,
                summary: result.summary
            };
        }

    } catch (error) {
        const duration = Date.now() - jobStartTime;

        logger.error(`[IntegrationWorker:${WORKER_NAME}] Phase ${currentPhase} failed for user ${userId}:`, error);

        // Update phase job status
        await updateJobStatus(job.id, userId, 'failed', {
            failedAt: new Date().toISOString(),
            duration,
            error: error.message,
            stack: error.stack,
            attemptNumber: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts,
            metadata: {
                country,
                region,
                phase: currentPhase,
                parentJobId: effectiveParentJobId
            }
        });

        // Update parent job as failed
        await updateParentJobStatus(effectiveParentJobId, userId, currentPhase, 'failed', {
            failedAt: new Date().toISOString(),
            error: error.message,
            failedPhase: currentPhase,
            metadata: { country, region }
        });

        throw error;
    }
}

/**
 * Initialize connections and create worker
 */
async function startIntegrationWorker() {
    await initializeConnections();

    const worker = new Worker(
        INTEGRATION_QUEUE_NAME,
        async (job) => {
            return await processIntegrationJob(job);
        },
        {
            connection,
            prefix: 'bullmq',
            concurrency: WORKER_CONCURRENCY,
            // Shorter lock duration since phases are smaller
            lockDuration: PHASE_LOCK_DURATION,
            // Stall interval - check for stalls every 5 minutes
            stallInterval: 5 * 60 * 1000,
            maxStalledCount: 3,
            limiter: {
                max: 5,
                duration: 60000
            },
            removeOnComplete: {
                age: 4 * 3600,
                count: 200
            },
            removeOnFail: {
                age: 24 * 3600,
                count: 500
            }
        }
    );

    // Worker event listeners
    worker.on('active', (job) => {
        const phase = job.data.phase || PHASES.INIT;
        logger.info(`[IntegrationWorker:${WORKER_NAME}] Job ${job.id} is now ACTIVE`, {
            userId: job.data.userId,
            country: job.data.country,
            region: job.data.region,
            phase
        });
    });

    worker.on('completed', (job, result) => {
        logger.info(`[IntegrationWorker:${WORKER_NAME}] Job ${job.id} completed`, {
            userId: job.data.userId,
            phase: result?.phase,
            nextPhase: result?.nextPhase,
            completed: result?.completed,
            duration: result?.duration
        });
    });

    worker.on('failed', (job, err) => {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Job ${job?.id || 'unknown'} failed`, {
            userId: job?.data?.userId,
            phase: job?.data?.phase,
            error: err.message,
            attemptsMade: job?.attemptsMade
        });
    });

    worker.on('error', (err) => {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Worker error:`, {
            message: err?.message || 'Unknown error',
            stack: err?.stack || 'No stack trace'
        });
    });

    worker.on('stalled', (jobId) => {
        logger.warn(`[IntegrationWorker:${WORKER_NAME}] Job ${jobId} stalled`);
    });

    // Graceful shutdown with timeout
    // Give current job time to finish, but don't wait forever
    const SHUTDOWN_GRACE_MS = 5 * 60 * 1000; // 5 minutes
    let isShuttingDown = false;

    const gracefulShutdown = (signal) => {
        if (isShuttingDown) {
            logger.warn(`[IntegrationWorker:${WORKER_NAME}] Already shutting down, ignoring ${signal}`);
            return;
        }
        isShuttingDown = true;

        logger.info(`[IntegrationWorker:${WORKER_NAME}] Received ${signal}, closing worker gracefully (max ${SHUTDOWN_GRACE_MS / 60000} min)...`);

        let hasExited = false;
        const forceExit = () => {
            if (!hasExited) {
                hasExited = true;
                logger.warn(`[IntegrationWorker:${WORKER_NAME}] Shutdown timeout reached - forcing exit. Active job will be retried after lock expiry.`);
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
                    logger.info(`[IntegrationWorker:${WORKER_NAME}] Worker closed gracefully`);
                    process.exit(0);
                }
            })
            .catch((err) => {
                clearTimeout(shutdownTimeout);
                if (!hasExited) {
                    hasExited = true;
                    logger.error(`[IntegrationWorker:${WORKER_NAME}] Error during graceful shutdown:`, err.message);
                    process.exit(1);
                }
            });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    logger.info(`[IntegrationWorker:${WORKER_NAME}] Integration worker started with concurrency: ${WORKER_CONCURRENCY}`);
    logger.info(`[IntegrationWorker:${WORKER_NAME}] Phase lock duration: ${PHASE_LOCK_DURATION / 60000} minutes, lock extension every ${LOCK_EXTENSION_INTERVAL / 60000} minutes`);

    // Queue status monitoring
    let statusCheckCount = 0;
    setInterval(async () => {
        try {
            const queue = getIntegrationQueue();
            const waiting = await queue.getWaitingCount();
            const active = await queue.getActiveCount();
            const completed = await queue.getCompletedCount();
            const failed = await queue.getFailedCount();
            
            statusCheckCount++;
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
        module.exports = { worker };
    })
    .catch((error) => {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Failed to start worker:`, error);
        process.exit(1);
    });

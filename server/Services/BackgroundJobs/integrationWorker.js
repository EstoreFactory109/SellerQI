/**
 * integrationWorker.js
 *
 * BullMQ Worker for FIRST-TIME user integration jobs.
 *
 * - Queue: `user-integration` (separate from `user-data-processing`)
 * - Producer: routes/integration.routes.js → integrationQueue.addIntegrationJob / addPhaseJob
 * - Job types: `integration` (legacy single-job), `integration-phase` (phased pipeline)
 *
 * Architecture (phased pipeline):
 *   init → batch_1_2 → batch_3_4 → review_orders → listing_items → finalize
 *
 * Each phase enqueues the next as a new BullMQ job, releasing the worker
 * slot between phases so other accounts can be processed in parallel.
 *
 * Lock extension: phases can run 6h+ for very large catalogs. We extend the
 * BullMQ lock every 15 minutes to prevent stall detection from marking
 * actively-running jobs as failed.
 *
 * Run via PM2:
 *   pm2 start ecosystem.config.js --only integration-worker
 */

require('dotenv').config();

const { Worker } = require('bullmq');
const { getSharedConnection } = require('./sharedQueueConnection.js');
const integrationPhases = require('./integrationPhases.js');
const { addPhaseJob, INTEGRATION_QUEUE_NAME } = require('./integrationQueue.js');
const JobStatus = require('../../models/system/JobStatusModel.js');
const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');
const { connectRedis } = require('../../config/redisConn.js');
const { Integration } = require('../main/Integration.js');

const INTEGRATION_WORKER_CONCURRENCY = parseInt(process.env.INTEGRATION_WORKER_CONCURRENCY || '2', 10);
const WORKER_NAME = process.env.INTEGRATION_WORKER_NAME || `integration-worker-${process.pid}`;

// Lock configuration — phases for large catalogs can take hours.
const LOCK_DURATION = 2 * 60 * 60 * 1000;
const LOCK_EXTENSION_INTERVAL = 15 * 60 * 1000;
const LOCK_EXTENSION_AMOUNT = 60 * 60 * 1000;

let isInitialized = false;
async function initializeConnections() {
    if (isInitialized) return;
    await dbConnect();
    logger.info(`[IntegrationWorker:${WORKER_NAME}] Connected to MongoDB`);
    await connectRedis();
    logger.info(`[IntegrationWorker:${WORKER_NAME}] Connected to Redis (cache)`);
    isInitialized = true;
}

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
            { upsert: true, new: true }
        );
    } catch (error) {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] updateJobStatus failed for ${jobId}: ${error.message}`);
    }
}

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
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }
    logger.error(`[IntegrationWorker:${WORKER_NAME}] Lock extension failed after ${maxRetries} attempts for job ${job.id}: ${lastError?.message}`);
    return false;
}

async function runWithLockExtension(job, asyncFn) {
    let isRunning = true;
    const timer = setInterval(async () => {
        if (!isRunning) return;
        await extendLockWithRetry(job, LOCK_EXTENSION_AMOUNT);
    }, LOCK_EXTENSION_INTERVAL);

    try {
        return await asyncFn();
    } finally {
        isRunning = false;
        clearInterval(timer);
    }
}

/**
 * Run a single integration phase and enqueue the next on success.
 *
 * Phase failures (returned `{ success: false }` or thrown errors) are
 * recorded but the pipeline still advances to the next phase so a single
 * service failure doesn't permanently block the integration. The worker
 * job itself resolves successfully so BullMQ doesn't retry-loop.
 */
async function processIntegrationPhase(job) {
    const { userId, phase, country, region, parentJobId, phaseData } = job.data;
    const start = Date.now();
    const effectiveParentJobId = parentJobId || job.id;

    logger.info(`[IntegrationWorker:${WORKER_NAME}] Phase ${phase} starting`, { userId, country, region, parentJobId: effectiveParentJobId });

    await updateJobStatus(job.id, userId, 'running', {
        startedAt: new Date().toISOString(),
        workerName: WORKER_NAME,
        currentPhase: phase,
        metadata: { country, region, phase, parentJobId: effectiveParentJobId }
    });

    let outcome;
    try {
        let raw;
        switch (phase) {
            case integrationPhases.PHASES.INIT:
                raw = await Integration.executeInitPhase(userId, region, country);
                break;
            case integrationPhases.PHASES.BATCH_1_2:
                raw = await Integration.executeBatch1And2Phase(userId, region, country, phaseData || {});
                break;
            case integrationPhases.PHASES.BATCH_3_4:
                raw = await Integration.executeBatch3And4Phase(userId, region, country, phaseData || {});
                break;
            case integrationPhases.PHASES.REVIEW_ORDERS:
                raw = await Integration.executeReviewOrdersPhase(userId, region, country, phaseData || {});
                break;
            case integrationPhases.PHASES.LISTING_ITEMS:
                raw = await Integration.executeListingItemsPhase(userId, region, country, phaseData || {});
                break;
            case integrationPhases.PHASES.FINALIZE:
                raw = await Integration.executeFinalizePhase(userId, region, country, phaseData || {});
                break;
            default:
                throw new Error(`Unknown integration phase: ${phase}`);
        }
        outcome = (raw && typeof raw === 'object') ? raw : { success: false, error: `Phase ${phase} returned invalid result` };
    } catch (error) {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Phase ${phase} threw unexpectedly`, { userId, error: error?.message, stack: error?.stack });
        outcome = { success: false, error: error?.message || String(error), stack: error?.stack, threw: true };
    }

    const phaseSucceeded = outcome.success === true;
    const duration = Date.now() - start;
    const nextPhase = integrationPhases.getNextPhase(phase);

    if (nextPhase) {
        try {
            const nextJobData = integrationPhases.createNextPhaseJobData(
                nextPhase,
                job.data,
                phaseSucceeded ? outcome : {}
            );
            await addPhaseJob({
                ...nextJobData,
                parentJobId: effectiveParentJobId
            });
            logger.info(`[IntegrationWorker:${WORKER_NAME}] Phase ${phase} done (succeeded=${phaseSucceeded}); enqueued ${nextPhase}`, { userId, duration });
        } catch (enqueueError) {
            logger.error(`[IntegrationWorker:${WORKER_NAME}] Failed to enqueue next phase ${nextPhase}`, { userId, error: enqueueError?.message });
        }
    } else {
        logger.info(`[IntegrationWorker:${WORKER_NAME}] All phases complete for ${userId} (final succeeded=${phaseSucceeded})`, { duration });
    }

    try {
        await updateJobStatus(job.id, userId, phaseSucceeded ? 'completed' : 'failed', {
            [phaseSucceeded ? 'completedAt' : 'failedAt']: new Date().toISOString(),
            duration,
            error: phaseSucceeded ? undefined : (outcome.error || `Phase ${phase} failed`),
            stack: phaseSucceeded ? undefined : outcome.stack,
            attemptNumber: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts,
            metadata: { country, region, phase, nextPhase, parentJobId: effectiveParentJobId, phaseSucceeded }
        });
    } catch (statusError) {
        logger.warn(`[IntegrationWorker:${WORKER_NAME}] Could not update JobStatus row: ${statusError.message}`);
    }

    return {
        success: true,
        phase,
        phaseSucceeded,
        nextPhase,
        duration,
        completed: !nextPhase,
        error: phaseSucceeded ? undefined : outcome.error
    };
}

async function startWorker() {
    await initializeConnections();

    const worker = new Worker(
        INTEGRATION_QUEUE_NAME,
        async (job) => {
            const { phase, userId } = job.data || {};

            if (phase && integrationPhases.isValidPhase(phase)) {
                return runWithLockExtension(job, () => processIntegrationPhase(job));
            }

            // Legacy single-job path: triggered when frontend calls addIntegrationJob
            // without a phase. Bootstraps the phased pipeline by enqueueing INIT
            // and returning success — the bootstrap job's only responsibility is
            // to seed the pipeline; the actual work runs as a separate INIT job.
            logger.info(`[IntegrationWorker:${WORKER_NAME}] Legacy integration job ${job.id} → bootstrapping INIT phase`, { userId });
            const { country, region } = job.data || {};
            const parentJobId = job.id;
            try {
                const phaseInfo = await addPhaseJob({
                    userId,
                    country,
                    region,
                    phase: integrationPhases.PHASES.INIT,
                    parentJobId,
                    phaseData: {},
                    triggeredAt: new Date().toISOString()
                });
                // Parent bootstrap row stays in 'running' state to represent
                // the entire integration pipeline (which is now in-flight via the
                // phase jobs). `getAggregatedJobStatus(parentJobId)` returns this
                // row's status — phase rows (keyed by `${parentJobId}-${phase}`)
                // carry fine-grained progress. Marking 'completed' here would
                // prematurely signal the frontend that integration is done.
                await updateJobStatus(job.id, userId, 'running', {
                    startedAt: new Date().toISOString(),
                    workerName: WORKER_NAME,
                    currentPhase: integrationPhases.PHASES.INIT,
                    metadata: {
                        country,
                        region,
                        parentJobId,
                        bootstrapped: true,
                        firstPhaseJobId: phaseInfo?.jobId,
                        firstPhase: integrationPhases.PHASES.INIT
                    }
                });
                return { success: true, bootstrapped: true, nextPhase: integrationPhases.PHASES.INIT };
            } catch (error) {
                logger.error(`[IntegrationWorker:${WORKER_NAME}] Failed to bootstrap INIT for ${userId}: ${error.message}`);
                throw error;
            }
        },
        {
            connection: getSharedConnection(),
            prefix: 'bullmq',
            concurrency: INTEGRATION_WORKER_CONCURRENCY,
            lockDuration: LOCK_DURATION,
            stallInterval: 10 * 60 * 1000,
            maxStalledCount: 3,
            removeOnComplete: { age: 4 * 3600, count: 100 },
            removeOnFail: { age: 24 * 3600, count: 500 }
        }
    );

    worker.on('completed', (job, result) => {
        logger.info(`[IntegrationWorker:${WORKER_NAME}] Job ${job.id} completed`, {
            userId: job?.data?.userId,
            phase: job?.data?.phase,
            duration: result?.duration
        });
    });

    worker.on('failed', (job, err) => {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Job ${job?.id || 'unknown'} failed: ${err?.message}`, {
            userId: job?.data?.userId,
            phase: job?.data?.phase,
            attemptsMade: job?.attemptsMade,
            maxAttempts: job?.opts?.attempts
        });
    });

    worker.on('error', (err) => {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Worker error:`, err?.message || err);
    });

    worker.on('stalled', (jobId) => {
        logger.warn(`[IntegrationWorker:${WORKER_NAME}] Job ${jobId} stalled`);
    });

    const SHUTDOWN_GRACE_MS = parseInt(process.env.INTEGRATION_WORKER_SHUTDOWN_GRACE_MS || '120000', 10);
    let isShuttingDown = false;
    const gracefulShutdown = (signal) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        logger.info(`[IntegrationWorker:${WORKER_NAME}] ${signal} received, closing gracefully (${SHUTDOWN_GRACE_MS / 1000}s grace)`);
        const forceExit = setTimeout(() => {
            logger.warn(`[IntegrationWorker:${WORKER_NAME}] Force exit after grace timeout`);
            process.exit(1);
        }, SHUTDOWN_GRACE_MS);
        worker.close()
            .then(() => { clearTimeout(forceExit); process.exit(0); })
            .catch((err) => { clearTimeout(forceExit); logger.error(`[IntegrationWorker:${WORKER_NAME}] Close error: ${err.message}`); process.exit(1); });
    };
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    logger.info(`[IntegrationWorker:${WORKER_NAME}] Started with concurrency=${INTEGRATION_WORKER_CONCURRENCY}`);
    return worker;
}

startWorker()
    .then((worker) => {
        module.exports = { worker };
    })
    .catch((error) => {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Failed to start: ${error?.message || error}`);
        process.exit(1);
    });

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
const { runWithLockExtension: runWithLockExtensionShared } = require('./lockExtension.js');

const INTEGRATION_WORKER_CONCURRENCY = parseInt(process.env.INTEGRATION_WORKER_CONCURRENCY || '2', 10);
const WORKER_NAME = process.env.INTEGRATION_WORKER_NAME || `integration-worker-${process.pid}`;

// Lock configuration — phases for large catalogs can take hours.
//
// Deliberately kept in step with worker.js, which carries the full reasoning: a dead worker holds
// its concurrency slot until the lock lapses, and the old 2h initial lock / 60min extension meant
// roughly half the queue's apparent capacity could be phantom. Renewing every 2min and extending to
// 20min tolerates MORE consecutive missed renewals (9 vs 3) while reclaiming three times faster.
// Env-overridable, and sharing the same env vars as worker.js so the two cannot drift apart.
const LOCK_DURATION = Math.max(
    5 * 60 * 1000,
    parseInt(process.env.WORKER_LOCK_DURATION_MS || String(20 * 60 * 1000), 10) || 20 * 60 * 1000
);
const LOCK_EXTENSION_INTERVAL = Math.max(
    30 * 1000,
    parseInt(process.env.WORKER_LOCK_EXTENSION_INTERVAL_MS || String(2 * 60 * 1000), 10) || 2 * 60 * 1000
);
const LOCK_EXTENSION_AMOUNT = Math.max(
    5 * 60 * 1000,
    parseInt(process.env.WORKER_LOCK_EXTENSION_AMOUNT_MS || String(20 * 60 * 1000), 10) || 20 * 60 * 1000
);
// Hard ceiling on a single phase — the queue's only working timeout (see
// runWithLockExtension below, and the fuller note in worker.js). Defaults higher than
// the scheduled worker's because first-time onboarding genuinely fetches more: it walks
// a full 30-day window for a catalog of unknown size, where the daily pipeline is
// incremental.
const MAX_LOCK_EXTENSION_MS = Math.max(
    30 * 60 * 1000,
    parseInt(process.env.INTEGRATION_MAX_PHASE_MS || String(4 * 60 * 60 * 1000), 10) || 4 * 60 * 60 * 1000
);

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

/**
 * Lock keep-alive with a hard ceiling — shared with worker.js via ./lockExtension.js.
 * See that file for why the ceiling is the only real timeout these queues have
 * (job-level `timeout` has been a no-op since BullMQ v4) and the production hang that
 * motivated it. The ceiling here is higher than the scheduled worker's because
 * first-time onboarding walks a full 30-day window for a catalog of unknown size.
 */
function runWithLockExtension(job, asyncFn) {
    return runWithLockExtensionShared(job, asyncFn, {
        maxMs: MAX_LOCK_EXTENSION_MS,
        intervalMs: LOCK_EXTENSION_INTERVAL,
        amountMs: LOCK_EXTENSION_AMOUNT,
        label: `IntegrationWorker:${WORKER_NAME}`,
    });
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
        // The pipeline is finished — the per-phase row (updated below) is keyed by
        // this finalize job's id, but the parent/bootstrap row (keyed by
        // effectiveParentJobId) was deliberately pinned to 'running' to represent
        // the whole pipeline. It is the row `getAggregatedJobStatus(parentJobId)`
        // returns to the frontend, so it MUST be flipped to a terminal state here;
        // otherwise the account shows "in progress" forever even though every phase
        // (and the logging session) completed. Skip when there's no distinct parent
        // (effectiveParentJobId === job.id) since line ~182 already finalizes that row.
        if (effectiveParentJobId !== job.id) {
            try {
                await updateJobStatus(effectiveParentJobId, userId, phaseSucceeded ? 'completed' : 'failed', {
                    [phaseSucceeded ? 'completedAt' : 'failedAt']: new Date().toISOString(),
                    currentPhase: phase,
                    error: phaseSucceeded ? undefined : (outcome.error || `Phase ${phase} failed`),
                    metadata: { country, region, phase, parentJobId: effectiveParentJobId, pipelineFinalized: true, phaseSucceeded }
                });
            } catch (parentStatusError) {
                logger.warn(`[IntegrationWorker:${WORKER_NAME}] Could not finalize parent JobStatus row ${effectiveParentJobId}: ${parentStatusError.message}`);
            }
        }
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
            // `stallInterval` was a typo BullMQ never reads (it reads `stalledInterval`),
            // so the library default of 30s has always applied. Pins that actual value
            // under the correct name — no behaviour change, but now deliberate. This is
            // how fast a hung phase is reclaimed once the ceiling stops renewing its lock.
            stalledInterval: 30 * 1000,
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

    worker.on('failed', async (job, err) => {
        logger.error(`[IntegrationWorker:${WORKER_NAME}] Job ${job?.id || 'unknown'} failed: ${err?.message}`, {
            userId: job?.data?.userId,
            phase: job?.data?.phase,
            attemptsMade: job?.attemptsMade,
            maxAttempts: job?.opts?.attempts
        });

        // When a phase job permanently fails (exhausted retries or stalled past
        // maxStalledCount), the pipeline never reaches finalize — where the
        // logging session is normally closed — so the session would sit at
        // 'in_progress' forever and the frontend shows a perpetual spinner.
        // Close it here once we're out of attempts, mirroring the scheduled
        // worker (worker.js). sessionId is threaded through phaseData by INIT.
        try {
            const attemptsMade = job?.attemptsMade || 0;
            const maxAttempts = job?.opts?.attempts || 1;
            const sessionId = job?.data?.phaseData?.sessionId;
            const phase = job?.data?.phase;
            if (sessionId && attemptsMade >= maxAttempts) {
                const LoggingHelper = require('../../utils/LoggingHelper.js');
                await LoggingHelper.addLogToSession(sessionId, {
                    functionName: `phase:${phase || 'unknown'}`,
                    logType: 'error',
                    status: 'failed',
                    message: `Integration phase ${phase || 'unknown'} permanently failed/stalled: ${err?.message}`,
                    errorDetails: { errorMessage: err?.message, stackTrace: err?.stack || null, phase },
                    contextData: { userId: job?.data?.userId, phase, attemptsMade, maxAttempts },
                }).catch(() => {});
                await LoggingHelper.endSessionById(sessionId, 'failed');
                logger.warn(`[IntegrationWorker:${WORKER_NAME}] Closed stuck logging session ${sessionId} as failed (phase ${phase} exhausted ${attemptsMade}/${maxAttempts}).`);
            }
        } catch (sessErr) {
            logger.warn(`[IntegrationWorker:${WORKER_NAME}] Could not close session for failed job ${job?.id}: ${sessErr.message}`);
        }
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

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
const { runWithLockExtension: runWithLockExtensionShared, resolveCeiling } = require('./lockExtension.js');
const v8 = require('v8');
const fs = require('fs');
const path = require('path');

// Worker configuration
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '3', 10); // Process 3 jobs concurrently
// Debug: Log what WORKER_NAME will be set to
const envWorkerName = process.env.WORKER_NAME;
const pidBasedName = `worker-${process.pid}`;
const WORKER_NAME = envWorkerName || pidBasedName;

// ── Crash visibility ─────────────────────────────────────────────────────────
//
// WHY THIS EXISTS. This process had ONLY SIGTERM/SIGINT handlers, and even those were registered
// inside startWorker() — i.e. after the Mongo/Redis connect. Every other way a worker can die left
// the app log completely silent: a V8 heap OOM, an unhandled rejection, an uncaught throw and a
// kernel SIGKILL were all indistinguishable, because none of them wrote anything at all.
//
// That silence cost real diagnostic time. A `sched_calc_review` job died mid-phase leaving its
// JobStatus row pinned at 'running' with no terminal status and no heartbeat, and the only evidence
// available — RSS climbing with uptime — pointed at a memory leak which turned out not to be the
// cause of the symptom under investigation. Absence of evidence read as evidence.
//
// WHY logger IS NOT ENOUGH HERE, and why the first version of this was useless.
//
// The handlers below shipped, and then this process exited with code 1 roughly 340 times across
// six instances in 46 hours WITHOUT RECORDING A SINGLE REASON. Both places a reason could land are
// incapable of holding it:
//
//   1. `logger.error` writes via console.error -> process.stderr, which under PM2
//      `exec_mode: 'cluster'` is an IPC pipe. Node documents pipe writes as synchronous on Linux
//      (asynchronous on macOS), so this is a real hazard for a dev box and a *possible* one in
//      production rather than a proven loss — measured, not assumed. The short pre-exit delay
//      below costs nothing and removes the doubt.
//   2. Logger's file mirror (server/logs.txt) defaults to OFF when NODE_ENV=production, which the
//      ecosystem file sets. That file's last entry is two months old.
//
// So: write the reason SYNCHRONOUSLY with appendFileSync — which survives process.exit — before
// touching the logger, and only then exit, after a short delay so the pipe can drain too.
const FATAL_LOG_PATH = path.join(__dirname, '..', '..', '..', 'logs', 'worker-fatal.log');
const FATAL_EXIT_DELAY_MS = Math.max(0, parseInt(process.env.WORKER_FATAL_EXIT_DELAY_MS || '250', 10) || 250);

// Set by recordFatal so the exit hook below can tell "we know why" from "it just vanished".
let fatalReasonRecorded = false;

/** Record a fatal reason somewhere it cannot be lost. Must never throw — it runs on the way out. */
function recordFatal(kind, detail) {
    fatalReasonRecorded = true;
    const text = detail && detail.stack ? detail.stack : String(detail);
    const line = `[${new Date().toISOString()}] [${WORKER_NAME}] ${kind}: ${text}\n`;
    try {
        fs.mkdirSync(path.dirname(FATAL_LOG_PATH), { recursive: true });
        fs.appendFileSync(FATAL_LOG_PATH, line);
    } catch (_) { /* a failure here must not mask the original fault */ }
    try { logger.error(`[Worker:${WORKER_NAME}] ${kind}`, detail); } catch (_) {}
}

/**
 * Exit, but give the async stderr pipe a chance to drain first.
 *
 * The timer is deliberately NOT unref'd: holding the loop open for a moment is the entire point.
 * `process.exitCode` is set as well, so the right code is still used if the process happens to end
 * on its own before the timer fires.
 */
function exitAfterFlush(code) {
    process.exitCode = code;
    setTimeout(() => process.exit(code), FATAL_EXIT_DELAY_MS);
}

// THE BACKSTOP, and the one that finally answers "why did it exit?".
//
// `exit` fires for EVERY termination that runs JS at all — an explicit process.exit anywhere in the
// dependency tree, a natural exit because the event loop drained, a rethrow, a signal handled
// elsewhere. Only SIGKILL and a hard abort skip it. So if the fleet keeps churning and this hook
// records nothing, the process is being killed outright and the search moves outside Node entirely.
// Either answer is progress; previously both looked identical.
//
// Only synchronous work is allowed here, which is exactly why recordFatal uses appendFileSync.
process.on('exit', (code) => {
    if (code === 0 && !fatalReasonRecorded) return;   // ordinary clean stop, nothing to explain
    if (fatalReasonRecorded) return;                  // already written by a more specific handler
    recordFatal('UNEXPLAINED exit', `code=${code}, uptime=${(process.uptime() / 60).toFixed(1)}min, rssMB=${Math.round(process.memoryUsage().rss / 1048576)}`);
});

// Registered at MODULE TOP LEVEL on purpose, so a failure during startup is covered too.
process.on('uncaughtException', (err) => {
    recordFatal('FATAL uncaughtException', err);
    // Non-zero so PM2 treats this as a crash and restarts, rather than as a clean stop.
    exitAfterFlush(1);
});

process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(`Non-Error rejection: ${String(reason)}`);
    recordFatal('FATAL unhandledRejection', err);
    exitAfterFlush(1);
});


/**
 * Periodic heap/RSS sample.
 *
 * Nothing in this repo read `v8` before, so "is RSS growth actually HEAP growth?" was unanswerable —
 * and that is the question separating a real leak from native retention or fragmentation. PM2's
 * `mem` column is RSS, while the OOM ceiling (--max-old-space-size) applies to the heap, so reading
 * one without the other is how a wrong conclusion gets reached confidently.
 *
 * `external`/`arrayBuffers` are included deliberately: native allocations (e.g. zlib contexts) show
 * up there and in RSS but NOT in used_heap_size, which is exactly the divergence to watch for.
 *
 * `.unref()` so this timer can never hold the process open during shutdown.
 */
const HEAP_LOG_INTERVAL_MS = Math.max(
    60 * 1000,
    parseInt(process.env.WORKER_HEAP_LOG_INTERVAL_MS || String(5 * 60 * 1000), 10) || 5 * 60 * 1000
);
const heapLogTimer = setInterval(() => {
    try {
        const h = v8.getHeapStatistics();
        const m = process.memoryUsage();
        const mb = (n) => Math.round((n || 0) / 1048576);
        logger.info(
            `[Worker:${WORKER_NAME}] heap usedMB=${mb(h.used_heap_size)} totalMB=${mb(h.total_heap_size)} ` +
            `limitMB=${mb(h.heap_size_limit)} rssMB=${mb(m.rss)} externalMB=${mb(m.external)} ` +
            `arrayBuffersMB=${mb(m.arrayBuffers)} uptimeH=${(process.uptime() / 3600).toFixed(1)}`
        );
    } catch (err) {
        logger.warn(`[Worker:${WORKER_NAME}] heap sample failed: ${err.message}`);
    }
}, HEAP_LOG_INTERVAL_MS);
heapLogTimer.unref();

// Lock configuration for long-running jobs (prevents stalling)
// These settings match integrationWorker.js for consistency — keep the two in step.
//
// WHY THESE NUMBERS CHANGED. When a worker process dies, its jobs stay `active` and keep holding
// their concurrency slot until the Redis lock lapses. Measured in production: 36 jobs reported
// active against 18 real slots — roughly HALF the queue's apparent capacity was phantom, held by
// workers that no longer existed.
//
// The old values made that window enormous. The lock only shrinks to LOCK_EXTENSION_AMOUNT after
// the FIRST renewal, so a worker dying inside its first 15 minutes left the job pinned for the full
// 2h LOCK_DURATION. That initial-lock hole is precisely why all three constants move together:
// reducing the extension alone would not have closed it.
//
// COUNTER-INTUITIVELY THIS IS SAFER THAN BEFORE, not riskier. The hazard is a lock lapsing while a
// job is genuinely running, because BullMQ then RE-RUNS it — and sched_calc_review sends review
// requests, so a spurious re-run risks duplicate requests to real sellers. What guards against that
// is how many consecutive renewals may fail, not the absolute numbers:
//
//   before: renew every 15min, extend to 60min -> tolerates 3 missed renewals, reclaim <=60min (2h if early)
//   after:  renew every  2min, extend to 20min -> tolerates 9 missed renewals, reclaim <=20min
//
// Fault tolerance triples while reclaim latency drops threefold. Cost is trivial: ~9 extendLock
// calls/min across 18 concurrent jobs, plus the JobStatus heartbeat that piggybacks the same timer.
//
// Env-overridable so the old timing can be restored without a deploy. INVARIANT to preserve:
// LOCK_EXTENSION_INTERVAL must stay well below BOTH LOCK_DURATION and LOCK_EXTENSION_AMOUNT.
const LOCK_DURATION = Math.max(
    5 * 60 * 1000,
    parseInt(process.env.WORKER_LOCK_DURATION_MS || String(20 * 60 * 1000), 10) || 20 * 60 * 1000
); // initial lock granted when a job is picked up
const LOCK_EXTENSION_INTERVAL = Math.max(
    30 * 1000,
    parseInt(process.env.WORKER_LOCK_EXTENSION_INTERVAL_MS || String(2 * 60 * 1000), 10) || 2 * 60 * 1000
); // how often the keep-alive fires
const LOCK_EXTENSION_AMOUNT = Math.max(
    5 * 60 * 1000,
    parseInt(process.env.WORKER_LOCK_EXTENSION_AMOUNT_MS || String(20 * 60 * 1000), 10) || 20 * 60 * 1000
); // how far out each renewal pushes the lock
// Hard ceiling on how long ONE job may hold its slot. See lockExtension.js for the full
// reasoning — in short, this is the only working timeout in the queue, because a job-level
// `timeout` option has been a no-op since BullMQ v4 dropped it.
//
// THESE NUMBERS ARE MEASURED, NOT GUESSED. Over 1,384 completed scheduled phases in
// production, duration by phase (minutes):
//
//     phase          p50     p95     max        >3h ceiling would reclaim
//     ads            6.4    40.1    55.1                    0
//     batch_1_2      1.6     2.3   107.2                    0
//     batch_4        8.2    35.1    69.6                    0
//     batch_3        0.8    24.4    34.6                    0
//     finance        1.0    11.4    41.5                    0
//     init/finalize  0.5     1.5    41.4                    0
//     calc_review    1.3   141.1  1426.8 (23.8h!)           4   <-- the exception
//
// So 3h is comfortably above every phase EXCEPT calc_review, where legitimate runs reach
// nearly a full day and a 3h ceiling would have wrongly reclaimed 4 real runs. That is not
// a harmless false positive: calc_review does review ingestion/sending, so re-running a
// live one risks duplicate review requests to real customers. It therefore gets its own,
// much higher ceiling — 26h clears the observed 23.8h max with margin and still bounds it,
// where the old code bounded nothing at all.
//
// (A phase that can legitimately run 24h is itself worth fixing — it should release the
// worker and poll via the `reschedule` path rather than hold a slot for a day. Out of
// scope here; this change only stops a hang lasting FOREVER.)
const MAX_LOCK_EXTENSION_MS = Math.max(
    30 * 60 * 1000,
    parseInt(process.env.WORKER_MAX_PHASE_MS || String(3 * 60 * 60 * 1000), 10) || 3 * 60 * 60 * 1000
);
// For phases measured to run legitimately for many hours, and for the legacy phaseless
// whole-account job whose runtime is unbounded by design.
const MAX_LOCK_EXTENSION_LONG_MS = Math.max(
    MAX_LOCK_EXTENSION_MS,
    parseInt(process.env.WORKER_MAX_LONG_PHASE_MS || String(26 * 60 * 60 * 1000), 10) || 26 * 60 * 60 * 1000
);
const LONG_PHASES = new Set([scheduledPhases.PHASES.CALC_REVIEW]);

/** Ceiling for this job. Resolution logic lives in lockExtension.js so it can be tested. */
function ceilingForJob(job) {
    return resolveCeiling(job?.data?.phase, {
        defaultMs: MAX_LOCK_EXTENSION_MS,
        longMs: MAX_LOCK_EXTENSION_LONG_MS,
        longPhases: LONG_PHASES,
    });
}

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
 * Lock keep-alive for long-running phases, with a hard ceiling.
 *
 * Both implementations live in ./lockExtension.js — worker.js and integrationWorker.js
 * used to carry separate copies, which is how the missing ceiling had to be found and
 * fixed twice. See that file for why the ceiling is the only real timeout these queues
 * have (job-level `timeout` has been a no-op since BullMQ v4) and the 7.8h hang it exists
 * to end.
 */
function runWithLockExtension(job, asyncFn) {
    return runWithLockExtensionShared(job, asyncFn, {
        maxMs: ceilingForJob(job),
        intervalMs: LOCK_EXTENSION_INTERVAL,
        amountMs: LOCK_EXTENSION_AMOUNT,
        label: `Worker:${WORKER_NAME}`,
        verbose: true,
        // Keep this job's JobStatus row warm while it runs, so "has this account gone quiet?"
        // is answerable. Status stays 'running' — this only moves updatedAt/lastHeartbeatAt.
        // See lockExtension.js for who reads it and why the absence of this was a real freeze.
        onHeartbeat: (runningJob, elapsedMs) => updateJobStatus(
            runningJob.id,
            runningJob.data?.userId,
            'running',
            { lastHeartbeatAt: new Date(), elapsedMs }
        ),
    });
}

/**
 * Process a phased scheduled job (new architecture).
 * Executes one phase, then enqueues the next phase as a separate BullMQ job.
 *
 * Pipeline resilience: a phase failure (thrown or returned { success: false }) is
 * logged and recorded on the phase's JobStatus row, but the pipeline still enqueues
 * the next phase. The worker job itself always resolves successfully so BullMQ does
 * not retry a failing phase and block downstream phases from running.
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

    let phaseOutcome;
    try {
        let raw;
        switch (phase) {
            case scheduledPhases.PHASES.INIT:
                raw = await ScheduledIntegration.executeScheduledInitPhase(userId, region, country);
                break;
            case scheduledPhases.PHASES.BATCH_1_2:
                raw = await ScheduledIntegration.executeScheduledBatch1And2Phase(userId, region, country, phaseData || {});
                break;
            case scheduledPhases.PHASES.ADS:
                raw = await ScheduledIntegration.executeScheduledAdsPhase(userId, region, country, phaseData || {});
                break;
            // V2 split phases: BATCH_3 → FINANCE → BATCH_4
            case scheduledPhases.PHASES.BATCH_3:
                raw = await ScheduledIntegration.executeScheduledBatch3Phase(userId, region, country, phaseData || {});
                break;
            case scheduledPhases.PHASES.FINANCE:
                raw = await ScheduledIntegration.executeScheduledFinancePhase(userId, region, country, phaseData || {});
                break;
            case scheduledPhases.PHASES.BATCH_4:
                raw = await ScheduledIntegration.executeScheduledBatch4Phase(userId, region, country, phaseData || {});
                break;
            // LEGACY: drain in-flight `sched_batch_3_4` jobs from pre-split deploys.
            // Routes to combined runner and chains to `sched_calc_review` via LEGACY_NEXT_PHASE.
            case scheduledPhases.PHASES.BATCH_3_4_LEGACY:
                raw = await ScheduledIntegration.executeScheduledBatch3And4Phase(userId, region, country, phaseData || {});
                break;
            // One-shot ads catch-up enqueued by freshnessSweeper for missing past
            // PPC days. NOT part of PHASE_ORDER, so the worker will NOT chain to
            // another phase after this completes (getNextPhase returns null).
            case scheduledPhases.PHASES.ADS_CATCHUP:
                raw = await ScheduledIntegration.executeAdsCatchupPhase(userId, region, country, phaseData || {});
                break;
            // One-shot finance catch-up enqueued by the reconciliation sweeper for
            // missing/provisional/zero finance days. NOT in PHASE_ORDER, so the
            // worker does not chain to another phase after this completes.
            case scheduledPhases.PHASES.FINANCE_CATCHUP:
                raw = await ScheduledIntegration.executeFinanceCatchupPhase(userId, region, country, phaseData || {});
                break;
            case scheduledPhases.PHASES.CALC_REVIEW:
                raw = await ScheduledIntegration.executeScheduledCalcReviewPhase(userId, region, country, phaseData || {});
                break;
            case scheduledPhases.PHASES.FINALIZE:
                raw = await ScheduledIntegration.executeScheduledFinalizePhase(userId, region, country, phaseData || {});
                break;
            default:
                throw new Error(`Unknown scheduled phase: ${phase}`);
        }
        phaseOutcome = (raw && typeof raw === 'object')
            ? raw
            : { success: false, error: `Phase ${phase} returned an invalid result` };
    } catch (error) {
        logger.error(`[Worker:${WORKER_NAME}] Scheduled phase ${phase} threw unexpectedly for user ${userId}:`, error);
        phaseOutcome = {
            success: false,
            error: error?.message || String(error),
            stack: error?.stack,
            threw: true
        };
    }

    const phaseSucceeded = phaseOutcome.success === true;
    const duration = Date.now() - jobStartTime;
    const nextPhase = scheduledPhases.getNextPhase(phase);

    if (!phaseSucceeded) {
        logger.error(
            `[Worker:${WORKER_NAME}] Scheduled phase ${phase} did not succeed for user ${userId} — pipeline will continue`,
            {
                userId,
                phase,
                nextPhase,
                error: phaseOutcome.error,
                statusCode: phaseOutcome.statusCode,
                threw: !!phaseOutcome.threw
            }
        );
        // Surface the failure on the frontend "user logging page" by recording it
        // to the user's logging session (opened in sched_init, read by the
        // /logging/session API). Without this, mid-pipeline phase failures never
        // appear in the UI — the session just sits at in_progress with no error.
        const failSessionId = phaseData?.sessionId;
        if (failSessionId) {
            try {
                const LoggingHelper = require('../../utils/LoggingHelper.js');
                await LoggingHelper.addLogToSession(failSessionId, {
                    functionName: `phase:${phase}`,
                    logType: 'error',
                    status: 'failed',
                    message: phaseOutcome.error || `Phase ${phase} failed`,
                    errorDetails: { errorMessage: phaseOutcome.error || null, stackTrace: phaseOutcome.stack || null, phase },
                    contextData: { userId, country, region, phase, nextPhase },
                });
            } catch (logErr) {
                logger.warn(`[Worker:${WORKER_NAME}] Could not record phase failure to session ${failSessionId}: ${logErr.message}`);
            }
        }
    }

    // P8: non-blocking poll (BidBison-style). A phase may report that it is not done
    // yet and should be re-run after a delay instead of advancing — e.g. the ADS phase
    // that submitted Amazon reports and is waiting for them to finish generating. We
    // re-enqueue the SAME phase with a delay + a distinct (poll-suffixed) jobId,
    // carrying phaseData forward, and RETURN — releasing this worker slot instead of
    // sleeping in-process. The phase advances to nextPhase only once it stops asking
    // to be rescheduled (all reports terminal).
    if (phaseSucceeded && phaseOutcome.reschedule && phaseOutcome.reschedule.delayMs > 0) {
        const pollAttempt = phaseOutcome.reschedule.pollAttempt || 1;
        try {
            const selfJobData = scheduledPhases.createNextPhaseJobData(phase, job.data, phaseOutcome);
            const selfJobId = `${scheduledPhases.generatePhaseJobId(effectiveParentJobId, phase)}-poll${pollAttempt}`;
            const queue = getQueue();
            await queue.add('process-user-data', selfJobData, {
                jobId: selfJobId,
                delay: phaseOutcome.reschedule.delayMs,
                attempts: 3,
                backoff: { type: 'exponential', delay: 60000 }
                // `timeout` intentionally absent — a no-op since BullMQ v4; see queue.js.
            });
            logger.info(
                `[Worker:${WORKER_NAME}] Scheduled phase ${phase} not done — rescheduled poll ${pollAttempt} in ${phaseOutcome.reschedule.delayMs}ms`,
                { userId, selfJobId, duration }
            );
        } catch (enqueueError) {
            logger.error(
                `[Worker:${WORKER_NAME}] Failed to reschedule phase ${phase} for user ${userId}:`,
                enqueueError
            );
            // Non-fatal: the reconciliation sweep re-checks stuck SUBMITTED reports.
        }
        try {
            await updateJobStatus(job.id, userId, 'completed', {
                completedAt: new Date().toISOString(),
                duration,
                attemptNumber: job.attemptsMade + 1,
                maxAttempts: job.opts.attempts,
                metadata: { country, region, phase, rescheduled: true, pollAttempt, parentJobId: effectiveParentJobId }
            });
        } catch (statusError) {
            logger.warn(`[Worker:${WORKER_NAME}] Could not update job status for rescheduled phase ${phase}: ${statusError.message}`);
        }
        return { success: true, phase, rescheduled: true, pollAttempt };
    }

    if (nextPhase) {
        try {
            // Always pass the phase outcome (even on failure) so the next phase
            // and the FinalizePhase can read accumulated apiResults — including
            // failure records. The previous behaviour dropped the failing
            // phase's results, hiding partial outages from finalize.
            const nextJobData = scheduledPhases.createNextPhaseJobData(
                nextPhase,
                job.data,
                phaseOutcome
            );
            const nextJobId = scheduledPhases.generatePhaseJobId(effectiveParentJobId, nextPhase);

            const queue = getQueue();
            await queue.add('process-user-data', nextJobData, {
                jobId: nextJobId,
                attempts: 3,
                backoff: { type: 'exponential', delay: 60000 }
                // `timeout` intentionally absent — a no-op since BullMQ v4; see queue.js.
            });

            logger.info(
                `[Worker:${WORKER_NAME}] Scheduled phase ${phase} ${phaseSucceeded ? 'completed' : 'FAILED — continuing'}, enqueued next: ${nextPhase}`,
                { userId, duration, nextJobId }
            );
        } catch (enqueueError) {
            logger.error(
                `[Worker:${WORKER_NAME}] Failed to enqueue next scheduled phase ${nextPhase} for user ${userId}:`,
                enqueueError
            );
            // Don't rethrow — record enqueue failure on the phase JobStatus row below and keep the worker job successful.
        }
    } else {
        logger.info(
            `[Worker:${WORKER_NAME}] All scheduled phases done for user ${userId}, ${country}-${region} (final phase success=${phaseSucceeded})`,
            { duration }
        );
    }

    try {
        await updateJobStatus(job.id, userId, phaseSucceeded ? 'completed' : 'failed', {
            [phaseSucceeded ? 'completedAt' : 'failedAt']: new Date().toISOString(),
            duration,
            error: phaseSucceeded ? undefined : (phaseOutcome.error || `Phase ${phase} failed`),
            stack: phaseSucceeded ? undefined : phaseOutcome.stack,
            attemptNumber: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts,
            metadata: {
                country,
                region,
                phase,
                nextPhase,
                parentJobId: effectiveParentJobId,
                phaseSucceeded
            }
        });
    } catch (statusError) {
        logger.warn(`[Worker:${WORKER_NAME}] Could not update scheduled phase JobStatus row: ${statusError.message}`);
    }

    return {
        success: true, // worker-level success — pipeline advanced
        phase,
        phaseSucceeded,
        nextPhase,
        duration,
        completed: !nextPhase,
        error: phaseSucceeded ? undefined : phaseOutcome.error
    };
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
            // How often BullMQ scans for jobs whose lock has lapsed. Since the
            // lock-extension ceiling (MAX_LOCK_EXTENSION_MS) is now the queue's only
            // real timeout, this is what decides how quickly a hung phase is actually
            // reclaimed after we stop renewing it — keep it tight.
            //
            // The key was previously spelled `stallInterval`, which BullMQ does not
            // recognise (it reads `stalledInterval`), so the "reduced to 10 minutes"
            // intent never took effect and the library default of 30s applied. 30s is
            // the better value here anyway, so this pins the behaviour that was
            // actually running rather than changing it — but now deliberately, and
            // under the name the library reads.
            stalledInterval: 30 * 1000,
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

    worker.on('failed', async (job, err) => {
        logger.error(`[Worker:${WORKER_NAME}] Job ${job?.id || 'unknown'} failed`, {
            userId: job?.data?.userId,
            error: err.message,
            attemptsMade: job?.attemptsMade,
            maxAttempts: job?.opts?.attempts
        });
        // When BullMQ permanently fails a scheduled-phase job (exhausted retries
        // or stalled past maxStalledCount — e.g. a phase that hung for hours),
        // the pipeline never reaches sched_finalize, so the user's logging
        // session would sit at "in_progress" forever on the frontend. Close it
        // as failed (with the error) once we're out of attempts, so the UI shows
        // a real terminal state instead of a perpetual spinner.
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
                    message: `Phase ${phase || 'unknown'} permanently failed/stalled: ${err.message}`,
                    errorDetails: { errorMessage: err.message, stackTrace: err.stack || null, phase },
                    contextData: { userId: job?.data?.userId, phase, attemptsMade, maxAttempts },
                }).catch(() => {});
                await LoggingHelper.endSessionById(sessionId, 'failed');
                logger.warn(`[Worker:${WORKER_NAME}] Closed stuck logging session ${sessionId} as failed (phase ${phase} exhausted ${attemptsMade}/${maxAttempts}).`);
            }
        } catch (sessErr) {
            logger.warn(`[Worker:${WORKER_NAME}] Could not close session for failed job ${job?.id}: ${sessErr.message}`);
        }
    });

    worker.on('error', (err) => {
        logger.error(`[Worker:${WORKER_NAME}] Worker error:`, err);
    });

    worker.on('stalled', (jobId) => {
        logger.warn(`[Worker:${WORKER_NAME}] Job ${jobId} stalled`);
    });

    // Graceful shutdown with timeout
    // Keep this shorter to avoid PM2 kill-retry loops during restarts.
    // Override via WORKER_SHUTDOWN_GRACE_MS when longer drain is required.
    const SHUTDOWN_GRACE_MS = parseInt(process.env.WORKER_SHUTDOWN_GRACE_MS || '120000', 10); // 2 minutes
    let isShuttingDown = false;

    const gracefulShutdown = (signal) => {
        if (isShuttingDown) {
            logger.warn(`[Worker:${WORKER_NAME}] Already shutting down, ignoring ${signal}`);
            return;
        }
        isShuttingDown = true;

        // Recorded synchronously as well as logged: this is the line that tells a deliberate
        // restart apart from a crash, and stdout is the one place it cannot survive an exit.
        recordFatal(`SIGNAL ${signal} received`, 'graceful shutdown requested');
        logger.info(`[Worker:${WORKER_NAME}] Received ${signal}, closing worker gracefully (max ${SHUTDOWN_GRACE_MS / 60000} min)...`);

        let hasExited = false;
        const forceExit = () => {
            if (!hasExited) {
                hasExited = true;
                recordFatal('FATAL shutdown timeout', 'forcing exit; active job will be retried after lock expiry');
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
                    recordFatal('FATAL graceful-shutdown error', err);
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
        recordFatal('FATAL startup failure', error);
        exitAfterFlush(1);
    });


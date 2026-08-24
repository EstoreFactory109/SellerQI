/**
 * producer.js
 * 
 * Queue Producer - Enqueues user IDs for processing
 * 
 * This module handles adding jobs to the queue. It should ONLY enqueue jobs,
 * never process them. Processing is done by workers.
 * 
 * Usage:
 * - Cron jobs call enqueueUser() to add users to the queue
 * - Manual triggers can also use enqueueUser()
 * - Supports bulk enqueuing for migration scenarios
 */

const { getQueue } = require('./queue.js');
const logger = require('../../utils/Logger.js');
const scheduledPhasesModule = require('./scheduledPhases.js');
const { PHASES } = scheduledPhasesModule;

const MAX_SCHEDULED_JOB_AGE = 8 * 60 * 60 * 1000; // 8 hours - safety net for orphaned phase jobs

// How long a phase job may go without a liveness heartbeat before this producer is willing to
// remove it even though it is still older than MAX_SCHEDULED_JOB_AGE.
//
// WHY THIS EXISTS. The flat 8h age check above removes any job in waiting/active/delayed that
// is older than 8h — including one that is actively running. That directly contradicts
// worker.js, which grants `sched_calc_review` a 26h lock-extension ceiling because production
// data shows it legitimately reaching 23.8h. Both statements shipped in the same commit. On the
// largest accounts the 8h side won: a healthy calc_review was deleted mid-flight, the chain
// restarted from sched_init, and the account could never reach finalize. Its dashboard sat
// frozen for five days.
//
// Age alone cannot tell "running for 9h" from "died 9h ago", which is why the old code had to
// guess. runWithLockExtension now writes a heartbeat to JobStatus every 15 minutes, so the two
// are distinguishable and this no longer has to be a guess. A generous multiple of that
// interval, so a couple of missed beats (Mongo blip, event-loop stall) never costs a live job.
const HEARTBEAT_STALE_MS = Math.max(
    15 * 60 * 1000,
    parseInt(process.env.SCHEDULED_JOB_HEARTBEAT_STALE_MS || String(60 * 60 * 1000), 10) || 60 * 60 * 1000
);

/**
 * Is this job still demonstrably alive?
 *
 * Fails SAFE (returns false = "cannot vouch for it") on any error or missing row, so a
 * heartbeat problem degrades to exactly the previous age-only behaviour rather than pinning a
 * dead job in place forever — the failure mode this whole area exists to prevent.
 *
 * @returns {Promise<boolean>} true only when a recent heartbeat proves the job is running
 */
async function hasRecentHeartbeat(jobId) {
    try {
        const JobStatus = require('../../models/system/JobStatusModel.js');
        const row = await JobStatus.findOne({ jobId }).select('status updatedAt').lean();
        if (!row || row.status !== 'running' || !row.updatedAt) return false;
        return (Date.now() - new Date(row.updatedAt).getTime()) < HEARTBEAT_STALE_MS;
    } catch (err) {
        logger.warn(`[Producer] Could not read heartbeat for ${jobId}: ${err.message}`);
        return false;
    }
}

/** Escape a value before embedding it in a RegExp. */
function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Is ANY phase of this account's pipeline still demonstrably running?
 *
 * WHY THIS EXISTS — the bug it fixes is worth stating exactly, because the symptom looked like
 * something else entirely for a long time.
 *
 * `getAllPhaseJobIds` returns only `${parentJobId}-${phase}`. But the async ads/finance phases do
 * NOT hold a worker slot while Amazon generates reports: they re-enqueue THEMSELVES as a delayed
 * job under `${parentJobId}-${phase}-poll${n}` (worker.js), and that suffix is not in the list. So
 * the loop below would look up `…-sched_ads`, find the ORIGINAL job already `completed`, remove it,
 * conclude nothing was running, and enqueue a whole new run on top of a live one.
 *
 * The first run's DataFetchTracking doc is then never closed (only sched_finalize closes it), and
 * ~9h later sweepStalledPipelines marks it `stalled-pipeline-autorecovered`. Measured over 14 days:
 * 100 of 334 runs on the 10 async-engine accounts stalled (29.9%), against 0 of 2,056 runs on the
 * other 42 accounts. Median 86 minutes from a stalled run to the next one starting — accounts are
 * scheduled roughly hourly and async runs take longer than that, so the overlap was systematic.
 *
 * A prefix match sidesteps the whole problem: it covers every phase id AND every `-pollN` id without
 * having to enumerate them, so a future self-rescheduling phase is covered for free.
 *
 * This is deliberately the SAME query freshnessSweeper.sweepStalledPipelines already uses for its
 * own liveness guard — whose comment notes this very blind spot in the producer. Keep the two
 * thresholds equal (HEARTBEAT_STALE_MS here, PIPELINE_STALL_QUIET_MINUTES there, both 60 min) or
 * one will re-drive an account the other considers alive.
 *
 * FAILS SAFE = degrades to the previous behaviour. On error, or no row, we report "not live" and the
 * caller proceeds to enqueue. Failing closed would let one bad query starve an account indefinitely,
 * which is worse than the double-enqueue this prevents.
 *
 * @returns {Promise<{live: boolean, jobId?: string, ageMs?: number}>}
 */
async function hasLiveAccountPhase(parentJobId) {
    try {
        const JobStatus = require('../../models/system/JobStatusModel.js');
        // Anchored so the index on `jobId` is usable — an unanchored regex would collection-scan.
        const row = await JobStatus.findOne({
            jobId: { $regex: `^${escapeRegex(parentJobId)}` },
            status: 'running',
            updatedAt: { $gt: new Date(Date.now() - HEARTBEAT_STALE_MS) },
        }).select('jobId updatedAt').lean();

        if (!row) return { live: false };
        return { live: true, jobId: row.jobId, ageMs: Date.now() - new Date(row.updatedAt).getTime() };
    } catch (err) {
        logger.warn(`[Producer] Could not check account liveness for ${parentJobId}: ${err.message}`);
        return { live: false };
    }
}

/**
 * Enqueue a single user for data processing
 * 
 * @param {string} userId - MongoDB ObjectId of the user to process
 * @param {Object} options - Optional job options
 * @param {number} options.priority - Job priority (higher = more important, default: 0)
 * @param {number} options.delay - Delay before processing (milliseconds, default: 0)
 * @param {string} options.jobId - Custom job ID (default: auto-generated)
 * @returns {Promise<Object>} Job object with id and other details
 */
async function enqueueUser(userId, options = {}) {
    try {
        const queue = getQueue();
        
        // Validate userId
        if (!userId || typeof userId !== 'string') {
            throw new Error('Invalid userId: must be a non-empty string');
        }

        // Check if user already has a pending or active job
        const existingJobs = await queue.getJobs(['waiting', 'active'], 0, -1);
        const duplicateJob = existingJobs.find(job => job.data.userId === userId.toString());

        if (duplicateJob) {
            logger.warn(`[Producer] User ${userId} already has a job in queue (jobId: ${duplicateJob.id}, state: ${duplicateJob.state})`);
            return {
                success: false,
                message: 'User already has a job in queue',
                jobId: duplicateJob.id,
                existingJob: duplicateJob
            };
        }

        // Create job data
        const jobData = {
            userId: userId.toString(),
            enqueuedAt: new Date().toISOString(),
            enqueuedBy: options.enqueuedBy || 'system'
        };

        // Job options
        const jobOptions = {
            priority: options.priority || 0,
            delay: options.delay || 0,
            jobId: options.jobId || `user-${userId}-${Date.now()}`,
            // Add metadata for tracking
            attempts: options.attempts || 3,
            backoff: options.backoff || {
                type: 'exponential',
                delay: 60000 // 1 minute initial delay
            }
        };

        // Add job to queue
        const job = await queue.add('process-user-data', jobData, jobOptions);

        logger.info(`[Producer] Enqueued user ${userId} for processing (jobId: ${job.id})`);

        return {
            success: true,
            jobId: job.id,
            userId: userId.toString(),
            state: 'waiting',
            enqueuedAt: jobData.enqueuedAt
        };

    } catch (error) {
        logger.error(`[Producer] Failed to enqueue user ${userId}:`, error);
        throw error;
    }
}

/**
 * Enqueue multiple users in bulk
 * 
 * Useful for:
 * - Initial migration
 * - Batch processing
 * - Recovery scenarios
 * 
 * @param {string[]} userIds - Array of user IDs to enqueue
 * @param {Object} options - Options for all jobs
 * @returns {Promise<Object>} Summary of enqueued jobs
 */
async function enqueueUsers(userIds, options = {}) {
    const results = {
        total: userIds.length,
        enqueued: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };

    logger.info(`[Producer] Starting bulk enqueue for ${userIds.length} users`);

    // Process in batches to avoid overwhelming Redis
    const batchSize = options.batchSize || 50;
    
    for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);
        
        await Promise.allSettled(
            batch.map(async (userId) => {
                try {
                    const result = await enqueueUser(userId, options);
                    if (result.success) {
                        results.enqueued++;
                    } else {
                        results.skipped++;
                    }
                } catch (error) {
                    results.failed++;
                    results.errors.push({
                        userId,
                        error: error.message
                    });
                    logger.error(`[Producer] Failed to enqueue user ${userId}:`, error);
                }
            })
        );

        // Small delay between batches to avoid overwhelming Redis
        if (i + batchSize < userIds.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    logger.info(`[Producer] Bulk enqueue completed: ${results.enqueued} enqueued, ${results.skipped} skipped, ${results.failed} failed`);

    return results;
}

/**
 * Get queue statistics
 * 
 * @returns {Promise<Object>} Queue statistics
 */
async function getQueueStats() {
    try {
        const queue = getQueue();
        
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount()
        ]);

        return {
            waiting,
            active,
            completed,
            failed,
            delayed,
            total: waiting + active + completed + failed + delayed
        };
    } catch (error) {
        logger.error('[Producer] Failed to get queue stats:', error);
        throw error;
    }
}

/**
 * Remove a job from the queue (for cancellation)
 * 
 * @param {string} jobId - Job ID to remove
 * @returns {Promise<boolean>} Success status
 */
async function removeJob(jobId) {
    try {
        const queue = getQueue();
        const job = await queue.getJob(jobId);
        
        if (!job) {
            logger.warn(`[Producer] Job ${jobId} not found`);
            return false;
        }

        await job.remove();
        logger.info(`[Producer] Removed job ${jobId} from queue`);
        return true;
    } catch (error) {
        logger.error(`[Producer] Failed to remove job ${jobId}:`, error);
        throw error;
    }
}

/**
 * Enqueue a per-account scheduled INIT phase job (new phased architecture).
 *
 * Uses a deterministic job ID so we can check for duplicates by exact ID
 * instead of scanning all jobs. Also applies a max-age safety net: if the
 * existing job is older than MAX_SCHEDULED_JOB_AGE, it is removed and a
 * fresh one is created (prevents jobs orphaned by worker crashes from
 * blocking the user forever).
 *
 * @param {string} userId
 * @param {string} country
 * @param {string} region
 * @returns {Promise<Object>}
 */
async function enqueueScheduledAccountJob(userId, country, region) {
    try {
        const queue = getQueue();

        if (!userId || !country || !region) {
            throw new Error('userId, country, and region are all required');
        }

        const parentJobId = `scheduled-${userId}-${country}-${region}`;
        const initJobId = `${parentJobId}-${PHASES.INIT}`;

        const allPhaseIds = scheduledPhasesModule.getAllPhaseJobIds(parentJobId);
        // Also check the parent ID itself (safety)
        const idsToCheck = [parentJobId, ...allPhaseIds];

        for (const jid of idsToCheck) {
            const existingJob = await queue.getJob(jid);
            if (!existingJob) continue;

            const state = await existingJob.getState();

            if (state === 'waiting' || state === 'active' || state === 'delayed') {
                const jobAge = Date.now() - existingJob.timestamp;

                // Old AND not demonstrably alive -> orphaned, remove it and re-drive.
                // Old but still beating -> a legitimately long phase (calc_review runs up to
                // 23.8h in production); removing it would destroy hours of real work and
                // restart the chain, which is exactly how an account gets stuck forever.
                if (jobAge > MAX_SCHEDULED_JOB_AGE && !(await hasRecentHeartbeat(jid))) {
                    logger.warn(`[Producer] Removing stale scheduled job ${jid} for user ${userId} ${country}-${region} (age: ${Math.round(jobAge / 3600000)}h, state: ${state}, no heartbeat within ${Math.round(HEARTBEAT_STALE_MS / 60000)}min)`);
                    try { await existingJob.remove(); } catch (re) { logger.warn(`[Producer] Could not remove stale job ${jid}: ${re.message}`); }
                } else {
                    if (jobAge > MAX_SCHEDULED_JOB_AGE) {
                        logger.info(`[Producer] Job ${jid} is ${Math.round(jobAge / 3600000)}h old but still heartbeating — leaving it alone (long-running phase, not orphaned)`);
                    }
                    logger.info(`[Producer] Scheduled job already in progress for ${userId} ${country}-${region} (jobId: ${jid}, state: ${state}, age: ${Math.round(jobAge / 60000)}min)`);
                    return { success: false, message: 'Account already has a scheduled job in progress', jobId: jid, state };
                }
            } else if (state === 'completed' || state === 'failed') {
                try { await existingJob.remove(); } catch (re) { logger.warn(`[Producer] Could not remove old job ${jid}: ${re.message}`); }
            } else {
                logger.warn(`[Producer] Removing job ${jid} with unexpected state: ${state}`);
                try { await existingJob.remove(); } catch (re) { logger.warn(`[Producer] Could not remove job ${jid}: ${re.message}`); }
            }
        }

        // The id checks above only see the phase ids getAllPhaseJobIds enumerates. An async
        // ads/finance phase waiting on Amazon lives under a `-poll{n}` id that is NOT in that list,
        // so at this point the pipeline can be very much alive while every id we looked at is gone.
        // Starting a second run on top of it is what orphaned the first run's tracking doc and
        // produced ~30% "stalled" runs on exactly the accounts that use the async engine.
        //
        // Deliberately AFTER the loop: the stale-job removal above must still get its chance to
        // clear a genuinely dead chain, or an account could be pinned by its own dead row forever.
        const liveness = await hasLiveAccountPhase(parentJobId);
        if (liveness.live) {
            logger.info(
                `[Producer] Pipeline still running for ${userId} ${country}-${region} ` +
                `(jobId: ${liveness.jobId}, heartbeat ${Math.round((liveness.ageMs || 0) / 60000)}min ago) — not starting another run`
            );
            return {
                success: false,
                message: 'Account already has a scheduled job in progress',
                jobId: liveness.jobId,
                state: 'running',
            };
        }

        // Create the INIT phase job
        const jobData = {
            userId: userId.toString(),
            country,
            region,
            phase: PHASES.INIT,
            parentJobId,
            enqueuedAt: new Date().toISOString(),
            enqueuedBy: 'cron-scheduled',
            phaseData: {}
        };

        const job = await queue.add('process-user-data', jobData, {
            jobId: initJobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60000 }
            // `timeout` intentionally absent — a no-op since BullMQ v4; see queue.js.
        });

        logger.info(`[Producer] Enqueued scheduled INIT for ${userId} ${country}-${region} (jobId: ${job.id})`);
        return { success: true, jobId: job.id, userId, country, region, state: 'waiting' };

    } catch (error) {
        logger.error(`[Producer] Failed to enqueue scheduled job for ${userId} ${country}-${region}:`, error);
        throw error;
    }
}

module.exports = {
    enqueueUser,
    enqueueUsers,
    enqueueScheduledAccountJob,
    getQueueStats,
    removeJob,
    // Exported for tests: the liveness check is the whole fix, and the threshold is asserted
    // against freshnessSweeper's so the two cannot silently drift apart.
    hasLiveAccountPhase,
    HEARTBEAT_STALE_MS
};


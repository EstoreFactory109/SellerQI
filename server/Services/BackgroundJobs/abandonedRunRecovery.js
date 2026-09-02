/**
 * abandonedRunRecovery.js
 *
 * What to do when BullMQ permanently gives up on a scheduled-phase job.
 *
 * Extracted from worker.js for the same reason lockExtension.js was: worker.js assigns its
 * module.exports inside startWorker()'s callback, so requiring it boots a real worker against
 * Mongo and Redis and the logic inside it cannot be tested on its own.
 */

const scheduledPhases = require('./scheduledPhases.js');
const { getQueue } = require('./queue.js');
const logger = require('../../utils/Logger.js');

/**
 * A scheduled-phase job that BullMQ has permanently given up on: end the run instead of leaving
 * it for dead.
 *
 * WHY THIS EXISTS. The `failed` handler used to close only the user's logging session — the
 * frontend spinner — and stop there. The run itself was abandoned: the phase's JobStatus row stayed
 * at `running` forever (nothing else ever writes it), no next phase was enqueued, so
 * `sched_finalize` never ran and the DataFetchTracking doc sat at `started` until the 9h stalled
 * sweep picked it up, 12-13h worst case.
 *
 * That is the "stalled at calc_review" symptom. calc_review is not special — it simply has a 26h
 * budget, so it is usually the phase in flight when a worker goes away. Confirmed on 2026-09-01:
 * PM2 restarted a worker for exceeding max_memory_restart (2.16GB > 2GB) 56 seconds after it picked
 * up calc_review, and that row has read `running` ever since.
 *
 * DELIBERATELY CAUSE-AGNOSTIC. Memory restarts are merely today's reason a worker vanishes; deploys,
 * OOM kills and crashes all arrive here too. Making the chain survive the loss is worth more than
 * eliminating any single cause of it.
 *
 * Advancing on failure is the pipeline's own existing policy — see processScheduledPhase, where a
 * phase that throws is recorded and the chain continues regardless.
 *
 * Lives in its own module so it is testable without booting the worker (worker.js assigns its
 * module.exports inside startWorker's callback, so requiring it connects to Mongo and Redis).
 */
async function closeOutAbandonedRun(job, err, { updateJobStatus, workerName }) {
    try {
        const attemptsMade = job?.attemptsMade || 0;
        const maxAttempts = job?.opts?.attempts || 1;
        const phase = job?.data?.phase;
        const parentJobId = job?.data?.parentJobId;
        const userId = job?.data?.userId;

        // Only once BullMQ is genuinely finished with it. A retry still to come means advancing
        // now would put two phases of the same run in flight at once.
        if (!phase || !parentJobId || attemptsMade < maxAttempts) return { acted: false, reason: 'retry pending or not a scheduled phase' };

        // The row is the whole reason this reads as "stuck": nothing else ever moves it off
        // `running`.
        await updateJobStatus(job.id, userId, 'failed', {
            failedAt: new Date().toISOString(),
            error: `Phase ${phase} abandoned: ${err?.message}`,
            attemptNumber: attemptsMade,
            maxAttempts,
            metadata: { phase, parentJobId, abandoned: true, country: job?.data?.country, region: job?.data?.region }
        });

        const nextPhase = scheduledPhases.getNextPhase(phase);
        if (nextPhase) {
            const nextJobData = scheduledPhases.createNextPhaseJobData(nextPhase, job.data, {
                success: false,
                error: `Phase ${phase} was abandoned (worker restarted or job stalled out): ${err?.message}`
            });
            const nextJobId = scheduledPhases.generatePhaseJobId(parentJobId, nextPhase);
            const queue = getQueue();

            // Free the id first: a completed job from the previous run owns it for 2h and BullMQ
            // would silently drop this add — the same collision that used to stall runs. An
            // `active` holder is never touched, because that is live work.
            const existing = await queue.getJob(nextJobId);
            if (existing && (await existing.getState().catch(() => 'unknown')) !== 'active') {
                await existing.remove().catch(() => {});
            }
            await queue.add('process-user-data', nextJobData, {
                jobId: nextJobId, attempts: 3, backoff: { type: 'exponential', delay: 60000 }
            });
            logger.warn(`[Worker:${workerName}] Phase ${phase} abandoned — advanced to ${nextPhase} so the run can reach finalize`, { userId, parentJobId });
            return { acted: true, advancedTo: nextPhase };
        }

        // No next phase — finalize itself, or a one-shot catch-up. Close the doc directly, or it
        // waits for the sweeper regardless.
        const trackingEntryId = job?.data?.phaseData?.trackingEntryId;
        if (trackingEntryId) {
            const DataFetchTrackingService = require('../system/DataFetchTrackingService.js');
            await DataFetchTrackingService.failTracking(trackingEntryId, `Pipeline abandoned at ${phase}: ${err?.message}`);
            logger.warn(`[Worker:${workerName}] Phase ${phase} abandoned with no next phase — closed tracking doc ${trackingEntryId}`, { userId });
            return { acted: true, closedTracking: trackingEntryId };
        }
        return { acted: true, advancedTo: null };
    } catch (recoverErr) {
        logger.error(`[Worker:${workerName}] Could not close out abandoned run for job ${job?.id}:`, recoverErr);
        return { acted: false, reason: recoverErr.message };
    }
}

module.exports = { closeOutAbandonedRun };

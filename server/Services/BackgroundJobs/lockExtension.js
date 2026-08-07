/**
 * lockExtension.js
 *
 * Keeps a long-running BullMQ job's lock alive — and, critically, STOPS doing so past a
 * hard ceiling.
 *
 * WHY THE CEILING IS THE IMPORTANT HALF
 * This is the only working timeout the queues have. A job-level `timeout` option has been
 * a no-op since BullMQ v4 removed it from JobsOptions (we run 5.x), so every
 * `timeout: 2 * 60 * 60 * 1000` that used to sit in the job options was decoration — it
 * read as a safety net that did not exist. The only things that can end a stuck phase are
 * the worker dying, or BullMQ reclaiming the job once its lock lapses. Extending the lock
 * unconditionally defeats the second by telling BullMQ "still alive" forever.
 *
 * Production 2026-08-06: `sched_ads` for one account sat `active` for 7.8 HOURS with
 * `attempts: 0`, lock dutifully renewed the whole time. Phase job ids are deterministic
 * (`scheduled-<user>-<country>-<region>-<phase>`) and BullMQ SILENTLY DROPS an add whose
 * id already exists, so that one stuck job then swallowed every later attempt to run that
 * phase — including a manual re-drive, which ran two phases and then evaporated with no
 * error anywhere. The account's dashboard silently froze for two days.
 *
 * Past the ceiling we stop renewing. The lock lapses, BullMQ reclaims the job as stalled,
 * `maxStalledCount`/`attempts` apply, and it fails LOUDLY and frees its id. A phase that
 * legitimately needs longer than the ceiling should release the worker and poll (the
 * `reschedule` path), not hold a slot.
 *
 * THE TIMING IS NOT EXACTLY THE CEILING — do the arithmetic before tuning it.
 * The last renewal before the ceiling pushes the lock `amountMs` into the future, so the
 * lock actually lapses at roughly `maxMs + amountMs` (with the defaults: a 3h ceiling and
 * 1h renewals => reclaimed at ~4h), plus up to one `stalledInterval` for BullMQ to notice.
 * A phase that hangs every time is then re-run on each reclaim until `maxStalledCount`
 * (3) is exhausted, so worst case is several times that before it finally fails for good.
 * Far better than never, but it is not a crisp deadline — the sweepStalledPipelines()
 * backstop in freshnessSweeper.js exists partly because of that long tail.
 *
 * Ceiling >> longest legitimate phase is therefore essential: once we stop renewing, the
 * reclaimed job runs AGAIN while the original invocation may still be executing. For a
 * genuinely hung phase that is harmless (it is not doing anything), but for a merely slow
 * one it would mean two concurrent runs of the same phase.
 *
 * Extracted from worker.js/integrationWorker.js, which each carried their own copy — the
 * duplication meant the missing ceiling had to be found and fixed twice, and would have
 * drifted again.
 */

const logger = require('../../utils/Logger.js');

/**
 * Extend a job's lock, retrying transient failures with exponential backoff.
 *
 * @param {object} job              BullMQ job
 * @param {number} extensionAmount  ms to extend by
 * @param {object} [opts]
 * @param {number} [opts.maxRetries=3]
 * @param {string} [opts.label='Worker']  log prefix
 * @returns {Promise<boolean>} whether the lock was extended
 */
async function extendLockWithRetry(job, extensionAmount, { maxRetries = 3, label = 'Worker' } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await job.extendLock(job.token, extensionAmount);
            return true;
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt - 1) * 1000;
                logger.warn(`[${label}] Lock extension attempt ${attempt}/${maxRetries} failed for job ${job.id}, retrying in ${delay}ms: ${error.message}`);
                // unref: a backoff sleep must never be the thing keeping the process alive.
                // This chain can outlive the job it was extending (the job finishes, the
                // interval is cleared, but an in-flight retry is still sleeping), and on
                // shutdown that would hold the worker open for no reason.
                await new Promise((resolve) => {
                    const t = setTimeout(resolve, delay);
                    if (typeof t.unref === 'function') t.unref();
                });
            }
        }
    }
    logger.error(`[${label}] Lock extension failed after ${maxRetries} attempts for job ${job.id}: ${lastError?.message}`);
    return false;
}

/**
 * Run `asyncFn`, holding the job's lock alive until it finishes OR the ceiling is hit.
 *
 * @param {object} job     BullMQ job
 * @param {Function} asyncFn
 * @param {object} opts
 * @param {number} opts.maxMs        ceiling on total runtime before we stop renewing
 * @param {number} opts.intervalMs   how often to renew
 * @param {number} opts.amountMs     how much to renew by
 * @param {string} [opts.label='Worker']
 * @param {boolean} [opts.verbose=false]  log each successful extension
 * @returns {Promise<*>} whatever asyncFn returns
 */
async function runWithLockExtension(job, asyncFn, { maxMs, intervalMs, amountMs, label = 'Worker', verbose = false } = {}) {
    let isRunning = true;
    let extensionCount = 0;
    let failedExtensions = 0;
    let ceilingHit = false;
    const startedAt = Date.now();

    const timer = setInterval(async () => {
        if (!isRunning) return;

        const elapsed = Date.now() - startedAt;
        if (elapsed >= maxMs) {
            // Deliberately do NOT throw from here. This runs on a timer, outside the job's
            // async context, so a throw would surface as an unhandled rejection and would
            // not stop `asyncFn` anyway. Letting the lock lapse is what hands control back
            // to BullMQ, which is the whole mechanism.
            if (!ceilingHit) {
                ceilingHit = true;
                logger.error(
                    `[${label}] Job ${job.id} has run ${Math.round(elapsed / 60000)}min, past the ${Math.round(maxMs / 60000)}min ceiling — NO LONGER extending its lock. It will be reclaimed as stalled and retried/failed, which also frees its job id. Treat this as a HUNG PHASE and investigate.`,
                    { jobId: job.id, phase: job.data?.phase, userId: job.data?.userId, elapsedMs: elapsed }
                );
            }
            clearInterval(timer);
            return;
        }

        const ok = await extendLockWithRetry(job, amountMs, { label });
        if (ok) {
            extensionCount++;
            failedExtensions = 0;
            if (verbose) logger.info(`[${label}] Extended lock for job ${job.id} (extension #${extensionCount})`);
        } else {
            failedExtensions++;
            if (failedExtensions >= 2) {
                logger.error(`[${label}] Multiple consecutive lock extension failures (${failedExtensions}) for job ${job.id} - job may be at risk of stalling`);
            }
        }
    }, intervalMs);

    try {
        return await asyncFn();
    } finally {
        isRunning = false;
        clearInterval(timer);
        if (ceilingHit) {
            logger.error(
                `[${label}] Job ${job.id} finally returned after ${Math.round((Date.now() - startedAt) / 60000)}min, past the lock-extension ceiling — its result may already have been discarded as stalled.`,
                { jobId: job.id, phase: job.data?.phase, userId: job.data?.userId }
            );
        } else if (verbose && (extensionCount > 0 || failedExtensions > 0)) {
            logger.info(`[${label}] Lock extension timer cleared for job ${job.id} - ${extensionCount} successful extensions, ${failedExtensions} final failures`);
        }
    }
}

/**
 * Pick a job's ceiling.
 *
 * Exists as its own function purely so the carve-out can be tested: getting it wrong in
 * the "too low" direction is not a harmless false positive. A wrongly-reclaimed job is
 * RE-RUN, and `sched_calc_review` does review ingestion/sending — re-running a live one
 * risks duplicate review requests to real customers. Production data shows calc_review
 * legitimately reaching 23.8h while every other phase stays under 2h.
 *
 * @param {string|undefined} phase   job.data.phase; absent = legacy whole-account job
 * @param {object} cfg
 * @param {number} cfg.defaultMs     ceiling for ordinary phases
 * @param {number} cfg.longMs        ceiling for long phases and phaseless jobs
 * @param {Set<string>} [cfg.longPhases]
 * @returns {number}
 */
function resolveCeiling(phase, { defaultMs, longMs, longPhases }) {
    if (!phase) return longMs;   // legacy phaseless run — no per-phase budget applies
    return longPhases && longPhases.has(phase) ? longMs : defaultMs;
}

module.exports = { extendLockWithRetry, runWithLockExtension, resolveCeiling };

/**
 * zohoTaskSyncStandalone.js
 *
 * Nightly job that pulls tasks (and their comments) from every Zoho project an
 * ESF client is linked to, into ZohoProjectTask.
 *
 * WHY A SEPARATE JOB
 * This is org-wide work — one Zoho connection, N linked projects — not per-seller
 * work, so it does not belong in ScheduleConfig/ScheduledIntegration, which is
 * built around a seller account plus its SP-API tokens and batches. Putting it
 * there would mean re-running it once per seller account for no reason.
 *
 * WHY SYNC AT ALL, RATHER THAN CALLING ZOHO ON PAGE LOAD
 * Fetching a project's comments is one API call per task — the linked project
 * measured 76 tasks / 1,062 comments and ~30s to walk. That is fine once a day
 * and unacceptable on a page load, and it would put Zoho's rate limiter directly
 * in the path of a client viewing their own Status page.
 *
 * SAFETY (mirrors reviewWorkerStandalone / freshnessSweeperStandalone)
 *   - One OrchestrationCronLock per UTC day, so two hosts cannot both sweep.
 *     The key is date-bucketed, so a tick that dies without releasing cannot
 *     swallow the next day's run.
 *   - Per-project try/catch lives in the service: one project failing (deleted
 *     in Zoho, permissions changed) cannot end the sweep for the others.
 *   - A tick budget stops STARTING new projects once exceeded, and the summary
 *     says so rather than quietly covering less than it appears to.
 *   - Pruning of unlinked projects is skipped when the budget bit, since a
 *     partial project list would delete rows that merely timed out.
 *
 * ROLLBACK
 *   - ZOHO_TASK_SYNC_ENABLED is OFF by default. While off the tick still runs
 *     and logs exactly which projects it WOULD sync, and writes nothing.
 *   - To stop it entirely: remove the setupCron call in cronProducerStandalone.js.
 *
 * WHERE THIS RUNS
 * Registered by cronProducerStandalone.js, the process that "owns ALL cron-based
 * scheduling for SellerQI" — NOT as its own PM2 app. That is a memory decision,
 * not a stylistic one: ecosystem.config.js is held to 80% of a 16 GB host by
 * ecosystemMemoryCheck.test.js and the committed budget is already 12.75 GB of
 * that 12.8 GB ceiling, so adding any new app — even a 64M one — fails the
 * build. This file still exports setupCron/runSyncTick and still runs standalone
 * (`node zohoTaskSyncStandalone.js`) so it can be split out unchanged the moment
 * that budget frees up.
 */

require('dotenv').config();

const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');

// The lock's "did I win?" check compares this string, so two holders that
// collided would both believe they hold it. pid+timestamp alone collides for two
// processes started in the same millisecond.
const HOLDER = `zoho-task-sync-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Default OFF, same as the review worker shipped: the tick logs what it would do
// until that log has been read once in production.
const ENABLED = process.env.ZOHO_TASK_SYNC_ENABLED === 'true';

// 02:00 UTC — clear of the 01:00 review worker, the 00:00 finance deep-resync,
// the 03:00 doc-size sweep and the 06:00 alerts run.
const CRON = process.env.ZOHO_TASK_SYNC_CRON || '0 2 * * *';

// Stop STARTING new projects past this point. Each project is a paginated task
// walk plus one comment call per task, so a portal that grows a lot could
// otherwise run long; an in-flight project is never interrupted.
const TICK_BUDGET_MS = Math.max(
    60_000,
    parseInt(process.env.ZOHO_TASK_SYNC_TICK_BUDGET_MS || String(2 * 60 * 60 * 1000), 10) || 2 * 60 * 60 * 1000
);

// Just under 24h so a tick that dies mid-run cannot hold the lock into a second
// day. The date-bucketed key already covers that; this is the belt to its braces.
const LOCK_TTL_MS = 23 * 60 * 60 * 1000;

async function acquireLock(lockKey) {
    const OrchestrationCronLock = require('../../models/system/OrchestrationCronLockModel.js');
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + LOCK_TTL_MS);
    try {
        // Upsert: only succeeds when the existing doc is expired (or missing).
        await OrchestrationCronLock.findOneAndUpdate(
            { lockKey, $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }] },
            { $set: { lockedUntil, holder: HOLDER } },
            { upsert: true, new: true }
        );
        // Concurrent upserts collide on the unique index and the loser reads the
        // winner's holder — so verify rather than trusting the write.
        const current = await OrchestrationCronLock.findOne({ lockKey }).lean();
        return !!current && current.holder === HOLDER;
    } catch (error) {
        if (error && (error.code === 11000 || error.code === 11001)) return false;
        logger.error('[ZohoTaskSync] Lock acquisition error', { lockKey, error: error?.message });
        return false;
    }
}

async function releaseLock(lockKey) {
    const OrchestrationCronLock = require('../../models/system/OrchestrationCronLockModel.js');
    try {
        await OrchestrationCronLock.updateOne({ lockKey, holder: HOLDER }, { $set: { lockedUntil: new Date(0) } });
    } catch (error) {
        logger.warn('[ZohoTaskSync] Lock release error', { lockKey, error: error?.message });
    }
}

/** Date-bucketed so a tick that dies without releasing cannot swallow the next day. */
function lockKeyForToday(now = new Date()) {
    return `zoho-task-sync-${now.toISOString().slice(0, 10)}`;
}

/**
 * One sweep. Safe to call directly (scripts, a manual re-sync) — the lock lives
 * in the cron wrapper, not here.
 */
async function runSyncTick() {
    const ZohoTaskSync = require('../Zoho/ZohoTaskSync.js');
    const startedAt = Date.now();

    const projects = await ZohoTaskSync.linkedProjects();

    if (!ENABLED) {
        // Dry run: prove what the sweep would touch before it is allowed to write.
        logger.info('[ZohoTaskSync] DISABLED — would sync these projects', {
            projects: projects.map((p) => ({
                projectId: p.projectId,
                projectName: p.projectName,
                clients: p.clientCount,
            })),
        });
        return { enabled: false, projects: projects.length, durationMs: Date.now() - startedAt };
    }

    /*
     * Tasks and billing are INDEPENDENT. A client can be invoiced without anyone
     * having linked a Zoho project for them, so an early return here for "no linked
     * projects" would silently stop their invoices syncing too — which is exactly
     * what this block used to do.
     */
    let summary = { projects: 0 };

    if (!projects.length) {
        logger.info('[ZohoTaskSync] No clients are linked to a Zoho project — skipping tasks, still syncing billing');
    } else {
        summary = await ZohoTaskSync.syncAllProjects({ deadlineAt: startedAt + TICK_BUDGET_MS });

        if (summary.skippedForTime) {
            logger.warn(`[ZohoTaskSync] Tick budget exceeded — ${summary.skippedForTime} project(s) not started this run`);
        }
    }

    /*
     * Billing rides the same tick rather than taking its own cron.
     *
     * It is a handful of calls per client against a different Zoho product, and
     * ecosystem.config.js is already at 12.75GB of its 12.8GB budget — the same
     * constraint that put this whole job in cronProducerStandalone instead of its own
     * PM2 app. Wrapped separately so a Billing failure cannot lose a task sync that
     * already succeeded.
     */
    let billing = null;
    try {
        const ZohoBillingSync = require('../Zoho/ZohoBillingSync.js');
        billing = await ZohoBillingSync.syncAllBilling();
        logger.info('[ZohoBillingSync] Complete', {
            clients: billing.clients, linked: billing.linked, invoices: billing.invoices, failed: billing.failed,
        });
    } catch (error) {
        logger.error('[ZohoBillingSync] Failed', { error: error?.message });
        billing = { error: error?.message };
    }

    return { enabled: true, ...summary, billing, durationMs: Date.now() - startedAt };
}

function setupCron() {
    const cron = require('node-cron');

    const job = cron.schedule(CRON, async () => {
        const lockKey = lockKeyForToday();
        const acquired = await acquireLock(lockKey);
        if (!acquired) {
            logger.info('[ZohoTaskSync] Another instance holds today\'s lock — skipping tick', { lockKey });
            return;
        }
        try {
            logger.info('[ZohoTaskSync] Tick starting (lock acquired)', { lockKey, enabled: ENABLED });
            const summary = await runSyncTick();
            logger.info('[ZohoTaskSync] Tick complete', summary);
        } catch (error) {
            logger.error('[ZohoTaskSync] Tick failed', { error: error?.message, stack: error?.stack });
        } finally {
            await releaseLock(lockKey);
        }
    }, {
        scheduled: false,
        timezone: process.env.TIMEZONE || 'UTC',
    });

    job.start();
    logger.info(`[ZohoTaskSync] Cron scheduled (${CRON}, lock-guarded)`, {
        enabled: ENABLED,
        tickBudgetMs: TICK_BUDGET_MS,
    });
    return job;
}

async function start() {
    try {
        await dbConnect();
        logger.info('[ZohoTaskSync] Database connected');
        setupCron();
        // RUN_ON_BOOT is for verifying a deploy without waiting for 02:00 UTC.
        if (process.env.ZOHO_TASK_SYNC_RUN_ON_BOOT === 'true') {
            logger.info('[ZohoTaskSync] RUN_ON_BOOT set — running one tick now');
            const lockKey = lockKeyForToday();
            if (await acquireLock(lockKey)) {
                try {
                    logger.info('[ZohoTaskSync] Boot tick complete', await runSyncTick());
                } finally {
                    await releaseLock(lockKey);
                }
            }
        }
    } catch (error) {
        logger.error('[ZohoTaskSync] Failed to start', { error: error?.message, stack: error?.stack });
        process.exit(1);
    }
}

if (require.main === module) {
    start();
}

module.exports = {
    setupCron,
    runSyncTick,
    acquireLock,
    releaseLock,
    lockKeyForToday,
    ENABLED,
    CRON,
};

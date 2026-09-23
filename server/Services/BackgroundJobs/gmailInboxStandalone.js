/**
 * gmailInboxStandalone.js
 *
 * Two crons for the shared ESF inbox:
 *   - a poll that syncs mail every GMAIL_POLL_MINUTES
 *   - a daily renewal of the Gmail push watch
 *
 * WHY POLLING EXISTS ALONGSIDE PUSH
 * Not a fallback bolted on — a first-class second path. A Pub/Sub push dropped during a
 * deploy is simply gone; there is no redelivery for a 2xx we never sent because the
 * process was restarting. Without the poll, that mail is invisible until the next
 * unrelated email happens to arrive. Polling is also the only way to develop this on
 * localhost, where Google cannot reach a push endpoint.
 *
 * WHY THE WATCH RENEWAL IS DAILY, NOT WEEKLY
 * Gmail expires a watch after ~7 days. Renewing weekly means one missed tick — a deploy,
 * a restart, a lock held by a dead process — silently ends push until someone notices
 * mail arriving ten minutes late. Daily makes a missed tick cost nothing.
 *
 * WHERE THIS RUNS
 * Registered by cronProducerStandalone.js, NOT as its own PM2 app. That is a memory
 * decision: ecosystem.config.js is held to 80% of a 16GB host by
 * ecosystemMemoryCheck.test.js and the committed budget is already 12.75GB of that
 * 12.8GB ceiling, so adding any new app fails the build. The same reasoning put
 * zohoTaskSyncStandalone there. This file still exports setupCron/runPollTick and still
 * runs standalone, so it can be split out unchanged when that budget frees up.
 *
 * ROLLBACK
 *   - GMAIL_MESSAGING_ENABLED is OFF by default; both ticks no-op while it is.
 *   - To stop it entirely: remove the setupCron call in cronProducerStandalone.js.
 */

require('dotenv').config();

const logger = require('../../utils/Logger.js');

const HOLDER = `gmail-inbox-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const POLL_MINUTES = (() => {
    const raw = Number(process.env.GMAIL_POLL_MINUTES);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
})();

const POLL_CRON = process.env.GMAIL_POLL_CRON || `*/${POLL_MINUTES} * * * *`;
// 03:00 UTC — clear of the 01:00 review worker, 02:00 Zoho sync and 00:00 finance resync.
const WATCH_CRON = process.env.GMAIL_WATCH_CRON || '0 3 * * *';

/**
 * Just under the poll interval.
 *
 * A poll that dies without releasing must not block the next one for long — but the
 * cursor is a single serialised value, so two polls must never overlap either. The
 * minute-bucketed key below is the real guard; this is the belt to its braces.
 */
const POLL_LOCK_TTL_MS = Math.max(60_000, POLL_MINUTES * 60_000 - 5_000);
const WATCH_LOCK_TTL_MS = 23 * 60 * 60 * 1000;

async function acquireLock(lockKey, ttlMs) {
    const OrchestrationCronLock = require('../../models/system/OrchestrationCronLockModel.js');
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + ttlMs);
    try {
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
        logger.error('[GmailInbox] Lock acquisition error', { lockKey, error: error?.message });
        return false;
    }
}

async function releaseLock(lockKey) {
    const OrchestrationCronLock = require('../../models/system/OrchestrationCronLockModel.js');
    try {
        await OrchestrationCronLock.updateOne({ lockKey, holder: HOLDER }, { $set: { lockedUntil: new Date(0) } });
    } catch (error) {
        logger.warn('[GmailInbox] Lock release error', { lockKey, error: error?.message });
    }
}

/**
 * Bucketed to the poll window, so a tick that dies without releasing cannot swallow
 * every subsequent poll — only the one it was in.
 */
function pollLockKey(now = new Date()) {
    const bucket = Math.floor(now.getTime() / (POLL_MINUTES * 60_000));
    return `gmail-poll-${bucket}`;
}

function watchLockKey(now = new Date()) {
    return `gmail-watch-${now.toISOString().slice(0, 10)}`;
}

/** One sync. Safe to call directly — the lock lives in the cron wrapper, not here. */
async function runPollTick() {
    const { runSync } = require('../Gmail/GmailIngestService.js');
    return runSync({ reason: 'poll' });
}

/**
 * Renew the push watch.
 *
 * Also re-establishes it after a lapse: `users.watch` is idempotent, so calling it on a
 * live watch simply extends it.
 */
async function runWatchTick() {
    const { isMessagingEnabled, getPubSubConfig, WATCH_LABEL_IDS } = require('../Gmail/config.js');
    if (!isMessagingEnabled()) return { skipped: 'disabled' };

    const { topicName } = getPubSubConfig();
    if (!topicName) return { skipped: 'no-topic' };

    const GmailConnection = require('../../models/system/GmailConnectionModel.js');
    const connection = await GmailConnection.findOne({ key: GmailConnection.SINGLETON_KEY }).lean();
    if (!connection) return { skipped: 'not-connected' };

    const GmailClient = require('../Gmail/GmailClient.js');
    const result = await GmailClient.watch({ topicName, labelIds: WATCH_LABEL_IDS });

    await GmailConnection.updateOne(
        { key: GmailConnection.SINGLETON_KEY },
        {
            $set: {
                watchTopic: topicName,
                watchExpiration: result.expiration ? new Date(Number(result.expiration)) : null,
            },
        }
    );

    /**
     * The returned historyId is NOT written to the cursor.
     *
     * It is where history stands now, and adopting it would skip everything between the
     * stored cursor and this moment. The watch tells us when to look, never where from.
     */
    return { expiration: result.expiration, labelIds: WATCH_LABEL_IDS };
}

/**
 * The worker behind the push queue.
 *
 * CONCURRENCY 1, and not for throughput: the history cursor is a single serialised
 * value, so two syncs advancing it at once loses mail exactly as advancing past a
 * failure would. It is a correctness constraint.
 *
 * The distributed lock is shared with the poll for the same reason — a push arriving
 * mid-poll must wait, not run alongside. When it cannot get the lock it returns rather
 * than retrying, because whichever sync holds it walks history to the present and will
 * pick up the same message.
 */
function setupWorker() {
    const { Worker } = require('bullmq');
    const { GMAIL_INBOX_QUEUE_NAME, queueConfig } = require('./gmailInboxQueue.js');

    const worker = new Worker(GMAIL_INBOX_QUEUE_NAME, async (job) => {
        const lockKey = pollLockKey();
        if (!await acquireLock(lockKey, POLL_LOCK_TTL_MS)) {
            return { skipped: 'sync-already-running' };
        }
        try {
            const { runSync } = require('../Gmail/GmailIngestService.js');
            return await runSync({ reason: job.data?.reason || 'push' });
        } finally {
            await releaseLock(lockKey);
        }
    }, { connection: queueConfig.connection, prefix: 'bullmq', concurrency: 1 });

    worker.on('failed', (job, error) => {
        logger.error('[GmailInbox] Sync job failed', { jobId: job?.id, error: error?.message });
    });

    logger.info('[GmailInbox] Sync worker started (concurrency 1)');
    return worker;
}

function setupCron() {
    const cron = require('node-cron');

    const pollJob = cron.schedule(POLL_CRON, async () => {
        const lockKey = pollLockKey();
        if (!await acquireLock(lockKey, POLL_LOCK_TTL_MS)) return;
        try {
            const summary = await runPollTick();
            if (summary?.seen > 0 || summary?.failed > 0) {
                logger.info('[GmailInbox] Poll complete', summary);
            }
        } catch (error) {
            logger.error('[GmailInbox] Poll failed', { error: error?.message });
        } finally {
            await releaseLock(lockKey);
        }
    }, { scheduled: false, timezone: process.env.TIMEZONE || 'UTC' });

    const watchJob = cron.schedule(WATCH_CRON, async () => {
        const lockKey = watchLockKey();
        if (!await acquireLock(lockKey, WATCH_LOCK_TTL_MS)) return;
        try {
            const result = await runWatchTick();
            logger.info('[GmailInbox] Watch renewal', result);
        } catch (error) {
            logger.error('[GmailInbox] Watch renewal failed', { error: error?.message });
        } finally {
            await releaseLock(lockKey);
        }
    }, { scheduled: false, timezone: process.env.TIMEZONE || 'UTC' });

    pollJob.start();
    watchJob.start();

    // The push worker lives beside the crons so push and poll share one lock holder
    // and one process — two syncs must never advance the cursor concurrently.
    let worker = null;
    try {
        worker = setupWorker();
    } catch (error) {
        // A missing queue Redis must not take the poll down with it: polling alone
        // still delivers every message, just up to GMAIL_POLL_MINUTES later.
        logger.error('[GmailInbox] Sync worker failed to start — polling continues', { error: error?.message });
    }

    logger.info(`[GmailInbox] Crons registered (poll "${POLL_CRON}", watch "${WATCH_CRON}")`);
    return { pollJob, watchJob, worker };
}

module.exports = { setupCron, setupWorker, runPollTick, runWatchTick, pollLockKey, watchLockKey };

// Standalone: `node gmailInboxStandalone.js`
if (require.main === module) {
    const dbConnect = require('../../config/dbConn.js');
    dbConnect()
        .then(() => setupCron())
        .catch((error) => {
            logger.error('[GmailInbox] Failed to start', { error: error?.message });
            process.exit(1);
        });
}

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
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHEN MAIL STOPS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The symptom is always the same and always ambiguous: a quiet inbox, which is
 * indistinguishable from a quiet week. That ambiguity is the whole reason
 * GET /api/gmail/status exists — read it first, not the logs.
 *
 *   lastError mentions invalid_grant
 *       The refresh token is dead, almost always the 7-day expiry that applies while
 *       the OAuth app is in "Testing" publishing status (see Services/Gmail/config.js).
 *       Fix the status, then reconnect.
 *
 *   lastError mentions a backfill
 *       The history cursor is older than Gmail's ~1 week window. It cannot be recovered
 *       by retrying and every later run will 404 too. POST /api/gmail/backfill.
 *
 *   lastError mentions "failing to ingest"
 *       The retry backlog passed its cap. That is systemic rather than bad luck — read
 *       the logs for the repeated failure rather than waiting it out.
 *
 *   watchHealthy: false
 *       Push has lapsed and only polling is delivering, so mail is arriving up to
 *       GMAIL_POLL_MINUTES late. POST /api/gmail/watch.
 *
 *   minutesSinceSync far exceeds pollMinutes
 *       This cron is not running at all. Check the cron-producer process.
 *
 *   everything healthy, still nothing
 *       Probably genuinely quiet — or senders are going unmatched, which is the quiet
 *       failure worth checking first. A client mailing from an address we do not hold
 *       is ignored by design: they get no reply and nobody learns they wrote. The count
 *       is in every sync summary; grep "[GmailIngest] no client matched" for the rest.
 *       The address itself is deliberately NOT logged, because utils/Logger.js writes
 *       unrotated to logs.txt and that would put client addresses on disk permanently.
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
 * Delete uploads left behind in public/temp.
 *
 * The send path unlinks its own files on every outcome, success or failure. What it
 * cannot cover is the process dying in between — a deploy restart mid-send, an OOM
 * kill — which leaves the file there with nothing that will ever look at it again.
 *
 * One orphan is nothing. The problem is the shape of the failure: it accumulates
 * silently for months and then presents as a full disk, which looks like anything
 * except an attachment feature. Cheap to prevent, unpleasant to diagnose.
 *
 * Six hours, because a send takes seconds — anything older than that is certainly not
 * in flight, and the margin means a genuinely slow upload is never deleted underneath
 * itself.
 */
const TEMP_ORPHAN_AGE_MS = 6 * 60 * 60 * 1000;

async function sweepTempUploads() {
    const fs = require('fs/promises');
    const path = require('path');
    const tempDir = path.resolve(__dirname, '../../public/temp');

    let removed = 0;
    try {
        const entries = await fs.readdir(tempDir);
        const cutoff = Date.now() - TEMP_ORPHAN_AGE_MS;

        for (const name of entries) {
            const full = path.join(tempDir, name);
            try {
                // eslint-disable-next-line no-await-in-loop
                const stat = await fs.stat(full);
                if (stat.isFile() && stat.mtimeMs < cutoff) {
                    // eslint-disable-next-line no-await-in-loop
                    await fs.unlink(full);
                    removed += 1;
                }
            } catch (_) {
                // Raced with the send path unlinking it. Nothing to do.
            }
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            logger.warn('[GmailInbox] temp sweep failed', { error: error.message });
        }
    }

    if (removed > 0) logger.info(`[GmailInbox] removed ${removed} orphaned upload(s) from public/temp`);
    return { removed };
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
            // Runs regardless of GMAIL_MESSAGING_ENABLED: files can be orphaned by a
            // crash and then the feature switched off, and they would never be
            // collected at all.
            await sweepTempUploads();

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

module.exports = {
    setupCron, setupWorker, runPollTick, runWatchTick, sweepTempUploads, pollLockKey, watchLockKey,
};

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

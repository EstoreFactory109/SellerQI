/**
 * reviewWorkerStandalone.js
 *
 * Standalone PM2 process that runs the two review services — order ingestion and
 * review-request sending — for every eligible account, once a day.
 *
 * WHY THIS EXISTS
 * Both services used to run inside `sched_calc_review`, the last phase before
 * `sched_finalize`. `sched_finalize` is the ONLY thing that closes a run's
 * DataFetchTracking doc, and that doc is what publishes the dashboard's date range. So
 * a seller's dashboard stayed stale until review requests had finished going out to
 * buyers — work that has no bearing on anything the dashboard shows.
 *
 * Measured over the 114 accounts that completed the phase:
 *
 *     sched_calc_review   p50 1.3 min   p90 37.7 min   max 1,426 min (23.8 h)
 *                         26 accounts > 10 min     8 accounts > 60 min
 *
 * The sender is the reason. It sleeps 5s after every order and up to 15s when it has to
 * re-check eligibility first (reviewRequestSenderService.js:220/:248/:351), with a cap of
 * 400 orders per run — 33 to 100 minutes of deliberate rate-limiting, single-threaded.
 * That is correct behaviour for talking to Amazon, and completely wrong behaviour to put
 * in front of a dashboard refresh.
 *
 * WHAT THIS PROCESS PRESERVES EXACTLY
 *   - Ingestion runs Mon/Wed/Fri; sending runs daily. See INGEST_DAYS below — running
 *     both daily would triple ingestion's SP-API order calls.
 *   - The PRO/trial gate stays where it is, INSIDE scheduledReviewRequestSender
 *     (scheduledReviewRequestProcessor.js:29-38), which returns success+skipped for a
 *     LITE account. Ingestion deliberately has NO plan gate — LITE accounts still get
 *     their orders ingested because that powers GET /api/review/recent-orders. This
 *     process calls both processors unmodified and re-implements neither gate.
 *   - `REVIEW_INGEST_STREAMING` is passed through from the PM2 env, so ingestion runs in
 *     the same mode it does in the pipeline today. Changing ingestion mode is a separate
 *     decision from moving where it runs.
 *
 * SAFETY
 *   - One `OrchestrationCronLock` per UTC day (same pattern as freshnessSweeperStandalone).
 *     The sender has no per-order claim, so two concurrent runs for one account could
 *     double-solicit; the lock is what rules that out. (Amazon's 403 `alreadySent` would
 *     stop a buyer ever seeing two, but it burns the one solicitation that order gets.)
 *   - The lock key is bucketed by date, so a tick that dies without releasing cannot
 *     swallow the next day's run.
 *   - Per-account try/catch: one seller's failure cannot end the sweep.
 *   - A tick budget stops STARTING new accounts once exceeded, and says so in the summary
 *     rather than silently covering less than it looks like it did.
 *
 * ROLLBACK
 *   - `REVIEW_WORKER_ENABLED` is OFF by default. While off, the tick still runs and logs
 *     exactly which accounts it WOULD process and how, and calls neither processor. That
 *     is the shipped state: the pipeline keeps doing this work until the log is verified.
 *   - To stop it entirely: don't start the `review-worker` PM2 app.
 *
 * Run via PM2:
 *   pm2 start ecosystem.config.js --only review-worker
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');

// The random suffix is not decoration: the lock's "did I win?" check compares this string,
// so two holders that collide would both believe they hold it. pid+timestamp alone collides
// for two processes started in the same millisecond — unlikely across hosts, but the whole
// point of this lock is that the sender must never run twice for one account.
const HOLDER = `review-worker-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Default OFF. The pipeline is still running batches 6 and 7 when this ships, so the
// worker must be provably inert until the two are swapped in a single change.
const ENABLED = process.env.REVIEW_WORKER_ENABLED === 'true';

// 01:00 UTC is the measured quiet hour for the pipeline (4 runs vs 84 at the peak) and is
// free of every other schedule: 00:00 finance deep-resync, 03:00 doc-size sweep, 06:00
// alerts, the hourly cron-producer at :00, and the freshness sweeper every 3h at :00.
const REVIEW_WORKER_CRON = process.env.REVIEW_WORKER_CRON || '0 1 * * *';

/**
 * Ingestion is Mon/Wed/Fri, sending is daily.
 *
 * This mirrors ScheduleConfig's MON_WED_FRI_FUNCTIONS / DAILY_FUNCTIONS membership, which
 * is where these two live until the cutover removes them. It is stated here rather than
 * read from `getFunctionsForDay` for one reason: the cutover DELETES both entries from
 * ScheduleConfig, so deriving the cadence from it would silently reduce this worker to
 * doing nothing the moment the pipeline entries go. `reviewWorker.test.js` cross-checks
 * these against ScheduleConfig for as long as the entries exist, and retires itself
 * afterwards.
 *
 * UTC, not server-local. The pipeline uses `new Date().getDay()`
 * (ScheduledIntegration.js:4106) which agrees only because production runs UTC; this is
 * the same day number DataFetchTracking records, so it stays right if that ever changes.
 */
const INGEST_DAYS = new Set([1, 3, 5]); // Monday, Wednesday, Friday

// How many accounts run at once. These are I/O-bound on deliberate multi-second sleeps
// against Amazon, not on CPU, so a small fixed batch is enough; the house pattern
// (alertsWorker, weeklyHistoryWorker) is fixed-size batches + Promise.allSettled.
//
// 3 matches WORKER_CONCURRENCY, i.e. the number of accounts this exact work already runs
// for concurrently today. It is also a memory bound: non-streaming ingestion buffers an
// account's entire order window in memory, and this process gets a 384M heap.
const CONCURRENCY = Math.max(1, parseInt(process.env.REVIEW_WORKER_CONCURRENCY || '3', 10) || 3);
const DELAY_BETWEEN_BATCHES_MS = Math.max(0, parseInt(process.env.REVIEW_WORKER_BATCH_DELAY_MS || '1000', 10) || 0);

// Deliberately above the ~317 account-marketplaces in production: this is a runaway
// guard, not a throttle. If it ever bites, the summary says so.
const MAX_ACCOUNTS_PER_TICK = Math.max(1, parseInt(process.env.REVIEW_WORKER_MAX_ACCOUNTS_PER_TICK || '1000', 10) || 1000);

// Stop STARTING new accounts past this point. Legacy (non-streaming) ingestion has no
// internal bound at all — it walks every order with a 2s sleep each — which is how one
// account reached 23.8h inside calc_review. An account already running is not interrupted;
// this only stops the sweep from digging deeper, and reports that it stopped.
const TICK_BUDGET_MS = Math.max(60_000, parseInt(process.env.REVIEW_WORKER_TICK_BUDGET_MS || String(20 * 60 * 60 * 1000), 10) || 20 * 60 * 60 * 1000);

// Just under 24h so a tick that dies mid-run cannot hold the lock into a second day. The
// date-bucketed key already covers that; this is the belt to its braces.
const LOCK_TTL_MS = 23 * 60 * 60 * 1000;

const FATAL_LOG_PATH = path.join(__dirname, '..', '..', '..', 'logs', 'review-worker-fatal.log');
let fatalReasonRecorded = false;

/**
 * Record a fatal reason somewhere it cannot be lost. Must never throw — it runs on the
 * way out. Logger's file mirror is off under NODE_ENV=production, which is how `worker`
 * managed to exit ~340 times in 46 hours without recording a single reason (worker.js:60).
 */
function recordFatal(kind, detail) {
    fatalReasonRecorded = true;
    const text = detail && detail.stack ? detail.stack : String(detail);
    try {
        fs.mkdirSync(path.dirname(FATAL_LOG_PATH), { recursive: true });
        fs.appendFileSync(FATAL_LOG_PATH, `[${new Date().toISOString()}] [${HOLDER}] ${kind}: ${text}\n`);
    } catch (_) { /* a failure here must not mask the original fault */ }
    try { logger.error(`[ReviewWorker] ${kind}`, { error: text }); } catch (_) {}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `${userId}|${country}|${region}` — one seller can list a marketplace more than once. */
const tripleKey = (t) => `${t.userId}|${t.country}|${t.region}`;

// ---------------------------------------------------------------------------
// Account selection
// ---------------------------------------------------------------------------

/**
 * The accounts the daily pipeline syncs: verified, and either PRO (which includes trial)
 * or an agency client. Mirrors UserSchedulingService.getUsersNeedingDailyUpdate and
 * freshnessSweeper.getActiveUserIdSet — minus their due-hour / not-yet-today conditions,
 * which are pipeline scheduling mechanics rather than eligibility.
 *
 * Returns null when the filter cannot be trusted (query failed, or matched nobody).
 *
 * FAIL-SAFE DIRECTION. The sibling sweeps read null as "no filter, process everyone" so a
 * query blip cannot stop them. This one inverts it, as sweepStalledPipelines does: here
 * "process everyone" means walking Amazon orders for every churned account and sending
 * review requests on their behalf. Skipping a day is recoverable; that is not.
 */
async function getActiveUserIdSet() {
    const User = require('../../models/user-auth/userModel.js');
    try {
        const users = await User.find(
            { isVerified: true, $or: [{ packageType: 'PRO' }, { isAgencyClient: true }] },
            { _id: 1 }
        ).lean();
        if (!users || users.length === 0) {
            logger.error('[ReviewWorker] Active-user filter matched 0 users — skipping this tick rather than processing everyone.');
            return null;
        }
        return new Set(users.map((u) => u._id.toString()));
    } catch (err) {
        logger.error('[ReviewWorker] Active-user filter query failed — skipping this tick', { error: err?.message });
        return null;
    }
}

/**
 * Build the (userId, country, region) triples to process.
 *
 * The token test mirrors the fallback chain both processors use
 * (scheduledReviewIngestionProcessor.js:75-78) — an account without one bails inside the
 * processor anyway, so filtering here just avoids the round trip. Only SP-API matters:
 * neither service touches the Ads API.
 *
 * `spRefreshToken` and `refreshToken` are carried over from that chain even though
 * sellerCentralModel declares neither (only `spiRefreshToken`, at :67) and the schema is
 * strict, so nothing can ever have persisted them. They cost nothing, and copying the
 * chain verbatim is what guarantees this filter can never be STRICTER than the processor's
 * own check — an account this skips is an account that would have bailed anyway.
 */
async function collectAccounts() {
    const Seller = require('../../models/user-auth/sellerCentralModel.js');

    const activeUserIds = await getActiveUserIdSet();
    if (!activeUserIds) return null;

    // Project only the sub-fields read here. The seller document embeds large
    // products[]/TotatProducts[] arrays that would otherwise be pulled for every account.
    const sellers = await Seller.find(
        { User: { $in: Array.from(activeUserIds) } },
        {
            User: 1,
            'sellerAccount.country': 1,
            'sellerAccount.region': 1,
            'sellerAccount.spiRefreshToken': 1,
            'sellerAccount.spRefreshToken': 1,
            'sellerAccount.refreshToken': 1
        }
    ).lean();

    const seen = new Set();
    const triples = [];
    let skippedNoToken = 0;

    for (const seller of sellers) {
        const userId = seller?.User ? String(seller.User) : null;
        if (!userId || !Array.isArray(seller.sellerAccount)) continue;
        for (const acct of seller.sellerAccount) {
            if (!acct || !acct.country || !acct.region) continue;
            if (!(acct.spiRefreshToken || acct.spRefreshToken || acct.refreshToken)) {
                skippedNoToken++;
                continue;
            }
            const triple = { userId, country: acct.country, region: acct.region };
            const key = tripleKey(triple);
            if (seen.has(key)) continue;
            seen.add(key);
            triples.push(triple);
        }
    }

    logger.info('[ReviewWorker] Account selection complete', {
        activeUsers: activeUserIds.size,
        sellers: sellers.length,
        accounts: triples.length,
        skippedNoToken
    });
    return triples;
}

// ---------------------------------------------------------------------------
// Per account
// ---------------------------------------------------------------------------

/**
 * Ingest (on ingestion days) then send, for one account. Never throws.
 *
 * The order is not a same-run correctness requirement — ingestion's window is yesterday
 * minus 15 days while the sender only touches orders 5 to 30 days old, so anything the
 * sender can act on today was ingested days ago (orders.js:72-79). It matters on a cold
 * start, where the two windows overlap in the 5-15 day band and sending straight after
 * ingesting gets a new account's first requests out a run earlier. Note the pipeline never
 * actually did this: it created both promises in the same loop pass and only ordered the
 * awaits (ScheduledIntegration.js:1145-1147), so batches 6 and 7 ran concurrently despite
 * the comments claiming otherwise.
 */
async function processAccount({ userId, country, region }, { runIngestion }) {
    const { scheduledReviewIngestion } = require('../review/scheduledReviewIngestionProcessor.js');
    const { scheduledReviewRequestSender } = require('../review/scheduledReviewRequestProcessor.js');

    const outcome = { userId, country, region, ingest: null, send: null };

    if (runIngestion) {
        try {
            const res = await scheduledReviewIngestion(userId, country, region, 'review-worker');
            outcome.ingest = { success: !!res?.success, error: res?.error || null, authDenied: !!res?.authDenied };
        } catch (err) {
            outcome.ingest = { success: false, error: err?.message || 'ingestion threw', authDenied: false };
            logger.warn('[ReviewWorker] Ingestion failed (non-fatal)', { userId, country, region, error: err?.message });
        }
    }

    // Runs even when ingestion failed. The sender works off orders already persisted by
    // earlier runs; skipping it here would punish a backlog for one bad Amazon call.
    try {
        const res = await scheduledReviewRequestSender(userId, country, region, 'review-worker');
        outcome.send = { success: !!res?.success, error: res?.error || null, skipped: !!res?.data?.skipped };
    } catch (err) {
        outcome.send = { success: false, error: err?.message || 'sender threw', skipped: false };
        logger.warn('[ReviewWorker] Review request sending failed (non-fatal)', { userId, country, region, error: err?.message });
    }

    return outcome;
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

/**
 * One sweep over every eligible account. Never throws; returns a summary.
 *
 * @param {Object} [opts]
 * @param {number} [opts.dayOfWeek] - UTC day, injectable for tests.
 */
async function runReviewTick(opts = {}) {
    const startedAt = Date.now();
    const dayOfWeek = typeof opts.dayOfWeek === 'number' ? opts.dayOfWeek : new Date().getUTCDay();
    const runIngestion = INGEST_DAYS.has(dayOfWeek);

    const summary = {
        enabled: ENABLED,
        dayOfWeek,
        runIngestion,
        accounts: 0,
        processed: 0,
        ingestOk: 0,
        ingestFailed: 0,
        sendOk: 0,
        sendFailed: 0,
        sendSkippedLitePlan: 0,
        skippedInactive: false,
        cappedByTick: false,
        outOfBudget: false,
        errors: 0,
        durationMs: 0
    };

    const accounts = await collectAccounts();
    if (accounts === null) {
        summary.skippedInactive = true;
        summary.durationMs = Date.now() - startedAt;
        return summary;
    }

    summary.accounts = accounts.length;

    let work = accounts;
    if (work.length > MAX_ACCOUNTS_PER_TICK) {
        summary.cappedByTick = true;
        work = work.slice(0, MAX_ACCOUNTS_PER_TICK);
        logger.warn(`[ReviewWorker] Account count (${accounts.length}) exceeds the per-tick cap (${MAX_ACCOUNTS_PER_TICK}); the rest are deferred to tomorrow — this tick did NOT cover everything.`);
    }

    // Flag off: say exactly what would have happened and touch nothing. The pipeline is
    // still doing this work, so anything beyond logging here is a double-run.
    if (!ENABLED) {
        logger.info('[ReviewWorker] DRY RUN (REVIEW_WORKER_ENABLED is not "true") — no processor will be called', {
            dayOfWeek,
            wouldIngest: runIngestion,
            wouldSend: true,
            accounts: work.length,
            sample: work.slice(0, 20).map(tripleKey)
        });
        summary.durationMs = Date.now() - startedAt;
        return summary;
    }

    for (let i = 0; i < work.length; i += CONCURRENCY) {
        if (Date.now() - startedAt > TICK_BUDGET_MS) {
            summary.outOfBudget = true;
            logger.warn(`[ReviewWorker] Tick budget (${TICK_BUDGET_MS}ms) exhausted after ${summary.processed}/${work.length} accounts; the rest are deferred to tomorrow.`);
            break;
        }

        const batch = work.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
            batch.map((triple) => processAccount(triple, { runIngestion }))
        );

        for (const r of settled) {
            summary.processed++;
            if (r.status === 'rejected') {
                // processAccount catches everything, so this is a defect rather than an
                // account problem. Counted separately so it cannot hide among Amazon errors.
                summary.errors++;
                logger.error('[ReviewWorker] processAccount rejected — this should not happen', { error: r.reason?.message, stack: r.reason?.stack });
                continue;
            }
            const o = r.value;
            if (o.ingest) { o.ingest.success ? summary.ingestOk++ : summary.ingestFailed++; }
            if (o.send) {
                if (o.send.skipped) summary.sendSkippedLitePlan++;
                else if (o.send.success) summary.sendOk++;
                else summary.sendFailed++;
            }
        }

        if (DELAY_BETWEEN_BATCHES_MS && i + CONCURRENCY < work.length) {
            await sleep(DELAY_BETWEEN_BATCHES_MS);
        }
    }

    summary.durationMs = Date.now() - startedAt;
    return summary;
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

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
        // Verify we own it — concurrent upserts collide on the unique index and the loser
        // ends up reading the winner's holder.
        const current = await OrchestrationCronLock.findOne({ lockKey }).lean();
        return !!current && current.holder === HOLDER;
    } catch (error) {
        if (error && (error.code === 11000 || error.code === 11001)) return false;
        logger.error('[ReviewWorker] Lock acquisition error', { lockKey, error: error?.message });
        return false;
    }
}

async function releaseLock(lockKey) {
    const OrchestrationCronLock = require('../../models/system/OrchestrationCronLockModel.js');
    try {
        await OrchestrationCronLock.updateOne({ lockKey, holder: HOLDER }, { $set: { lockedUntil: new Date(0) } });
    } catch (error) {
        logger.warn('[ReviewWorker] Lock release error', { lockKey, error: error?.message });
    }
}

/** Date-bucketed so a tick that dies without releasing cannot swallow the next day. */
function lockKeyForToday(now = new Date()) {
    return `review-worker-${now.toISOString().slice(0, 10)}`;
}

function setupReviewCron() {
    const cron = require('node-cron');

    const job = cron.schedule(REVIEW_WORKER_CRON, async () => {
        const lockKey = lockKeyForToday();
        const acquired = await acquireLock(lockKey);
        if (!acquired) {
            logger.info('[ReviewWorker] Another instance holds today\'s lock — skipping tick', { lockKey });
            return;
        }
        try {
            logger.info('[ReviewWorker] Tick starting (lock acquired)', { lockKey, enabled: ENABLED });
            const summary = await runReviewTick();
            logger.info('[ReviewWorker] Tick complete', summary);
        } catch (error) {
            logger.error('[ReviewWorker] Tick failed', { error: error?.message, stack: error?.stack });
        } finally {
            await releaseLock(lockKey);
        }
    }, {
        scheduled: false,
        timezone: process.env.TIMEZONE || 'UTC'
    });

    job.start();
    logger.info(`[ReviewWorker] Cron scheduled (${REVIEW_WORKER_CRON}, lock-guarded)`, {
        enabled: ENABLED,
        concurrency: CONCURRENCY,
        ingestDays: Array.from(INGEST_DAYS)
    });
    return job;
}

// Registered at MODULE TOP LEVEL on purpose, so a failure during startup is covered too.
// Unlike alertsWorker these exit rather than swallow: a tick holds a Mongo lock and talks
// to Amazon on a seller's behalf, so continuing in an unknown state is worse than a PM2
// restart, which will pick up cleanly at the next cron.
process.on('uncaughtException', (err) => {
    recordFatal('FATAL uncaughtException', err);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 250);
});
process.on('unhandledRejection', (reason) => {
    recordFatal('FATAL unhandledRejection', reason instanceof Error ? reason : new Error(`Non-Error rejection: ${String(reason)}`));
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 250);
});
process.on('exit', (code) => {
    if (code === 0 || fatalReasonRecorded) return;
    recordFatal('UNEXPLAINED exit', `code=${code}, uptime=${(process.uptime() / 60).toFixed(1)}min`);
});

async function start() {
    logger.info(`[ReviewWorker] Starting (holder=${HOLDER}, enabled=${ENABLED})`);

    try {
        await dbConnect();
        logger.info('[ReviewWorker] MongoDB connected');
    } catch (error) {
        recordFatal('MongoDB connection failed', error);
        process.exit(1);
    }

    const cronJob = setupReviewCron();
    logger.info('[ReviewWorker] Started successfully — waiting for cron to fire');

    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`[ReviewWorker] Received ${signal}, exiting`);
        // Stop the cron so a tick cannot start during shutdown. An IN-FLIGHT tick is left
        // to be cut off — its lock expires on TTL, and both services are idempotent
        // (orders upsert on {marketplaceId, amazonOrderId}; an order leaves the
        // "not_requested" set the moment it is stamped, so nothing is re-solicited).
        try { cronJob.stop(); } catch (_) {}
        setTimeout(() => process.exit(0), 1000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
    start().catch((error) => {
        recordFatal('Fatal start error', error);
        process.exit(1);
    });
}

module.exports = {
    runReviewTick,
    processAccount,
    collectAccounts,
    getActiveUserIdSet,
    lockKeyForToday,
    acquireLock,
    releaseLock,
    INGEST_DAYS,
    REVIEW_WORKER_CRON
};

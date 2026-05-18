/**
 * cronProducerStandalone.js
 *
 * Standalone PM2 process that owns ALL cron-based scheduling for SellerQI.
 *
 * Why this exists
 *   - The API server (`api-server`) historically also ran the hourly cron
 *     producer + the JobScheduler cron jobs (cache cleanup, health check,
 *     weekly email, trial reminders, daily-update enqueue, email reminder).
 *   - That coupling meant: (1) restarting the API stopped job production,
 *     (2) the API couldn't safely scale to multiple instances (each one
 *     would duplicate every cron tick), and (3) heavy CPU/memory on the
 *     API affected scheduling and vice-versa.
 *
 *   This process takes ownership of those crons. The API server becomes
 *   pure HTTP (`CRON_PRODUCER_STANDALONE=true` in its env).
 *
 * What it runs
 *   - `cronProducer.setupDailyUpdateCron`  → hourly: enqueue users → BullMQ
 *   - `jobScheduler.initialize`            → cache cleanup, health check,
 *                                             weekly email, trial reminders
 *   - `initializeEmailReminderJob`         → 48-hour reactivation emails
 *
 * Safety
 *   - Wraps the hourly daily-update tick with an `OrchestrationCronLock`
 *     (Mongo) distributed lock so even if two cron-producer instances are
 *     accidentally running, only one ticks per hour. This is purely defensive;
 *     the PM2 config keeps this at `instances: 1`.
 *   - Uses deterministic BullMQ job IDs (already implemented in
 *     `enqueueScheduledAccountJob`) so duplicate enqueues are no-ops.
 *
 * Rollback
 *   - Don't start the `cron-producer` PM2 app, OR set
 *     `CRON_PRODUCER_STANDALONE=false` on the API server. The API will
 *     resume running cron jobs in-process exactly as before.
 *
 * Run via PM2 (see ecosystem.config.js → `cron-producer` app):
 *   pm2 start ecosystem.config.js --only cron-producer
 */

require('dotenv').config();

const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');
const { connectRedis } = require('../../config/redisConn.js');
const config = require('../../config/config.js');

const HOLDER = `cron-producer-${process.pid}-${Date.now()}`;
const ENABLED = process.env.CRON_PRODUCER_DISABLED !== 'true';

/**
 * Best-effort distributed lock for the hourly daily-update tick.
 * Uses `OrchestrationCronLockModel` (TTL via `lockedUntil`).
 *
 * Returns true if the caller acquired the lock for this tick; false if
 * another instance currently holds it.
 */
async function acquireHourlyTickLock(lockKey, ttlMs) {
    const OrchestrationCronLock = require('../../models/system/OrchestrationCronLockModel.js');
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + ttlMs);
    try {
        // Upsert: only succeeds when the existing doc is expired (or missing)
        await OrchestrationCronLock.findOneAndUpdate(
            {
                lockKey,
                $or: [
                    { lockedUntil: { $lte: now } },
                    { lockedUntil: { $exists: false } }
                ]
            },
            { $set: { lockedUntil, holder: HOLDER } },
            { upsert: true, new: true }
        );
        // Verify we own the lock (concurrent upserts will collide on the unique
        // index — the loser ends up with `holder` set by the winner)
        const current = await OrchestrationCronLock.findOne({ lockKey }).lean();
        return !!current && current.holder === HOLDER;
    } catch (error) {
        // E11000 (duplicate key) means another instance grabbed it first.
        if (error && (error.code === 11000 || error.code === 11001)) {
            return false;
        }
        logger.error('[CronProducerStandalone] Lock acquisition error', { lockKey, error: error?.message });
        return false;
    }
}

async function releaseHourlyTickLock(lockKey) {
    const OrchestrationCronLock = require('../../models/system/OrchestrationCronLockModel.js');
    try {
        await OrchestrationCronLock.updateOne(
            { lockKey, holder: HOLDER },
            { $set: { lockedUntil: new Date(0) } }
        );
    } catch (error) {
        logger.warn('[CronProducerStandalone] Lock release error', { lockKey, error: error?.message });
    }
}

/**
 * Wrap the existing `setupDailyUpdateCron` cron callback with a distributed lock.
 * We re-implement the scheduling here (rather than calling `setupDailyUpdateCron`)
 * so we can wrap the tick body with the lock without touching the original module.
 */
function setupDailyUpdateCronLocked() {
    const cron = require('node-cron');
    const { enqueueUsersForDailyUpdate } = require('./cronProducer.js');

    const job = cron.schedule('0 * * * *', async () => {
        const lockKey = `daily-update-cron-${new Date().getUTCHours()}`;
        const TICK_TTL_MS = 55 * 60 * 1000; // 55 min — lock expires before next tick
        const acquired = await acquireHourlyTickLock(lockKey, TICK_TTL_MS);
        if (!acquired) {
            logger.info(`[CronProducerStandalone] Another instance holds ${lockKey} this hour — skipping tick`);
            return;
        }
        try {
            logger.info('[CronProducerStandalone] Hourly daily-update enqueue tick (lock acquired)');
            const result = await enqueueUsersForDailyUpdate();
            logger.info('[CronProducerStandalone] Hourly tick complete', {
                accountsEnqueued: result?.accountsEnqueued || 0,
                accountsSkipped: result?.accountsSkipped || 0,
                accountsFailed: result?.accountsFailed || 0
            });
        } catch (error) {
            logger.error('[CronProducerStandalone] Hourly tick failed', { error: error?.message });
        } finally {
            await releaseHourlyTickLock(lockKey);
        }
    }, {
        scheduled: false,
        timezone: process.env.TIMEZONE || 'UTC'
    });

    job.start();
    logger.info('[CronProducerStandalone] Daily-update cron scheduled (hourly, lock-guarded)');
    return job;
}

async function start() {
    if (!ENABLED) {
        logger.warn('[CronProducerStandalone] Disabled via CRON_PRODUCER_DISABLED=true — exiting');
        process.exit(0);
        return;
    }

    logger.info(`[CronProducerStandalone] Starting (holder=${HOLDER})`);

    try {
        await dbConnect();
        logger.info('[CronProducerStandalone] MongoDB connected');
    } catch (error) {
        logger.error('[CronProducerStandalone] MongoDB connection failed', { error: error?.message });
        process.exit(1);
    }

    try {
        await connectRedis();
        logger.info('[CronProducerStandalone] Redis connected (cache)');
    } catch (error) {
        // Cache Redis is non-fatal for cron production (queue Redis is what matters)
        logger.warn('[CronProducerStandalone] Cache Redis connect failed (continuing)', { error: error?.message });
    }

    // Daily-update enqueue cron (lock-guarded version)
    if (config.backgroundJobs?.enabled !== false && config.backgroundJobs?.jobs?.dailyUpdates !== false) {
        setupDailyUpdateCronLocked();
    } else {
        logger.warn('[CronProducerStandalone] Daily-update cron disabled by config');
    }

    // JobScheduler crons: cache cleanup, health check, weekly email, trial reminders.
    // These were previously launched from api/app.js — we now own them here.
    try {
        const { jobScheduler } = require('./JobScheduler.js');
        await jobScheduler.initialize();
        logger.info('[CronProducerStandalone] JobScheduler initialized');
    } catch (error) {
        logger.error('[CronProducerStandalone] JobScheduler initialization failed', { error: error?.message });
    }

    // 48-hour email reminder cron
    try {
        const { initializeEmailReminderJob } = require('./sendEmailAfter48Hrs.js');
        const ok = initializeEmailReminderJob();
        logger.info(`[CronProducerStandalone] Email reminder cron ${ok ? 'initialized' : 'failed to initialize'}`);
    } catch (error) {
        logger.error('[CronProducerStandalone] Email reminder init failed', { error: error?.message });
    }

    logger.info('[CronProducerStandalone] Started successfully — running all cron schedules');

    // Graceful shutdown: stop accepting new cron ticks, let in-flight work finish.
    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`[CronProducerStandalone] Received ${signal}, exiting`);
        // node-cron jobs auto-stop on process exit; nothing to manually drain.
        setTimeout(() => process.exit(0), 1000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => {
    logger.error('[CronProducerStandalone] Fatal start error', { error: error?.message, stack: error?.stack });
    process.exit(1);
});

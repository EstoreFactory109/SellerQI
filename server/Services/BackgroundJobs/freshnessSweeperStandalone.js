/**
 * freshnessSweeperStandalone.js
 *
 * Standalone PM2 process that periodically scans for accounts with missing
 * past PPC days and enqueues `sched_ads_catchup` BullMQ jobs to fill them.
 *
 * Why standalone (not bolted onto cron-producer)
 *   - Different cadence (every 3h vs hourly) — keeping schedules together
 *     would clutter cron-producer.
 *   - Independent failure surface — if the sweeper crashes, the daily
 *     ingest pipeline is unaffected.
 *   - Easy on/off via PM2 without touching anything else.
 *
 * What it does
 *   - Every SWEEP_INTERVAL_CRON, calls `freshnessSweeper.sweep()`.
 *   - That function scans each ads-connected account for missing PPCMetrics
 *     days in the last 7 days and enqueues one catch-up job per missing date.
 *   - Bounded by MAX_ENQUEUES_PER_TICK inside `freshnessSweeper`.
 *
 * Safety
 *   - Wraps each tick in an `OrchestrationCronLock` (same pattern as
 *     `cronProducerStandalone.js`) so two sweeper instances can run safely.
 *   - Catch-up jobs use deterministic jobIds (BullMQ dedup) — re-enqueue is
 *     a no-op while a previous attempt is in flight or recently failed.
 *
 * Rollback
 *   - Don't start the `freshness-sweeper` PM2 app, OR set
 *     `FRESHNESS_SWEEPER_DISABLED=true` in env. Nothing else changes.
 *
 * Run via PM2:
 *   pm2 start ecosystem.config.js --only freshness-sweeper
 */

require('dotenv').config();

const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');
const { connectRedis } = require('../../config/redisConn.js');

const HOLDER = `freshness-sweeper-${process.pid}-${Date.now()}`;
const ENABLED = process.env.FRESHNESS_SWEEPER_DISABLED !== 'true';

// Run every 3 hours by default. Tunable per environment.
const SWEEP_INTERVAL_CRON = process.env.FRESHNESS_SWEEPER_CRON || '0 */3 * * *';

// The deep re-sync (30-day cancellation safety net) is HEAVY — it re-fetches a
// 30-day window for every account. It only needs to run ONCE PER DAY. The sweep
// cron ticks every 3h, so we gate the deep re-sync to a single UTC hour rather
// than relying on BullMQ job-existence dedup (which is defeated when completed
// catch-up jobs are evicted by removeOnComplete before the next tick — that bug
// caused it to re-run ~8×/day). The ads + finance-reconciliation sweeps still
// run EVERY tick; only the deep re-sync is gated. Default 0 (the 00:00 UTC tick).
const DEEP_RESYNC_HOUR = parseInt(process.env.FRESHNESS_DEEP_RESYNC_HOUR || '0', 10);

// Lock TTL — slightly shorter than the cron interval so a missed release
// auto-expires before the next tick.
const TICK_TTL_MS = 2 * 60 * 60 * 1000 + 50 * 60 * 1000; // 2h50m

async function acquireSweepLock(lockKey) {
    const OrchestrationCronLock = require('../../models/system/OrchestrationCronLockModel.js');
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + TICK_TTL_MS);
    try {
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
        const current = await OrchestrationCronLock.findOne({ lockKey }).lean();
        return !!current && current.holder === HOLDER;
    } catch (error) {
        if (error && (error.code === 11000 || error.code === 11001)) {
            return false;
        }
        logger.error('[FreshnessSweeperStandalone] Lock acquisition error', { lockKey, error: error?.message });
        return false;
    }
}

async function releaseSweepLock(lockKey) {
    const OrchestrationCronLock = require('../../models/system/OrchestrationCronLockModel.js');
    try {
        await OrchestrationCronLock.updateOne(
            { lockKey, holder: HOLDER },
            { $set: { lockedUntil: new Date(0) } }
        );
    } catch (error) {
        logger.warn('[FreshnessSweeperStandalone] Lock release error', { lockKey, error: error?.message });
    }
}

function setupSweeperCron() {
    const cron = require('node-cron');
    const { sweep, sweepFinance, sweepFinanceDeepResync, sweepStaleSessions } = require('./freshnessSweeper.js');

    const job = cron.schedule(SWEEP_INTERVAL_CRON, async () => {
        const lockKey = 'freshness-sweeper-tick';
        const acquired = await acquireSweepLock(lockKey);
        if (!acquired) {
            logger.info('[FreshnessSweeperStandalone] Another instance holds the lock — skipping tick');
            return;
        }
        try {
            logger.info('[FreshnessSweeperStandalone] Sweep tick starting (lock acquired)');
            const adsSummary = await sweep();
            logger.info('[FreshnessSweeperStandalone] Ads sweep complete', adsSummary);
            // Finance reconciliation runs in the same tick. Isolated in its own
            // try so an ads-sweep issue can't block finance and vice-versa.
            try {
                const finSummary = await sweepFinance();
                logger.info('[FreshnessSweeperStandalone] Finance sweep complete', finSummary);
            } catch (finErr) {
                logger.error('[FreshnessSweeperStandalone] Finance sweep failed', { error: finErr?.message, stack: finErr?.stack });
            }
            // Orphaned logging-session sweep — closes 'in_progress' sessions left
            // behind by crashed/stalled runs so the frontend doesn't show a
            // perpetual "in progress" spinner. Bounded per tick; isolated try so
            // it can't block (or be blocked by) the ads/finance sweeps.
            try {
                const sessionSummary = await sweepStaleSessions();
                logger.info('[FreshnessSweeperStandalone] Stale-session sweep complete', sessionSummary);
            } catch (sessErr) {
                logger.error('[FreshnessSweeperStandalone] Stale-session sweep failed', { error: sessErr?.message, stack: sessErr?.stack });
            }
            // Deep re-sync (long-tail cancellations) — gated to ONE tick per day
            // (DEEP_RESYNC_HOUR) because it re-fetches a 30-day window per account
            // and only needs to run daily. The date-stamped jobId inside the sweep
            // is kept as a secondary guard, but the hour gate is the deterministic
            // primary control (independent of BullMQ job retention). Isolated try
            // so it can't block the other two sweeps.
            const nowHourUtc = new Date().getUTCHours();
            if (nowHourUtc === DEEP_RESYNC_HOUR) {
                try {
                    const deepSummary = await sweepFinanceDeepResync();
                    logger.info('[FreshnessSweeperStandalone] Finance deep re-sync complete', deepSummary);
                } catch (deepErr) {
                    logger.error('[FreshnessSweeperStandalone] Finance deep re-sync failed', { error: deepErr?.message, stack: deepErr?.stack });
                }
            } else {
                logger.info(`[FreshnessSweeperStandalone] Skipping deep re-sync this tick (runs at ${DEEP_RESYNC_HOUR}:00 UTC; now ${nowHourUtc}:00)`);
            }
        } catch (error) {
            logger.error('[FreshnessSweeperStandalone] Sweep tick failed', { error: error?.message, stack: error?.stack });
        } finally {
            await releaseSweepLock(lockKey);
        }
    }, {
        scheduled: false,
        timezone: process.env.TIMEZONE || 'UTC'
    });

    job.start();
    logger.info(`[FreshnessSweeperStandalone] Sweep cron scheduled (${SWEEP_INTERVAL_CRON}, lock-guarded)`);
    return job;
}

async function start() {
    if (!ENABLED) {
        logger.warn('[FreshnessSweeperStandalone] Disabled via FRESHNESS_SWEEPER_DISABLED=true — exiting');
        process.exit(0);
        return;
    }

    logger.info(`[FreshnessSweeperStandalone] Starting (holder=${HOLDER})`);

    try {
        await dbConnect();
        logger.info('[FreshnessSweeperStandalone] MongoDB connected');
    } catch (error) {
        logger.error('[FreshnessSweeperStandalone] MongoDB connection failed', { error: error?.message });
        process.exit(1);
    }

    try {
        await connectRedis();
        logger.info('[FreshnessSweeperStandalone] Redis connected (cache)');
    } catch (error) {
        // Cache Redis is non-fatal for the sweeper itself (queue Redis matters).
        logger.warn('[FreshnessSweeperStandalone] Cache Redis connect failed (continuing)', { error: error?.message });
    }

    setupSweeperCron();
    logger.info('[FreshnessSweeperStandalone] Started successfully');

    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`[FreshnessSweeperStandalone] Received ${signal}, exiting`);
        setTimeout(() => process.exit(0), 1000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => {
    logger.error('[FreshnessSweeperStandalone] Fatal start error', { error: error?.message, stack: error?.stack });
    process.exit(1);
});

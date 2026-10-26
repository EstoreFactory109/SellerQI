/**
 * fxRatesStandalone.js
 *
 * Daily job that stores currency exchange rates for the combined (all-marketplaces) Dashboard.
 * See Services/Finance/FxService.js for the sources and the "never assume 1:1" rule.
 *
 * SCHEDULE
 *   16:30 UTC on weekdays — the ECB publishes its reference rates around 16:00 CET.
 *   20:00 UTC on weekdays — a retry that only fetches if today's rates are still missing.
 * Weekends need nothing: the ECB publishes no rates, and FxService serves Friday's.
 *
 * SAFETY (mirrors zohoTaskSyncStandalone.js)
 *   - One OrchestrationCronLock per slot per UTC day, so two hosts cannot both fetch.
 *   - FX_RATES_ENABLED is OFF by default. While off, the tick logs what it would fetch and
 *     writes nothing. (FxService still fetches once by itself if the collection is empty and
 *     a combined Dashboard is requested — that path is only reachable once the feature is on.)
 *
 * WHERE THIS RUNS
 * Registered by cronProducerStandalone.js, like the Zoho and Gmail jobs, because the PM2
 * ecosystem memory budget has no room for another app (see the Zoho file's header).
 */

require('dotenv').config();

const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');

const HOLDER = `fx-rates-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const ENABLED = process.env.FX_RATES_ENABLED === 'true';
const CRON_MAIN = process.env.FX_RATES_CRON || '30 16 * * 1-5';
const CRON_RETRY = process.env.FX_RATES_RETRY_CRON || '0 20 * * 1-5';
const LOCK_TTL_MS = 60 * 60 * 1000;

async function acquireLock(lockKey) {
    const OrchestrationCronLock = require('../../models/system/OrchestrationCronLockModel.js');
    const now = new Date();
    try {
        await OrchestrationCronLock.findOneAndUpdate(
            { lockKey, $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }] },
            { $set: { lockedUntil: new Date(now.getTime() + LOCK_TTL_MS), holder: HOLDER } },
            { upsert: true, new: true }
        );
        const current = await OrchestrationCronLock.findOne({ lockKey }).lean();
        return !!current && current.holder === HOLDER;
    } catch (error) {
        if (error && (error.code === 11000 || error.code === 11001)) return false;
        logger.error('[FxRates] Lock acquisition error', { lockKey, error: error?.message });
        return false;
    }
}

async function releaseLock(lockKey) {
    const OrchestrationCronLock = require('../../models/system/OrchestrationCronLockModel.js');
    try {
        await OrchestrationCronLock.updateOne({ lockKey, holder: HOLDER }, { $set: { lockedUntil: new Date(0) } });
    } catch (error) {
        logger.warn('[FxRates] Lock release error', { lockKey, error: error?.message });
    }
}

/**
 * One fetch. `onlyIfMissing` is the retry slot: it does nothing when today's rates are stored.
 * Safe to call directly from a script.
 */
async function runFxTick({ onlyIfMissing = false } = {}) {
    const FxRate = require('../../models/system/FxRateModel.js');
    const today = new Date().toISOString().slice(0, 10);

    if (onlyIfMissing && await FxRate.exists({ date: today })) {
        return { skipped: 'already-have-today', date: today };
    }
    if (!ENABLED) {
        logger.info('[FxRates] DISABLED — would fetch ECB + fallback rates and store them', { date: today });
        return { enabled: false, date: today };
    }

    const { fetchAndStoreDailyRates } = require('../Finance/FxService.js');
    const table = await fetchAndStoreDailyRates();
    return { enabled: true, date: table.date, currencies: Object.keys(table.rates).length, missing: table.missing };
}

function schedule(cronExpr, slot, opts) {
    const cron = require('node-cron');
    const job = cron.schedule(cronExpr, async () => {
        const lockKey = `fx-rates-${new Date().toISOString().slice(0, 10)}-${slot}`;
        if (!(await acquireLock(lockKey))) {
            logger.info('[FxRates] Another instance holds this slot — skipping', { lockKey });
            return;
        }
        try {
            logger.info('[FxRates] Tick complete', await runFxTick(opts));
        } catch (error) {
            logger.error('[FxRates] Tick failed', { slot, error: error?.message });
        } finally {
            await releaseLock(lockKey);
        }
    }, { scheduled: false, timezone: 'UTC' });
    job.start();
    return job;
}

function setupCron() {
    const jobs = [
        schedule(CRON_MAIN, 'main', { onlyIfMissing: false }),
        schedule(CRON_RETRY, 'retry', { onlyIfMissing: true }),
    ];
    logger.info(`[FxRates] Crons scheduled (${CRON_MAIN}, retry ${CRON_RETRY})`, { enabled: ENABLED });
    return jobs;
}

async function start() {
    try {
        await dbConnect();
        setupCron();
        if (process.env.FX_RATES_RUN_ON_BOOT === 'true') {
            logger.info('[FxRates] RUN_ON_BOOT set — running one tick now', await runFxTick());
        }
    } catch (error) {
        logger.error('[FxRates] Failed to start', { error: error?.message });
        process.exit(1);
    }
}

if (require.main === module) {
    start();
}

module.exports = { setupCron, runFxTick };

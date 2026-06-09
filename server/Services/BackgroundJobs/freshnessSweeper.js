/**
 * freshnessSweeper.js
 *
 * Ads-only catch-up sweeper.
 *
 * The daily ads phase (`sched_ads`) only fetches yesterday's PPC data. Unlike
 * finance (which incremental-fills up to a 7-day gap via FinanceSyncLog), ads
 * has no built-in gap recovery — a day that fails past the 4-attempt cap is
 * permanently missing in PPCMetrics until something fills it.
 *
 * This sweeper bridges that gap:
 *
 *   For each connected account (Seller with valid Ads refreshToken):
 *     - Look at PPCMetrics rows for the last ADS_LOOKBACK_DAYS days.
 *     - For each missing date (excluding yesterday; the daily handles that):
 *         - Enqueue a `sched_ads_catchup` BullMQ job for that single date.
 *
 * Internal ads logic guarantee:
 *   This module does NOT modify GetPPCMetrics.js or any ads service file.
 *   It only enqueues jobs that route through worker.js → ScheduledIntegration.
 *   executeAdsCatchupPhase(), which invokes the existing functions with custom
 *   per-day date arguments.
 *
 * Dedup / quota safety:
 *   - BullMQ `jobId` is deterministic per (account, date), so the same gap is
 *     never enqueued twice.
 *   - Per-tick cap (MAX_ENQUEUES_PER_TICK) protects against floods.
 *   - Yesterday is excluded — the daily ads phase owns that date.
 *
 * Called by `freshnessSweeperStandalone.js` (PM2 app) on a cron schedule.
 */

const Seller = require('../../models/user-auth/sellerCentralModel.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const FinanceSyncLog = require('../../models/finance/FinanceSyncLogModel.js');
const DailySkuFinance = require('../../models/finance/DailySkuFinanceModel.js');
const { getQueue } = require('./queue.js');
const scheduledPhases = require('./scheduledPhases.js');
const logger = require('../../utils/Logger.js');

// How far back to scan for missing days.
const ADS_LOOKBACK_DAYS = 7;

// Finance reconciliation: how far back to scan for missing/failed/stale days.
const FINANCE_LOOKBACK_DAYS = 30;
// Provisional days younger than this are left to the daily incremental flow
// (it re-fetches them every run). Only OLDER still-provisional days — which the
// daily cursor has likely moved past — are swept.
const FINANCE_PROVISIONAL_STALE_DAYS = 6;
// Cap accounts processed for finance per tick (each enqueues at most one job).
const FINANCE_MAX_ENQUEUES_PER_TICK = 100;

// Deep re-sync: how far back to re-fetch good days to catch LATE cancellations /
// refunds that landed after the daily 14-day re-sync window closed. This is the
// long-tail safety net — it re-fetches an already-correct day so a cancellation
// that processed weeks later is reflected (matching Seller Central). It runs at
// most ONCE PER ACCOUNT PER DAY via a date-stamped jobId (see buildDeepResyncJobId),
// so even though the sweeper ticks every few hours, the heavy 30-day re-fetch only
// fires once daily per account.
const FINANCE_DEEP_RESYNC_DAYS = 30;

// Hard cap on enqueues per sweeper tick. Protects BullMQ from flooding when
// many accounts have many missing days after a long outage.
const MAX_ENQUEUES_PER_TICK = 50;

// Job options for catch-up jobs.
const CATCHUP_JOB_OPTS = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    // 2-hour timeout matches the worker's normal phase timeout. Ads async
    // reports usually finish in 30-45 minutes per call.
    timeout: 2 * 60 * 60 * 1000,
    // Keep failed jobs around for a week so the sweeper sees them via
    // queue.getJob(jobId) and doesn't re-enqueue every 2 hours. After a week,
    // failed jobs are purged; if the date is still missing then, sweeper will
    // try again. This bounds re-attempts to ~once per week per permanently-
    // failing date.
    removeOnComplete: { age: 24 * 3600, count: 200 },
    removeOnFail: { age: 7 * 24 * 3600, count: 1000 }
};

const PACIFIC_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * UTC yesterday in Pacific (matches what the daily ads phase fetches).
 */
function pacificYesterdayISO() {
    const ms = Date.now() - PACIFIC_OFFSET_MS - 24 * 60 * 60 * 1000;
    return new Date(ms).toISOString().substring(0, 10);
}

/**
 * Array of YYYY-MM-DD strings for the last `lookbackDays` ending at
 * yesterday-Pacific (exclusive of today). Yesterday itself is INCLUDED here
 * because the sweeper may run before the daily ads phase has fired for the
 * day. The "exclude yesterday if it just synced" check happens later.
 */
function lastNDates(lookbackDays) {
    const end = pacificYesterdayISO();
    const out = [];
    const endDate = new Date(`${end}T00:00:00.000Z`);
    for (let i = 0; i < lookbackDays; i++) {
        const d = new Date(endDate);
        d.setUTCDate(d.getUTCDate() - i);
        out.push(d.toISOString().substring(0, 10));
    }
    return out;
}

/**
 * Build deterministic jobId for catch-up jobs. Same (account, date) → same id.
 */
function buildCatchupJobId(userId, country, region, date) {
    return `ads-catchup-${userId}-${country}-${region}-${date}`;
}

/**
 * Per-account: find PPCMetrics dates already present in the lookback window
 * and return the *missing* dates that need catching up.
 *
 * `excludeYesterday` is true after we've confirmed the daily ads phase ran
 * today (no useful info yet — we just rely on existing job dedup).
 */
async function findMissingDatesForAccount(userId, country, region) {
    const lookback = lastNDates(ADS_LOOKBACK_DAYS);
    const userIdStr = userId.toString();

    const present = await PPCMetrics.find({
        userId: userIdStr,
        country,
        region,
        metricDate: { $in: lookback }
    }).select({ metricDate: 1, _id: 0 }).lean();

    const presentSet = new Set(present.map(p => p.metricDate));
    const yesterday = pacificYesterdayISO();

    // Exclude yesterday from catch-up — that's the daily phase's job.
    return lookback.filter(d => d !== yesterday && !presentSet.has(d));
}

/**
 * Skip enqueue if a job for (account, date) is already in any pending state.
 * For completed/failed past jobs we let BullMQ's removeOn* purge them
 * eventually — until then, sweeper sees them and skips, which throttles
 * re-attempts on permanently broken dates to once per week.
 */
async function shouldSkipEnqueue(queue, jobId) {
    const existing = await queue.getJob(jobId);
    if (!existing) return false;

    let state;
    try {
        state = await existing.getState();
    } catch (_) {
        return false;
    }

    if (state === 'waiting' || state === 'active' || state === 'delayed') {
        return true; // in flight — definitely skip
    }
    if (state === 'completed' || state === 'failed') {
        // Already attempted recently. Skip until BullMQ purges.
        return true;
    }
    // Unknown state — skip defensively.
    return true;
}

/**
 * Main entry: scan all connected ads accounts, enqueue catch-up jobs for
 * missing past dates, capped by MAX_ENQUEUES_PER_TICK.
 *
 * Returns a summary object suitable for logging.
 */
async function sweep() {
    const startedAt = Date.now();
    const queue = getQueue();

    const summary = {
        accountsScanned: 0,
        accountsWithMissing: 0,
        candidateDates: 0,
        enqueued: 0,
        skippedDup: 0,
        skippedCap: 0,
        errors: 0,
        durationMs: 0
    };

    // Pull all sellers with at least one ads-connected account.
    // We hold the entire list in memory; for current scale (~thousands of
    // accounts) this is fine. If it grows, paginate this.
    const sellers = await Seller.find(
        { 'sellerAccount.adsRefreshToken': { $exists: true, $ne: null, $ne: '' } },
        { User: 1, sellerAccount: 1 }
    ).lean();

    for (const seller of sellers) {
        if (summary.enqueued >= MAX_ENQUEUES_PER_TICK) {
            // Continue scanning to count remaining candidates, but stop enqueueing.
            // This gives an honest "we hit the cap" signal in the summary.
        }
        if (!Array.isArray(seller.sellerAccount)) continue;

        for (const acct of seller.sellerAccount) {
            if (!acct || !acct.country || !acct.region) continue;
            if (!acct.adsRefreshToken) continue;

            const country = acct.country.toUpperCase();
            const region = acct.region.toUpperCase();

            summary.accountsScanned++;

            let missing;
            try {
                missing = await findMissingDatesForAccount(seller.User, country, region);
            } catch (err) {
                summary.errors++;
                logger.warn(`[FreshnessSweeper] Missing-date scan failed for ${seller.User} ${country}-${region}: ${err.message}`);
                continue;
            }

            if (missing.length === 0) continue;
            summary.accountsWithMissing++;
            summary.candidateDates += missing.length;

            // Sort oldest-first so older gaps get filled before newer ones.
            missing.sort();

            for (const date of missing) {
                if (summary.enqueued >= MAX_ENQUEUES_PER_TICK) {
                    summary.skippedCap++;
                    continue;
                }

                const jobId = buildCatchupJobId(seller.User, country, region, date);
                let skip;
                try {
                    skip = await shouldSkipEnqueue(queue, jobId);
                } catch (_) {
                    skip = false;
                }
                if (skip) {
                    summary.skippedDup++;
                    continue;
                }

                const jobData = {
                    userId: seller.User.toString(),
                    country,
                    region,
                    phase: scheduledPhases.PHASES.ADS_CATCHUP,
                    parentJobId: jobId, // catch-up is its own parent — no chaining
                    enqueuedAt: new Date().toISOString(),
                    enqueuedBy: 'freshness-sweeper',
                    phaseData: { catchupDate: date }
                };

                try {
                    await queue.add('process-user-data', jobData, {
                        jobId,
                        ...CATCHUP_JOB_OPTS
                    });
                    summary.enqueued++;
                    logger.info(`[FreshnessSweeper] Enqueued ads catch-up: ${seller.User} ${country}-${region} ${date}`);
                } catch (err) {
                    summary.errors++;
                    logger.warn(`[FreshnessSweeper] Enqueue failed for ${jobId}: ${err.message}`);
                }
            }
        }
    }

    summary.durationMs = Date.now() - startedAt;
    logger.info('[FreshnessSweeper] Sweep complete', summary);
    return summary;
}

// ─────────────────────────────────────────────────────────────────────────
// FINANCE RECONCILIATION (backstop for missing/failed/stale-provisional days)
//
// The daily incremental flow + provisional cursor already self-heal most gaps.
// This sweep is the safety net for anything that slips through: days never
// fetched, days that failed, or provisional days older than the daily cursor's
// reach. For each affected account it enqueues ONE `sched_finance_catchup` job
// covering [min … max] of the broken days — re-fetched via the proven
// `syncFinanceData({ forceDates })` path (the same one the test route uses).
// ─────────────────────────────────────────────────────────────────────────

function buildFinanceCatchupJobId(userId, country, region, minDate, maxDate) {
    return `finance-catchup-${userId}-${country}-${region}-${minDate}_${maxDate}`;
}

/**
 * Find finance days in the lookback window that need a re-fetch for one account.
 * Returns a sorted array of YYYY-MM-DD. Excludes yesterday (the daily owns it).
 */
async function findBrokenFinanceDatesForAccount(userObjectId, country, region) {
    const yesterday = pacificYesterdayISO();
    const startDate = (() => {
        const d = new Date(`${yesterday}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() - (FINANCE_LOOKBACK_DAYS - 1));
        return d.toISOString().substring(0, 10);
    })();

    // All days in the window.
    const days = [];
    {
        const d = new Date(`${startDate}T00:00:00.000Z`);
        const end = new Date(`${yesterday}T00:00:00.000Z`);
        while (d < end) { days.push(d.toISOString().substring(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
        // note: `< end` excludes yesterday itself — the daily incremental owns it
    }

    const logs = await FinanceSyncLog.find(
        { User: userObjectId, country, region, date: { $gte: startDate, $lte: yesterday } },
        { date: 1, status: 1, provisional: 1, _id: 0 }
    ).lean();
    const logByDate = new Map(logs.map((l) => [l.date, l]));

    // TTL-safe "missing" check: a day's FinanceSyncLog row can expire (TTL on
    // fetchedAt) while its actual DailySkuFinance data still exists (data has no
    // TTL). So an absent log row does NOT prove the day is missing — we must also
    // confirm there's no real data. We pull the set of days that DO have data and
    // only treat a day as "never fetched" when BOTH the log row and the data are
    // absent. (Failed / stale-provisional days carry a log row and are handled by
    // the branches below, so the TTL never affects them.)
    const dataAgg = await DailySkuFinance.aggregate([
        { $match: { User: userObjectId, country, region, date: { $gte: startDate, $lte: yesterday } } },
        { $group: { _id: '$date' } },
    ]);
    const daysWithData = new Set(dataAgg.map((r) => r._id));

    const today = new Date(Date.now() - PACIFIC_OFFSET_MS).toISOString().substring(0, 10);
    const ageDays = (d) => Math.round((new Date(`${today}T00:00:00.000Z`) - new Date(`${d}T00:00:00.000Z`)) / 86400000);

    const broken = [];
    for (const day of days) {
        const log = logByDate.get(day);
        // Truly missing = no log row AND no stored data. With the TTL, an expired
        // log alone (data still present) is NOT a reason to re-fetch.
        if (!log) {
            if (!daysWithData.has(day)) broken.push(day);          // never fetched
            continue;
        }
        if (log.status === 'failed') { broken.push(day); continue; } // failed
        if (log.provisional === true && ageDays(day) > FINANCE_PROVISIONAL_STALE_DAYS) {
            broken.push(day);                                      // stale provisional
        }
    }
    return broken;
}

/**
 * Finance reconciliation sweep. One catch-up job per affected account.
 */
async function sweepFinance() {
    const startedAt = Date.now();
    const queue = getQueue();
    const summary = { accountsScanned: 0, accountsWithBroken: 0, brokenDays: 0, enqueued: 0, skippedDup: 0, skippedCap: 0, errors: 0, durationMs: 0 };

    const sellers = await Seller.find(
        { 'sellerAccount.spiRefreshToken': { $exists: true, $ne: null, $ne: '' } },
        { User: 1, sellerAccount: 1 }
    ).lean();

    for (const seller of sellers) {
        if (!Array.isArray(seller.sellerAccount)) continue;
        for (const acct of seller.sellerAccount) {
            if (!acct || !acct.country || !acct.region || !acct.spiRefreshToken) continue;
            const country = acct.country.toUpperCase();
            const region = acct.region.toUpperCase();
            summary.accountsScanned++;

            let broken;
            try {
                broken = await findBrokenFinanceDatesForAccount(seller.User, country, region);
            } catch (err) {
                summary.errors++;
                logger.warn(`[FinanceSweeper] Scan failed for ${seller.User} ${country}-${region}: ${err.message}`);
                continue;
            }
            if (broken.length === 0) continue;
            summary.accountsWithBroken++;
            summary.brokenDays += broken.length;

            if (summary.enqueued >= FINANCE_MAX_ENQUEUES_PER_TICK) { summary.skippedCap++; continue; }

            const minDate = broken[0];
            const maxDate = broken[broken.length - 1];
            const jobId = buildFinanceCatchupJobId(seller.User, country, region, minDate, maxDate);

            let skip;
            try { skip = await shouldSkipEnqueue(queue, jobId); } catch (_) { skip = false; }
            if (skip) { summary.skippedDup++; continue; }

            const jobData = {
                userId: seller.User.toString(),
                country,
                region,
                phase: scheduledPhases.PHASES.FINANCE_CATCHUP,
                parentJobId: jobId,
                enqueuedAt: new Date().toISOString(),
                enqueuedBy: 'finance-sweeper',
                phaseData: { catchupDates: broken }
            };
            try {
                await queue.add('process-user-data', jobData, { jobId, ...CATCHUP_JOB_OPTS });
                summary.enqueued++;
                logger.info(`[FinanceSweeper] Enqueued finance catch-up: ${seller.User} ${country}-${region} ${minDate}→${maxDate} (${broken.length} day(s))`);
            } catch (err) {
                summary.errors++;
                logger.warn(`[FinanceSweeper] Enqueue failed for ${jobId}: ${err.message}`);
            }
        }
    }

    summary.durationMs = Date.now() - startedAt;
    logger.info('[FinanceSweeper] Sweep complete', summary);
    return summary;
}

// ─────────────────────────────────────────────────────────────────────────
// DEEP RE-SYNC (long-tail cancellation/refund safety net)
//
// The daily flow re-fetches the last 14 days, which catches most cancellations.
// This closes the long tail: once per account per day, re-fetch a rolling
// FINANCE_DEEP_RESYNC_DAYS (30) window so a cancellation/refund that landed
// weeks after the order date is reflected — matching Seller Central — with NO
// manual intervention. It re-fetches good days too (that's the point), via the
// same proven `syncFinanceData({ forceDates })` path; the unique index on
// DailySkuFinance(sku,date) means re-fetching can only overwrite, never duplicate.
//
// Throttling: the jobId is stamped with today's Pacific date, so BullMQ dedup +
// removeOnComplete mean only ONE deep re-sync per account actually runs per day,
// even though the sweeper ticks every few hours.
// ─────────────────────────────────────────────────────────────────────────

function buildDeepResyncJobId(userId, country, region, todayStr) {
    return `finance-deepresync-${userId}-${country}-${region}-${todayStr}`;
}

async function sweepFinanceDeepResync() {
    const startedAt = Date.now();
    const queue = getQueue();
    const summary = { accountsScanned: 0, enqueued: 0, skippedDup: 0, skippedCap: 0, errors: 0, durationMs: 0 };

    // Build the rolling window [today-(N-1) … yesterday] of Pacific dates to re-fetch.
    const yesterday = pacificYesterdayISO();
    const todayStr = new Date(Date.now() - PACIFIC_OFFSET_MS).toISOString().substring(0, 10);
    const windowDates = [];
    {
        const d = new Date(`${yesterday}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() - (FINANCE_DEEP_RESYNC_DAYS - 1));
        const end = new Date(`${yesterday}T00:00:00.000Z`);
        while (d <= end) { windowDates.push(d.toISOString().substring(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
    }

    const sellers = await Seller.find(
        { 'sellerAccount.spiRefreshToken': { $exists: true, $ne: null, $ne: '' } },
        { User: 1, sellerAccount: 1 }
    ).lean();

    for (const seller of sellers) {
        if (!Array.isArray(seller.sellerAccount)) continue;
        for (const acct of seller.sellerAccount) {
            if (!acct || !acct.country || !acct.region || !acct.spiRefreshToken) continue;
            const country = acct.country.toUpperCase();
            const region = acct.region.toUpperCase();
            summary.accountsScanned++;

            if (summary.enqueued >= FINANCE_MAX_ENQUEUES_PER_TICK) { summary.skippedCap++; continue; }

            // Date-stamped jobId → at most one deep re-sync per account per day.
            const jobId = buildDeepResyncJobId(seller.User, country, region, todayStr);
            let skip;
            try { skip = await shouldSkipEnqueue(queue, jobId); } catch (_) { skip = false; }
            if (skip) { summary.skippedDup++; continue; }

            const jobData = {
                userId: seller.User.toString(),
                country,
                region,
                phase: scheduledPhases.PHASES.FINANCE_CATCHUP,
                parentJobId: jobId,
                enqueuedAt: new Date().toISOString(),
                enqueuedBy: 'finance-deep-resync',
                phaseData: { catchupDates: windowDates }
            };
            try {
                await queue.add('process-user-data', jobData, { jobId, ...CATCHUP_JOB_OPTS });
                summary.enqueued++;
                logger.info(`[FinanceDeepResync] Enqueued ${FINANCE_DEEP_RESYNC_DAYS}-day re-sync: ${seller.User} ${country}-${region} (${windowDates[0]}→${yesterday})`);
            } catch (err) {
                summary.errors++;
                logger.warn(`[FinanceDeepResync] Enqueue failed for ${jobId}: ${err.message}`);
            }
        }
    }

    summary.durationMs = Date.now() - startedAt;
    logger.info('[FinanceDeepResync] Sweep complete', summary);
    return summary;
}

module.exports = {
    sweep,
    sweepFinance,
    sweepFinanceDeepResync,
    findMissingDatesForAccount,
    findBrokenFinanceDatesForAccount,
    buildCatchupJobId,
    buildFinanceCatchupJobId,
    buildDeepResyncJobId,
    // Exposed for tests / scripts
    ADS_LOOKBACK_DAYS,
    MAX_ENQUEUES_PER_TICK,
    FINANCE_LOOKBACK_DAYS,
    FINANCE_DEEP_RESYNC_DAYS,
};

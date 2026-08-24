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
const User = require('../../models/user-auth/userModel.js');
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

// Minimum gap between re-checks of the SAME still-provisional day. Without this the sweep re-fetches
// such a day every 3h forever (see the note at the stale-provisional branch below). Amazon does not
// settle fees on a 3-hour cadence, so ~20h gives one attempt per day with slack for cron drift.
const FINANCE_PROVISIONAL_RECHECK_MS = Math.max(
    60 * 60 * 1000,
    parseInt(process.env.FINANCE_PROVISIONAL_RECHECK_MS || String(20 * 60 * 60 * 1000), 10) || 20 * 60 * 60 * 1000
);

// Mirrors FINANCE_MAX_DATE_RETRIES in FinanceService.js — a date past this many consecutive
// failures is no longer scheduled automatically.
const FINANCE_MAX_DATE_RETRIES = Math.max(2, parseInt(process.env.FINANCE_MAX_DATE_RETRIES || '10', 10) || 10);
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

// Deep-resync throughput ceiling per tick. As long as the active-account count is
// at or below this, EVERY active account is re-synced each run. Beyond it, fair
// rotation engages (least-recently-resynced first), so no account is ever starved
// — the ceiling becomes a rate limit, not a cutoff. Sized generously above the
// current active count so rotation only matters at much larger scale.
const DEEP_RESYNC_MAX_PER_TICK = 300;
// Freshness SLA: every active account should be deep-resynced within this many
// days. If rotation can't keep up, we LOG it (instead of silently starving).
const DEEP_RESYNC_TARGET_CYCLE_DAYS = 3;

// Hard cap on enqueues per sweeper tick. Protects BullMQ from flooding when
// many accounts have many missing days after a long outage.
const MAX_ENQUEUES_PER_TICK = 50;

// ── Orphaned logging-session sweep ───────────────────────────────────────────
// A UserAccountLogs session is opened at the start of a run and only closed when
// the pipeline reaches finalize (or a worker terminal handler that knows the
// sessionId). Hard crashes (OOM/kill), stalls, or broken phase chains leave it
// pinned at 'in_progress' forever, so the frontend "user logging" page shows a
// perpetual spinner. This sweep is the guaranteed safety net that catches ALL
// leak causes (including crashes a process can't clean up after). Any session
// with no end older than the max-age is definitively orphaned.
const STALE_SESSION_SWEEP_ENABLED = process.env.STALE_SESSION_SWEEP_DISABLED !== 'true';
// Comfortably beyond any real run (worker lock 2h + extensions; longest PPC
// report path capped ~4h). Anything older with no end is dead.
const STALE_SESSION_MAX_AGE_HOURS = parseInt(process.env.STALE_SESSION_MAX_AGE_HOURS || '6', 10);
// Bound per tick so a large backlog drains over several ticks rather than one
// enormous write. At the default 3h cadence this drains ~16k/day.
const STALE_SESSION_MAX_PER_TICK = parseInt(process.env.STALE_SESSION_MAX_PER_TICK || '2000', 10);

// ── Stalled daily-pipeline sweep ─────────────────────────────────────────────
// BACKSTOP for "the phase chain stopped walking and nothing noticed".
//
// DataFetchTracking is only ever closed by sched_finalize, so a chain that stops
// before finalize leaves its doc pinned at 'started' forever. Every reader of that
// collection selects status:{$in:['completed','partial']} — including the frontend
// Profitability calendar bootstrap (FinanceDashboardController.getFinanceDateRange) —
// so the dashboard silently freezes at the last GOOD day while the finance/ads sweeps
// above keep the underlying per-day data current. That combination is what makes it so
// hard to spot: every per-day health check is green.
//
// Observed in production 2026-08-06 (two days of "data only up to Aug 3"): the CAUSE
// there was a phase that HUNG — sched_ads sat `active` for 7.8h with attempts:0 while
// worker.js's lock-extension timer kept renewing its lock, so BullMQ never reclaimed it
// as stalled. Because phase job ids are deterministic and BullMQ silently drops an add
// whose id already exists, that one stuck job then swallowed every later attempt to run
// the phase, including a manual re-drive. That specific cause is fixed at the source by
// MAX_LOCK_EXTENSION_MS in worker.js/integrationWorker.js — past the ceiling we stop
// renewing, the job is reclaimed, and it fails loudly instead of hanging silently.
//
// This sweep is deliberately NOT a second copy of that fix. It is the catch-all for the
// same SYMPTOM arriving by some other route — the phase hand-off is a plain queue.add()
// from inside the processor (worker.js), so a process death in that gap would end the
// chain just as silently, and future phases can hang in ways the ceiling does not cover.
// Nothing else watches the master chain: the sweeps above recover missing ADS and
// FINANCE days, but neither notices that the pipeline itself stopped walking.
const PIPELINE_STALL_SWEEP_ENABLED = process.env.PIPELINE_STALL_SWEEP_DISABLED !== 'true';
// Must sit ABOVE producer.js's MAX_SCHEDULED_JOB_AGE (8h). Below it,
// enqueueScheduledAccountJob refuses while the orphaned phase job is still
// 'active'/'waiting'; above it, the producer removes that orphan itself and
// proceeds — so we let it clear the way rather than fighting it.
const PIPELINE_STALL_MAX_AGE_HOURS = Math.max(9, parseInt(process.env.PIPELINE_STALL_MAX_AGE_HOURS || '9', 10) || 9);
// Liveness guard. getAllPhaseJobIds does NOT enumerate the `-pollN` ids the ads and
// finance phases self-reschedule under, so the producer's own dedup is blind to a
// live poll chain. A healthy ads phase alone runs 40-50 min. If ANY JobStatus row
// for the account moved this recently, something is still walking — leave it alone.
const PIPELINE_STALL_QUIET_MINUTES = Math.max(15, parseInt(process.env.PIPELINE_STALL_QUIET_MINUTES || '60', 10) || 60);
// Each recovery re-runs the FULL pipeline (~40-60 min of Amazon API work), so this
// is a blast-radius cap, not a throughput knob: it stops a systemic outage from
// fanning out into one simultaneous re-run per account. Truncation is logged.
const PIPELINE_STALL_MAX_RECOVERIES_PER_TICK = Math.max(1, parseInt(process.env.PIPELINE_STALL_MAX_RECOVERIES_PER_TICK || '5', 10) || 5);

// ── Seller document-size monitor ─────────────────────────────────────────────
// MongoDB's 16MB per-document ceiling is a HARD limit: past it `sellerDetails.save()`
// throws and every write path that touches the seller document (products, issues, B2B
// pricing, issue counts) fails at once. The seller document embeds `sellerAccount[].products`,
// so it grows with catalogue size and has no natural bound.
//
// Measured 2026-08-20: exactly ONE of 301 seller documents exceeds 4MB — 8.21MB, and it
// belongs to a CANCELLED account that has been flat at 27,263 products and has not been
// fetched since 2026-07-08. The next largest is 3.00MB. So nothing is close today and
// nothing is trending; restructuring `products[]` out of the document would be a large
// migration for a problem no active account has.
//
// What is worth having is a warning if that changes — which is all this does. Read-only:
// no writes, no deletes, bounded output. It is hour-gated by the caller (once a day)
// because the aggregation must read every seller document to size it.
const DOC_SIZE_SWEEP_ENABLED = process.env.DOC_SIZE_SWEEP_DISABLED !== 'true';
// 8MB = half the hard limit. Below this there is nothing to say.
const DOC_SIZE_WARN_BYTES = Math.max(
    1,
    parseInt(process.env.SELLER_DOC_WARN_BYTES || '', 10) || 8 * 1024 * 1024
);
// 12MB = 75% of the limit. At this point a single large catalogue refresh could push a
// document over, so it is logged at error level rather than warn.
const DOC_SIZE_CRITICAL_BYTES = Math.max(
    DOC_SIZE_WARN_BYTES,
    parseInt(process.env.SELLER_DOC_CRITICAL_BYTES || '', 10) || 12 * 1024 * 1024
);
// Bound the report. If this ever fires for dozens of accounts the count matters, not the list.
const DOC_SIZE_MAX_REPORTED = Math.max(
    1,
    parseInt(process.env.SELLER_DOC_MAX_REPORTED || '', 10) || 20
);
// MongoDB's hard per-document ceiling, for the percentage in the log line.
const MONGO_MAX_DOC_BYTES = 16 * 1024 * 1024;

/**
 * BullMQ priority for catch-up work. Backfill must never queue ahead of the daily pipeline.
 *
 * WHY THIS EXISTS. Observed in production: 36 active jobs, every one a catch-up job, ZERO
 * daily-pipeline phases, with 26 more catch-up jobs queued behind them. A customer's account sat
 * frozen because its `sched_init` was stuck behind that backlog. Stopping this sweeper by hand freed
 * the queue and the account immediately progressed — that was the workaround; this is the fix.
 *
 * The arithmetic makes it inevitable rather than unlucky: one 3-hourly tick can enqueue up to 450
 * jobs (ads 50 + finance 100 + deep-resync 300) into 18 slots (6 workers x concurrency 3), while a
 * single daily run needs ~9 SEQUENTIAL slots.
 *
 * MIND THE VERSION. BullMQ INVERTED priority between v4 and v5. In the installed 5.76.7, job.js
 * states: "Ranges from 0 (highest priority) to 2,097,152 (lowest priority). @defaultValue 0" — so 0
 * is the HIGHEST priority, and it is what every un-prioritised job already gets.
 *
 * That is what makes this a one-line fix. moveToActive-11.js drains strictly in this order:
 *     local jobId = rcall("RPOPLPUSH", waitKey, activeKey)       -- priority 0 jobs
 *     if jobId then ... else moveJobFromPrioritizedToActive(...)  -- priority > 0 jobs
 * and placement is `if priority == 0 then` -> `wait`, else -> `prioritized`. The `wait` list is
 * emptied before `prioritized` is touched at all. The daily pipeline sets no priority, so it is
 * already at 0 and already in `wait` — marking catch-up alone is sufficient and the scheduled path
 * needs no edit. DO NOT "tidy" this by giving the daily pipeline an explicit priority: any non-zero
 * value would move it into `prioritized` and forfeit exactly the precedence this buys.
 *
 * Limit worth knowing: this orders WAITING jobs, it does not preempt RUNNING ones. If every slot is
 * already busy with catch-up, a daily job still waits for one to free — but catch-up now only
 * occupies slots the daily pipeline is not asking for.
 */
const CATCHUP_JOB_PRIORITY = Math.max(
    1,
    parseInt(process.env.CATCHUP_JOB_PRIORITY || '10', 10) || 10
);

// Job options for catch-up jobs.
const CATCHUP_JOB_OPTS = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    // Lower precedence than the daily pipeline — see CATCHUP_JOB_PRIORITY above.
    priority: CATCHUP_JOB_PRIORITY,
    // No `timeout`: it is a no-op since BullMQ v4 (see queue.js). Ads async reports
    // usually finish in 30-45 min per call; anything that hangs far past that is caught
    // by the lock-extension ceiling in worker.js, not by a per-job option.
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

// ── Active-account filter (Phase 1) ──────────────────────────────────────────
// The daily pipeline only syncs ACTIVE accounts: isVerified && (Pro || agency-
// client). The sweeps must match that scope — otherwise they (a) waste SP-API
// fetches on inactive accounts and (b) let those accounts consume the per-tick
// budget, starving the real ones (the exact bug that left a paid account never
// deep-resynced). Mirrors UserSchedulingService.getUsersNeedingDailyUpdate.
//
// FAIL-SAFE: returns null on error OR empty result. A null set means "no filter
// / process all" (the prior behaviour), so a query problem can never silently
// stop the sweeps from running.
async function getActiveUserIdSet() {
    try {
        const users = await User.find(
            { isVerified: true, $or: [{ packageType: 'PRO' }, { isAgencyClient: true }] },
            { _id: 1 }
        ).lean();
        if (!users || users.length === 0) {
            logger.warn('[FreshnessSweeper] Active-user filter matched 0 users — falling back to ALL accounts (fail-safe).');
            return null;
        }
        return new Set(users.map((u) => u._id.toString()));
    } catch (err) {
        logger.warn(`[FreshnessSweeper] Active-user filter query failed (${err.message}) — falling back to ALL accounts.`);
        return null;
    }
}

// Stamp the rotation timestamp so a just-handled account moves to the back of the
// least-recently-resynced queue. Best-effort: a stamp failure only means the
// account may be re-picked next tick (harmless), never a crash.
async function stampDeepResyncAt(sellerId, rawCountry, rawRegion) {
    try {
        await Seller.updateOne(
            { _id: sellerId, sellerAccount: { $elemMatch: { country: rawCountry, region: rawRegion } } },
            { $set: { 'sellerAccount.$.lastDeepResyncAt': new Date() } }
        );
    } catch (err) {
        logger.warn(`[FinanceDeepResync] Failed to stamp lastDeepResyncAt (${rawCountry}-${rawRegion}): ${err.message}`);
    }
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
        // Project only the sub-fields this sweep reads — excludes the large embedded
        // products[]/TotatProducts[] arrays that were previously loaded but never used.
        {
            User: 1,
            'sellerAccount.country': 1,
            'sellerAccount.region': 1,
            'sellerAccount.spiRefreshToken': 1,
            'sellerAccount.adsRefreshToken': 1,
            'sellerAccount.lastDeepResyncAt': 1
        }
    ).lean();

    // Only sweep ACTIVE accounts (same scope as the daily pipeline).
    const activeSet = await getActiveUserIdSet();

    for (const seller of sellers) {
        if (summary.enqueued >= MAX_ENQUEUES_PER_TICK) {
            // Continue scanning to count remaining candidates, but stop enqueueing.
            // This gives an honest "we hit the cap" signal in the summary.
        }
        if (!Array.isArray(seller.sellerAccount)) continue;
        if (activeSet && !activeSet.has(seller.User?.toString())) continue;

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

// ── De-authorized account guard (FIX #2) ─────────────────────────────────────
// A few accounts have SP-API authorizations that no longer cover the Reports API
// (revoked / insufficient role). EVERY finance fetch for them fails with
// "Access to requested resource is denied". Without this guard the sweep re-
// enqueues a catch-up for them every tick — observed as 1600+ wasted failures
// plus log spam plus quota burn. We detect the condition from their most recent
// finance sync log and skip enqueuing until they reconnect (a fresh success log
// clears the skip automatically). Mirrors FinanceService.isAuthorizationDeniedError.
function isFinanceAuthDeniedError(msg) {
    const s = (msg || '').toLowerCase();
    return s.includes('access to requested resource is denied')
        || s.includes('access_denied')
        || s.includes('forbidden');
}

async function isAccountFinanceAuthDenied(userObjectId, country, region) {
    // The MOST RECENT finance attempt: if it failed with an authorization denial
    // (and no newer success exists), the account is currently de-authorized.
    const latest = await FinanceSyncLog.findOne(
        { User: userObjectId, country, region },
        { status: 1, error: 1, errorKind: 1, _id: 0 }
    ).sort({ fetchedAt: -1 }).lean();
    if (!latest) return false;
    if (latest.status !== 'failed') return false;

    // Prefer the explicit classification written by FinanceService. The string match below is
    // the fallback for rows written before `errorKind` existed — note it must NOT be consulted
    // when errorKind IS set, or a message that merely mentions "forbidden" inside a timeout
    // would be misread as a permanent denial and the account skipped for good.
    if (latest.errorKind) return latest.errorKind === 'auth_denied';
    return isFinanceAuthDeniedError(latest.error);
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
        { date: 1, status: 1, provisional: 1, fetchedAt: 1, consecutiveFailures: 1, nextRetryAfter: 1, _id: 0 }
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

    const nowMs = Date.now();
    const broken = [];
    const skipped = { backedOff: 0, givenUp: 0, recentlyTried: 0 };

    for (const day of days) {
        const log = logByDate.get(day);
        // Truly missing = no log row AND no stored data. With the TTL, an expired
        // log alone (data still present) is NOT a reason to re-fetch.
        if (!log) {
            if (!daysWithData.has(day)) broken.push(day);          // never fetched
            continue;
        }

        if (log.status === 'failed') {
            // ── Backoff, added because this sweep runs every 3h and a `failed` day was
            // unconditionally re-enqueued every single time. One account looped on the same chunk
            // ~8x/day for a full day, re-running Step 1 on each pass. `recordSyncFailure` now
            // tracks the attempt count and sets `nextRetryAfter`.
            if ((log.consecutiveFailures || 0) >= FINANCE_MAX_DATE_RETRIES) {
                // Given up on. Deliberately NOT silent — reported by diagnoseDailySchedule, because
                // the bug that caused all this was a failure nobody could see.
                skipped.givenUp++;
                continue;
            }
            if (log.nextRetryAfter && new Date(log.nextRetryAfter).getTime() > nowMs) {
                skipped.backedOff++;
                continue;
            }
            broken.push(day);
            continue;
        }

        if (log.provisional === true && ageDays(day) > FINANCE_PROVISIONAL_STALE_DAYS) {
            // ── Rate-limited, because this branch loops even when NOTHING is failing ──
            // FINANCE_PROVISIONAL_STALE_DAYS (6) is deliberately shorter than FinanceService's
            // PROVISIONAL_SETTLE_DAYS (14), so for a day aged 7-14 that still holds Pending-status
            // orders a SUCCESSFUL sync re-writes `provisional: true` and this branch immediately
            // re-flags it. That is a permanent 3-hourly oscillation with no error anywhere.
            //
            // Re-checking such a day is correct — it may have settled — but daily is enough. Amazon
            // does not post fees on a 3-hour cadence.
            if (log.fetchedAt && (nowMs - new Date(log.fetchedAt).getTime()) < FINANCE_PROVISIONAL_RECHECK_MS) {
                skipped.recentlyTried++;
                continue;
            }
            broken.push(day);
        }
    }

    if (skipped.backedOff || skipped.givenUp || skipped.recentlyTried) {
        logger.debug(
            `[FinanceSweep] ${country}-${region}: skipped ${skipped.backedOff} backed-off, ` +
            `${skipped.givenUp} given-up, ${skipped.recentlyTried} recently-checked date(s).`
        );
    }
    return broken;
}

/**
 * Finance reconciliation sweep. One catch-up job per affected account.
 */
async function sweepFinance() {
    const startedAt = Date.now();
    const queue = getQueue();
    const summary = { accountsScanned: 0, accountsWithBroken: 0, brokenDays: 0, enqueued: 0, skippedDup: 0, skippedCap: 0, skippedAuthDenied: 0, errors: 0, durationMs: 0 };

    const sellers = await Seller.find(
        { 'sellerAccount.spiRefreshToken': { $exists: true, $ne: null, $ne: '' } },
        // Project only the sub-fields this sweep reads — excludes the large embedded
        // products[]/TotatProducts[] arrays that were previously loaded but never used.
        {
            User: 1,
            'sellerAccount.country': 1,
            'sellerAccount.region': 1,
            'sellerAccount.spiRefreshToken': 1,
            'sellerAccount.adsRefreshToken': 1,
            'sellerAccount.lastDeepResyncAt': 1
        }
    ).lean();

    // Only sweep ACTIVE accounts (same scope as the daily pipeline).
    const activeSet = await getActiveUserIdSet();

    for (const seller of sellers) {
        if (!Array.isArray(seller.sellerAccount)) continue;
        if (activeSet && !activeSet.has(seller.User?.toString())) continue;
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

            // Skip accounts whose SP-API authorization is denied — re-fetching is
            // futile until they reconnect, and hammering them wastes quota + spams
            // logs. A fresh success log (after re-auth) clears this automatically.
            let authDenied = false;
            try { authDenied = await isAccountFinanceAuthDenied(seller.User, country, region); } catch (_) { authDenied = false; }
            if (authDenied) {
                summary.skippedAuthDenied++;
                logger.warn(`[FinanceSweeper] Skipping ${seller.User} ${country}-${region}: SP-API authorization denied — account must reconnect. ${broken.length} broken day(s) cannot be fetched until re-auth.`);
                continue;
            }

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
    const summary = { accountsScanned: 0, eligible: 0, enqueued: 0, skippedDup: 0, skippedCap: 0, errors: 0, rotation: false, cycleDays: 1, durationMs: 0 };

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
        // Project only the sub-fields this sweep reads — excludes the large embedded
        // products[]/TotatProducts[] arrays that were previously loaded but never used.
        // (_id is returned by default and is required below for stampDeepResyncAt.)
        {
            User: 1,
            'sellerAccount.country': 1,
            'sellerAccount.region': 1,
            'sellerAccount.spiRefreshToken': 1,
            'sellerAccount.adsRefreshToken': 1,
            'sellerAccount.lastDeepResyncAt': 1
        }
    ).lean();

    // Phase 1: only ACTIVE accounts (match the daily pipeline scope).
    const activeSet = await getActiveUserIdSet();

    // Phase 2: build the eligible list, then order by LEAST-RECENTLY deep-resynced
    // (never-resynced = 0 = highest priority). This makes the per-tick cap a fair
    // ROTATION instead of a positional cutoff — the longest-waiting account is
    // always next, so no account is ever permanently starved, at any scale.
    const eligible = [];
    for (const seller of sellers) {
        if (!Array.isArray(seller.sellerAccount)) continue;
        if (activeSet && !activeSet.has(seller.User?.toString())) continue;
        for (const acct of seller.sellerAccount) {
            if (!acct || !acct.country || !acct.region || !acct.spiRefreshToken) continue;
            eligible.push({
                sellerId: seller._id,
                user: seller.User,
                rawCountry: acct.country,
                rawRegion: acct.region,
                country: acct.country.toUpperCase(),
                region: acct.region.toUpperCase(),
                lastDeepResyncAt: acct.lastDeepResyncAt ? new Date(acct.lastDeepResyncAt).getTime() : 0,
            });
        }
    }
    summary.accountsScanned = eligible.length;
    summary.eligible = eligible.length;
    eligible.sort((a, b) => a.lastDeepResyncAt - b.lastDeepResyncAt);

    // Auto-sized throughput: process up to the ceiling per tick. At/below the
    // ceiling, EVERY active account is handled each run (no rotation needed).
    // Above it, rotation engages and we LOG the implied coverage cycle so a
    // capacity shortfall is visible instead of silently starving accounts.
    const perTick = Math.min(eligible.length, DEEP_RESYNC_MAX_PER_TICK);
    if (eligible.length > DEEP_RESYNC_MAX_PER_TICK) {
        summary.rotation = true;
        summary.cycleDays = Math.ceil(eligible.length / DEEP_RESYNC_MAX_PER_TICK); // assumes ~1 effective run/day
        const over = summary.cycleDays > DEEP_RESYNC_TARGET_CYCLE_DAYS;
        logger[over ? 'warn' : 'info'](
            `[FinanceDeepResync] Rotation active: ${eligible.length} active accounts > ${DEEP_RESYNC_MAX_PER_TICK}/tick. ` +
            `Est. full-coverage cycle ≈ ${summary.cycleDays} day(s)` +
            (over ? ` — EXCEEDS target ${DEEP_RESYNC_TARGET_CYCLE_DAYS}d; raise DEEP_RESYNC_MAX_PER_TICK or scale workers.` : '.')
        );
    }

    for (let i = 0; i < perTick; i++) {
        const e = eligible[i];
        // Date-stamped jobId → at most one deep re-sync per account per day.
        const jobId = buildDeepResyncJobId(e.user, e.country, e.region, todayStr);
        let skip;
        try { skip = await shouldSkipEnqueue(queue, jobId); } catch (_) { skip = false; }
        if (skip) {
            summary.skippedDup++;
            // Already handled today → still advance rotation so it doesn't get
            // re-picked next tick ahead of accounts that haven't run yet.
            await stampDeepResyncAt(e.sellerId, e.rawCountry, e.rawRegion);
            continue;
        }

        const jobData = {
            userId: e.user.toString(),
            country: e.country,
            region: e.region,
            phase: scheduledPhases.PHASES.FINANCE_CATCHUP,
            parentJobId: jobId,
            enqueuedAt: new Date().toISOString(),
            enqueuedBy: 'finance-deep-resync',
            phaseData: { catchupDates: windowDates }
        };
        try {
            await queue.add('process-user-data', jobData, { jobId, ...CATCHUP_JOB_OPTS });
            summary.enqueued++;
            await stampDeepResyncAt(e.sellerId, e.rawCountry, e.rawRegion);
            logger.info(`[FinanceDeepResync] Enqueued ${FINANCE_DEEP_RESYNC_DAYS}-day re-sync: ${e.user} ${e.country}-${e.region} (${windowDates[0]}→${yesterday})`);
        } catch (err) {
            // NOT stamped → retried next tick (failure doesn't consume its turn).
            summary.errors++;
            logger.warn(`[FinanceDeepResync] Enqueue failed for ${jobId}: ${err.message}`);
        }
    }

    summary.durationMs = Date.now() - startedAt;
    logger.info('[FinanceDeepResync] Sweep complete', summary);
    return summary;
}

/**
 * Close orphaned 'in_progress' logging sessions (see constants above).
 * Bounded per tick; a large backlog drains over consecutive ticks.
 * Marks them 'partial' (honest: run started, may be incomplete, never finalized)
 * with an audit marker. Idempotent and safe to run repeatedly.
 */
async function sweepStaleSessions() {
    if (!STALE_SESSION_SWEEP_ENABLED) {
        return { enabled: false, closed: 0, remaining: 0 };
    }

    const UserAccountLogs = require('../../models/system/ErrorLogs.js');
    const cutoff = new Date(Date.now() - STALE_SESSION_MAX_AGE_HOURS * 60 * 60 * 1000);
    const query = {
        sessionStatus: 'in_progress',
        sessionStartTime: { $lt: cutoff },
        $or: [{ sessionEndTime: null }, { sessionEndTime: { $exists: false } }]
    };

    // Grab a bounded batch of oldest-first ids, then close exactly those.
    const batch = await UserAccountLogs.find(query)
        .sort({ sessionStartTime: 1 })
        .limit(STALE_SESSION_MAX_PER_TICK)
        .select('_id')
        .lean();

    if (!batch.length) {
        return { enabled: true, closed: 0, remaining: 0 };
    }

    const ids = batch.map((d) => d._id);
    // Re-assert sessionStatus:'in_progress' so a session that legitimately closes
    // between the read and the write is never clobbered. overallSummary (a numeric
    // object) and the per-function log entries are intentionally left untouched.
    const res = await UserAccountLogs.updateMany(
        { _id: { $in: ids }, sessionStatus: 'in_progress' },
        [
            {
                $set: {
                    sessionStatus: 'partial',
                    sessionEndTime: '$$NOW',
                    sessionDuration: { $subtract: ['$$NOW', '$sessionStartTime'] },
                    autoClosedStale: true,
                    autoClosedAt: '$$NOW'
                }
            }
        ]
    );

    const remaining = await UserAccountLogs.countDocuments(query);
    return { enabled: true, closed: res.modifiedCount, remaining };
}

/**
 * Find daily pipelines that stopped walking mid-chain, and re-drive them.
 *
 * See the PIPELINE_STALL_* block above for why this class of failure is invisible
 * everywhere else. Detection requires ALL of:
 *   1. a DataFetchTracking doc still at 'started', older than the max age;
 *   2. no newer completed/partial doc for the same (User, country, region) — i.e.
 *      no later run already fixed it;
 *   3. the account is active/eligible (keeps churned accounts out — there are a
 *      dozen ancient 'started' docs belonging to closed accounts);
 *   4. shouldAttemptAccountUpdate() says eligible — so 'done' accounts are not
 *      re-run and 'capped' accounts still respect MAX_DAILY_ATTEMPTS, the valve
 *      that stops a permanently-broken account burning SP-API quota;
 *   5. nothing has touched the account's JobStatus rows recently (liveness).
 *
 * ORDERING IS THE DESIGN: the stuck doc is closed only AFTER a verified enqueue.
 * That makes closing it the dedup mechanism, with no extra state to track —
 *   enqueued  -> doc closed -> not re-detected; the new run's fresh 'started' doc
 *                must itself age past the threshold before it could qualify.
 *   blocked   -> doc LEFT OPEN -> retried next tick, by which time the orphaned
 *                phase job has aged past the producer's 8h rule.
 * Closing first would permanently lose the signal whenever the enqueue was blocked
 * — recreating the exact silent freeze this exists to end.
 *
 * Idempotent and safe to run repeatedly.
 */
/**
 * Split sized documents into warn/critical bands.
 *
 * Pure and exported so the threshold logic can be tested without a database — the
 * aggregation below is the only part that needs Mongo, and it does no classification.
 *
 * @param {Array<{_id: any, User: any, sizeBytes: number, productCount: number}>} rows
 * @param {{warnBytes: number, criticalBytes: number}} thresholds
 * @returns {{warn: Array, critical: Array, worst: Object|null}}
 */
function classifyDocumentSizes(rows, { warnBytes, criticalBytes } = {}) {
    const warnAt = Number.isFinite(warnBytes) ? warnBytes : DOC_SIZE_WARN_BYTES;
    const criticalAt = Number.isFinite(criticalBytes) ? criticalBytes : DOC_SIZE_CRITICAL_BYTES;
    const warn = [];
    const critical = [];
    let worst = null;

    for (const row of Array.isArray(rows) ? rows : []) {
        const size = Number(row?.sizeBytes);
        if (!Number.isFinite(size)) continue;
        if (!worst || size > Number(worst.sizeBytes)) worst = row;
        // Bands are exclusive: a critical document is not also counted as a warning,
        // so `warn.length + critical.length` is the number of distinct accounts.
        if (size >= criticalAt) critical.push(row);
        else if (size >= warnAt) warn.push(row);
    }

    return { warn, critical, worst };
}

/**
 * Read-only check for seller documents approaching MongoDB's 16MB ceiling.
 *
 * See the DOC_SIZE_* block above for why this is monitoring rather than a fix. It
 * writes nothing and enqueues nothing; its entire output is a log line.
 *
 * Cost: the `$bsonSize` projection forces a full scan of the sellers collection, so
 * the caller gates this to one tick per day rather than running it every 3 hours.
 */
async function sweepDocumentSizes() {
    const startedAt = Date.now();
    const summary = {
        enabled: true, scanned: 0, warned: 0, critical: 0,
        worstBytes: 0, worstUserId: null, worstProductCount: 0, errors: 0, durationMs: 0,
    };
    if (!DOC_SIZE_SWEEP_ENABLED) return { ...summary, enabled: false };

    try {
        // Project down to four scalars before anything else so the pipeline never
        // materialises a full seller document (the largest is >8MB) in the cursor.
        const rows = await Seller.aggregate([
            {
                $project: {
                    User: 1,
                    sizeBytes: { $bsonSize: '$$ROOT' },
                    productCount: {
                        $sum: {
                            $map: {
                                input: { $ifNull: ['$sellerAccount', []] },
                                as: 'acct',
                                in: { $size: { $ifNull: ['$$acct.products', []] } }
                            }
                        }
                    }
                }
            },
            // Filter server-side: only documents already worth talking about cross the wire.
            { $match: { sizeBytes: { $gte: DOC_SIZE_WARN_BYTES } } },
            { $sort: { sizeBytes: -1 } },
            { $limit: DOC_SIZE_MAX_REPORTED }
        ]).allowDiskUse(true);

        summary.scanned = rows.length;

        const { warn, critical, worst } = classifyDocumentSizes(rows, {
            warnBytes: DOC_SIZE_WARN_BYTES,
            criticalBytes: DOC_SIZE_CRITICAL_BYTES,
        });
        summary.warned = warn.length;
        summary.critical = critical.length;

        if (worst) {
            summary.worstBytes = Number(worst.sizeBytes) || 0;
            summary.worstUserId = worst.User ? String(worst.User) : String(worst._id);
            summary.worstProductCount = Number(worst.productCount) || 0;
        }

        const describe = (row) => ({
            userId: row.User ? String(row.User) : String(row._id),
            sizeMB: +(Number(row.sizeBytes) / (1024 * 1024)).toFixed(2),
            percentOfLimit: +((Number(row.sizeBytes) / MONGO_MAX_DOC_BYTES) * 100).toFixed(1),
            productCount: Number(row.productCount) || 0,
        });

        if (critical.length > 0) {
            logger.error('[FreshnessSweeper] Seller documents near MongoDB 16MB limit', {
                count: critical.length,
                thresholdMB: +(DOC_SIZE_CRITICAL_BYTES / (1024 * 1024)).toFixed(2),
                documents: critical.map(describe),
            });
        }
        if (warn.length > 0) {
            logger.warn('[FreshnessSweeper] Large seller documents', {
                count: warn.length,
                thresholdMB: +(DOC_SIZE_WARN_BYTES / (1024 * 1024)).toFixed(2),
                documents: warn.map(describe),
            });
        }
    } catch (error) {
        summary.errors++;
        logger.error('[FreshnessSweeper] Document-size sweep failed', { error: error?.message });
    }

    summary.durationMs = Date.now() - startedAt;
    logger.info('[FreshnessSweeper] Document-size sweep complete', summary);
    return summary;
}

async function sweepStalledPipelines() {
    const summary = {
        enabled: true, scanned: 0, frozen: 0, recovered: 0, blocked: 0,
        skippedInactive: 0, skippedDone: 0, skippedCapped: 0, skippedLive: 0,
        cappedByTick: false, errors: 0,
    };
    if (!PIPELINE_STALL_SWEEP_ENABLED) return { ...summary, enabled: false };

    const DataFetchTracking = require('../../models/system/DataFetchTrackingModel.js');
    const JobStatus = require('../../models/system/JobStatusModel.js');
    const { UserSchedulingService } = require('./UserSchedulingService.js');
    const { enqueueScheduledAccountJob } = require('./producer.js');

    const cutoff = new Date(Date.now() - PIPELINE_STALL_MAX_AGE_HOURS * 60 * 60 * 1000);

    // Collapse to one candidate per (User, country, region). `newest` is the most
    // recent stuck doc; older ones for the same triple are closed alongside it.
    const candidates = await DataFetchTracking.aggregate([
        { $match: { status: 'started', updatedAt: { $lt: cutoff } } },
        {
            $group: {
                _id: { User: '$User', country: '$country', region: '$region' },
                newest: { $max: '$updatedAt' },
                ids: { $push: '$_id' },
            },
        },
    ]);
    summary.scanned = candidates.length;
    if (!candidates.length) return summary;

    // Same scope as the daily pipeline. null = "no filter" (documented fail-safe),
    // which for THIS sweep would mean re-running churned accounts — so unlike the
    // other sweeps, a null set is treated as "skip", not "process all".
    const activeUserIds = await getActiveUserIdSet();
    const quietBefore = new Date(Date.now() - PIPELINE_STALL_QUIET_MINUTES * 60 * 1000);

    for (const cand of candidates) {
        const userId = String(cand._id.User);
        const { country, region } = cand._id;
        if (!country || !region) continue;

        try {
            if (!activeUserIds || !activeUserIds.has(userId)) { summary.skippedInactive++; continue; }

            // A later run already produced usable data — this doc is just litter.
            const newerUsable = await DataFetchTracking.findOne({
                User: cand._id.User, country, region,
                status: { $in: ['completed', 'partial'] },
                fetchedAt: { $gt: cand.newest },
            }).select('_id').lean();
            if (newerUsable) continue;

            summary.frozen++;

            const gate = await UserSchedulingService.shouldAttemptAccountUpdate(userId, country, region);
            if (!gate.eligible) {
                if (gate.reason === 'done') summary.skippedDone++;
                else if (gate.reason === 'capped') summary.skippedCapped++;
                else summary.skippedInactive++;
                continue;
            }

            // Liveness. JobStatus rows are UPSERTED under a deterministic jobId
            // (unique index), never appended, so `updatedAt` is a true per-account
            // "something moved" signal — and `createdAt` is meaningless here (rows
            // carry the date they were FIRST created, often months ago).
            //
            // This is what stops the sweep fighting a long-but-healthy run: a phase
            // legitimately mid-flight keeps its JobStatus row warm. It also covers the
            // ads/finance `-pollN` job ids, which getAllPhaseJobIds does not enumerate.
            //
            // producer.js used to be blind to exactly those ids, which is how it started a
            // second run on top of a live one: 100 of 334 runs on the 10 async-engine accounts
            // were marked stalled over 14 days, against 0 of 2,056 elsewhere. It now runs this
            // SAME prefix query — see producer.hasLiveAccountPhase. Keep the two windows equal
            // (PIPELINE_STALL_QUIET_MINUTES here, HEARTBEAT_STALE_MS there, both 60 min) or one
            // will re-drive an account the other still considers alive.
            const live = await JobStatus.findOne({
                jobId: { $regex: `^scheduled-${userId}-${country}-${region}` },
                updatedAt: { $gt: quietBefore },
            }).select('_id').lean();
            if (live) { summary.skippedLive++; continue; }

            if (summary.recovered >= PIPELINE_STALL_MAX_RECOVERIES_PER_TICK) {
                summary.cappedByTick = true;
                continue;
            }

            const result = await enqueueScheduledAccountJob(userId, country, region);
            if (!result || !result.success) {
                // Expected while the orphaned phase job is still inside the
                // producer's 8h window. Leave the doc open; next tick retries.
                summary.blocked++;
                logger.warn(
                    `[FreshnessSweeper] Stalled pipeline for ${userId} ${country}-${region} could not be re-enqueued yet — leaving it open for the next tick`,
                    { message: result?.message, state: result?.state, jobId: result?.jobId }
                );
                continue;
            }

            // producer.js swallows a failed job.remove() and then queue.add()s the
            // same jobId — BullMQ returns the PRE-EXISTING job and the producer
            // still reports success:true. So confirm a fresh job actually exists.
            const initJobId = `scheduled-${userId}-${country}-${region}-${scheduledPhases.PHASES.INIT}`;
            let verified = false;
            try {
                const job = await getQueue().getJob(initJobId);
                verified = !!job && (Date.now() - job.timestamp) < PIPELINE_STALL_MAX_AGE_HOURS * 60 * 60 * 1000;
            } catch (verifyErr) {
                logger.warn(`[FreshnessSweeper] Could not verify re-enqueued job ${initJobId}: ${verifyErr.message}`);
            }
            if (!verified) {
                summary.blocked++;
                logger.warn(`[FreshnessSweeper] Re-enqueue for ${userId} ${country}-${region} reported success but no fresh ${initJobId} is queued — leaving the tracking doc open`);
                continue;
            }

            // Only now: close every stuck doc for this account. The status re-filter
            // is a CAS guard so a run that legitimately finalizes between the read
            // and this write is never clobbered.
            //
            // 'failed', never 'partial': all ten readers of this collection accept
            // 'partial', which would promote a half-fetched dataRange to the head of
            // the calendar query. 'failed' keeps it correctly invisible.
            await DataFetchTracking.updateMany(
                { _id: { $in: cand.ids }, status: 'started' },
                {
                    $set: {
                        status: 'failed',
                        errorMessage: 'stalled-pipeline-autorecovered',
                        autoClosedStale: true,
                        autoClosedAt: new Date(),
                    },
                }
            );

            summary.recovered++;
            logger.warn(
                `[FreshnessSweeper] Re-drove a STALLED daily pipeline for ${userId} ${country}-${region} (frozen since ${cand.newest.toISOString()})`,
                { jobId: result.jobId, closedDocs: cand.ids.length }
            );
        } catch (err) {
            summary.errors++;
            logger.error(`[FreshnessSweeper] Stalled-pipeline recovery failed for ${userId} ${country}-${region}`, { error: err?.message, stack: err?.stack });
        }
    }

    if (summary.cappedByTick) {
        logger.warn(
            `[FreshnessSweeper] Stalled-pipeline recoveries hit the per-tick cap (${PIPELINE_STALL_MAX_RECOVERIES_PER_TICK}); the rest are deferred to the next tick — this tick did NOT cover everything frozen.`,
            { frozen: summary.frozen, recovered: summary.recovered }
        );
    }
    return summary;
}

module.exports = {
    sweep,
    sweepFinance,
    sweepFinanceDeepResync,
    sweepStaleSessions,
    sweepStalledPipelines,
    sweepDocumentSizes,
    classifyDocumentSizes,
    findMissingDatesForAccount,
    findBrokenFinanceDatesForAccount,
    buildCatchupJobId,
    buildFinanceCatchupJobId,
    buildDeepResyncJobId,
    // Exposed for tests / scripts
    CATCHUP_JOB_OPTS,
    CATCHUP_JOB_PRIORITY,
    ADS_LOOKBACK_DAYS,
    MAX_ENQUEUES_PER_TICK,
    FINANCE_LOOKBACK_DAYS,
    FINANCE_DEEP_RESYNC_DAYS,
    PIPELINE_STALL_MAX_AGE_HOURS,
    PIPELINE_STALL_MAX_RECOVERIES_PER_TICK,
    // Exported so a test can pin it against producer.HEARTBEAT_STALE_MS: the two gate the same
    // decision from opposite sides and must not drift apart.
    PIPELINE_STALL_QUIET_MINUTES,
    DOC_SIZE_WARN_BYTES,
    DOC_SIZE_CRITICAL_BYTES,
};

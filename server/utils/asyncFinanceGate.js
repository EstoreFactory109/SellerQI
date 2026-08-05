/**
 * asyncFinanceGate.js — decides whether ONE account runs a given phase family on the non-blocking
 * async path or the inline one.
 *
 * Despite the filename this now hosts BOTH gates — finance and ads. Renaming the file would touch
 * every importer for zero behaviour change, so the name simply under-sells it; read the exports.
 *
 * Why each family needs its own switch
 * ------------------------------------
 * `ADS_ASYNC_ENABLED` is read at FOUR places in ScheduledIntegration — `sched_batch_1_2`,
 * `sched_ads`, `sched_ads_catchup`, `sched_batch_4`. Finance is NOT among them: it has always used
 * `financeAsyncEnabledFor` below, in every commit. So the two families are independent, and enabling
 * one cannot change the other's behaviour.
 *
 * (An earlier version of this comment claimed six sites including the two finance phases, and blamed
 * a `ReferenceError` for the ads save never running in production. Both were wrong — `git log -S`
 * finds no commit containing the buggy form, so it only ever existed in an uncommitted tree. The
 * accurate and sufficient reason for caution is plainer: the ads async path has ZERO production
 * mileage. It was added 2026-07-31 and has never been switched on anywhere.)
 *
 * Each family gets a flag plus an optional allowlist:
 *
 *   FINANCE_ASYNC_ENABLED=true
 *   FINANCE_ASYNC_USER_IDS=6a57b823571ceb9266953c30[,<more>]
 *
 *   ADS_ASYNC_ENABLED=true
 *   ADS_ASYNC_USER_IDS=6a57b823571ceb9266953c30[,<more>]
 *
 * Semantics (identical for both, via the shared `gateFor` — that sharing is the point):
 *   flag not 'true'              -> false for everyone (inline; the default and the rollback)
 *   flag 'true', no/empty list   -> true for everyone (the post-soak widened state)
 *   flag 'true', list present    -> true only for ids on the list
 *   flag 'true', list all invalid-> false for everyone (fail CLOSED; see gateFor)
 *
 * Deployment note, and it bites every time: the worker calls `dotenv.config()`, so these must live
 * in the ROOT `.env`. Putting them in a PM2 `env` block does NOT work —
 * `ecosystem.worker.config.js` does not enumerate them, and PM2 only passes through the keys it
 * lists.
 */

const mongoose = require('mongoose');

/**
 * Parse a comma-separated list of ObjectId strings. Mirrors `parseExcludeUserIds` in
 * scripts/backfillFinanceDashboardProUsers.js:77 — the only precedent for this shape in the repo.
 *
 * Invalid ids are dropped rather than throwing: a typo in an env var must not crash the worker at
 * phase-dispatch time. It fails closed instead — a malformed id simply isn't on the list, so that
 * account stays on the proven inline path.
 */
function parseUserIdList(raw) {
    const ids = new Set();
    if (!raw) return ids;
    for (const part of String(raw).split(',')) {
        const id = part.trim();
        if (id && mongoose.Types.ObjectId.isValid(id)) ids.add(id);
    }
    return ids;
}

/**
 * @param {string|object} userId  Mongo id (string or ObjectId)
 * @param {object} [env]          Injectable for tests; defaults to process.env
 * @returns {boolean}
 */
function financeAsyncEnabledFor(userId, env = process.env) {
    return gateFor(userId, env, 'FINANCE_ASYNC_ENABLED', 'FINANCE_ASYNC_USER_IDS');
}

/**
 * The shared flag+allowlist evaluation. Factored out so every gate gets identical semantics —
 * particularly the fail-closed branch — by construction rather than by copied code that can drift.
 *
 * @param {string|object} userId
 * @param {object} env
 * @param {string} flagKey       env var holding the master switch
 * @param {string} allowlistKey  env var holding the optional comma-separated ObjectId allowlist
 */
function gateFor(userId, env, flagKey, allowlistKey) {
    if (env[flagKey] !== 'true') return false;

    const raw = String(env[allowlistKey] || '').trim();

    // Nothing configured at all -> no restriction. This must mean "everyone", not "nobody", or
    // widening the rollout would require deleting the variable rather than blanking it — and a blank
    // value would silently send every account back to the old path.
    if (raw === '') return true;

    const allowlist = parseUserIdList(raw);

    // Configured but nothing valid parsed — i.e. every entry was a typo. Fail CLOSED.
    // Treating this as "no restriction" would be the worst possible outcome: one mistyped id in the
    // env file would silently move EVERY account onto the new path, which is precisely the blast
    // radius this gate exists to prevent.
    if (allowlist.size === 0) {
        console.warn(
            `[asyncFinanceGate] ${allowlistKey} is set ("${raw}") but contains no valid ObjectId — ` +
            `refusing to enable for anyone. Fix the value or unset it.`
        );
        return false;
    }

    return allowlist.has(String(userId));
}

/**
 * Whether finance Step 2 (`backfillPendingExpenses`) should walk its window in date slices instead
 * of in one uninterrupted run.
 *
 *   FINANCE_STEP2_SLICING_ENABLED=true
 *   FINANCE_STEP2_USER_IDS=6a57b823571ceb9266953c30[,<more>]
 *
 * Separate from the async-report flag on purpose: they solve different problems (report queueing vs
 * worker occupancy during the pending-fee search) and want independent soak windows. Same semantics
 * and the same fail-closed behaviour on a malformed allowlist.
 *
 * @param {string|object} userId
 * @param {object} [env]
 * @returns {boolean}
 */
function financeStep2SlicingEnabledFor(userId, env = process.env) {
    return gateFor(userId, env, 'FINANCE_STEP2_SLICING_ENABLED', 'FINANCE_STEP2_USER_IDS');
}

/**
 * Whether ONE account runs the ADS + SP-API report phases (`sched_batch_1_2`, `sched_ads`,
 * `sched_ads_catchup`, `sched_batch_4`) on the async engine.
 *
 *   ADS_ASYNC_ENABLED=true
 *   ADS_ASYNC_USER_IDS=6a57b823571ceb9266953c30[,<more>]
 *
 * This exists because `ADS_ASYNC_ENABLED` was a bare `process.env` read at those four dispatch
 * points, so soak-testing the ads async path on one account meant switching four phases for EVERY
 * account simultaneously — with no way to limit the blast radius of a path that has never run in
 * production.
 *
 * NOTE the name under-sells the scope: `sched_batch_1_2` is SP-API *reports*, not ads. Anyone reading
 * only the flag name would wrongly assume SP-API reports are unaffected.
 *
 * Behaviour with no allowlist configured is EXACTLY `env.ADS_ASYNC_ENABLED === 'true'`, which is what
 * the four dispatch sites did before — so swapping them to this call changes nothing until an
 * allowlist is actually set. `asyncFinanceGate.test.js` asserts that equivalence directly.
 *
 * @param {string|object} userId
 * @param {object} [env]
 * @returns {boolean}
 */
function adsAsyncEnabledFor(userId, env = process.env) {
    return gateFor(userId, env, 'ADS_ASYNC_ENABLED', 'ADS_ASYNC_USER_IDS');
}

module.exports = {
    financeAsyncEnabledFor,
    financeStep2SlicingEnabledFor,
    adsAsyncEnabledFor,
    parseUserIdList,
};

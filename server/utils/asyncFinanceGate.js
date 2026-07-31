/**
 * asyncFinanceGate.js — decides whether ONE account runs finance sync on the non-blocking async
 * path or the inline one.
 *
 * Why this is separate from ADS_ASYNC_ENABLED
 * -------------------------------------------
 * `ADS_ASYNC_ENABLED` is a single global kill-switch read at six places in ScheduledIntegration:
 * sched_batch_1_2, sched_ads, sched_batch_4, sched_ads_catchup, sched_finance and
 * sched_finance_catchup. Flipping it to soak-test finance would also switch the ads and SP-API
 * report phases to async for EVERY account at once — including the ads `saveFromRows` path, which
 * has never executed in production (it was masked by a `ReferenceError` until recently). That is
 * far too much blast radius for validating one change on one account.
 *
 * So finance gets its own switch, plus an optional allowlist:
 *
 *   FINANCE_ASYNC_ENABLED=true
 *   FINANCE_ASYNC_USER_IDS=6a57b823571ceb9266953c30[,<more>]
 *
 * Semantics:
 *   flag not 'true'              -> false for everyone (inline; the default and the rollback)
 *   flag 'true', no/empty list   -> true for everyone (the post-soak widened state)
 *   flag 'true', list present    -> true only for ids on the list
 *
 * Deployment note: the worker calls `dotenv.config()`, so this must live in the ROOT `.env`.
 * Putting it in a PM2 `env` block does NOT work — `ecosystem.worker.config.js` does not enumerate
 * it, and PM2 only passes through the keys it lists.
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
    if (env.FINANCE_ASYNC_ENABLED !== 'true') return false;

    const raw = String(env.FINANCE_ASYNC_USER_IDS || '').trim();

    // Nothing configured at all -> no restriction. Note this must mean "everyone", not "nobody",
    // or widening the rollout would require deleting the variable rather than blanking it.
    if (raw === '') return true;

    const allowlist = parseUserIdList(raw);

    // Configured but nothing valid parsed — i.e. every entry was a typo. Fail CLOSED.
    // Treating this as "no restriction" would be the worst possible outcome: one mistyped id in the
    // env file would silently move EVERY account onto the new path, which is precisely the blast
    // radius this gate exists to prevent.
    if (allowlist.size === 0) {
        console.warn(
            `[asyncFinanceGate] FINANCE_ASYNC_USER_IDS is set ("${raw}") but contains no valid ` +
            `ObjectId — refusing to enable async finance for anyone. Fix the value or unset it.`
        );
        return false;
    }

    return allowlist.has(String(userId));
}

module.exports = { financeAsyncEnabledFor, parseUserIdList };

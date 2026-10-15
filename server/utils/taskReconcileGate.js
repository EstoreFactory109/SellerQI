/**
 * taskReconcileGate.js — which task-generation path ONE account runs.
 *
 *   TASK_RECONCILE_MODE=off|dry_run|on
 *   TASK_RECONCILE_USER_IDS=6a57b823571ceb9266953c30[,<more>]
 *
 *   off      the legacy path: insert-only within the 7-day window, wipe-and-rebuild
 *            at renewal. The default and the rollback.
 *   dry_run  the legacy path still writes; the reconcile plan is computed alongside
 *            it and only logged, so it can be read in production before it acts.
 *   on       reconcile writes (CreateTasksService.reconcileTasks).
 *
 * Allowlist semantics match asyncFinanceGate.gateFor: no list means every account;
 * a list means only those ids (everyone else is `off`); a list with no valid id
 * fails CLOSED to `off` for everyone.
 *
 * Must live in the ROOT `.env` for the worker to see it (see asyncFinanceGate.js).
 */

const { parseUserIdList } = require('./asyncFinanceGate.js');

const MODES = Object.freeze({ OFF: 'off', DRY_RUN: 'dry_run', ON: 'on' });

/**
 * @param {string|object} userId
 * @param {object} [env] - injectable for tests
 * @returns {'off'|'dry_run'|'on'}
 */
function taskReconcileModeFor(userId, env = process.env) {
    const mode = String(env.TASK_RECONCILE_MODE || '').trim().toLowerCase();
    if (mode !== MODES.DRY_RUN && mode !== MODES.ON) return MODES.OFF;

    const raw = String(env.TASK_RECONCILE_USER_IDS || '').trim();
    if (raw === '') return mode;

    const allowlist = parseUserIdList(raw);
    if (allowlist.size === 0) {
        console.warn(
            `[taskReconcileGate] TASK_RECONCILE_USER_IDS is set ("${raw}") but contains no valid ObjectId — ` +
            `keeping every account on the legacy path. Fix the value or unset it.`
        );
        return MODES.OFF;
    }

    return allowlist.has(String(userId)) ? mode : MODES.OFF;
}

module.exports = { taskReconcileModeFor, MODES };

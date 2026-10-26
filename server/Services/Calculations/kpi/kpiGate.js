/**
 * kpiGate.js — which waves of tasks-logics.xlsx tasks run for ONE account.
 *
 *   KPI_TASKS_WAVE1=true   (and KPI_TASKS_WAVE2, KPI_TASKS_WAVE3 — each wave its own switch)
 *   KPI_TASKS_USER_IDS=6a57b823571ceb9266953c30[,<more>]
 *
 * Off unless the wave's flag is exactly 'true'. The allowlist is shared by all
 * waves and has asyncFinanceGate.gateFor's semantics: unset means every account,
 * a list means only those ids, a list with no valid id fails CLOSED.
 *
 * Must live in the ROOT `.env` for the worker to see it (see asyncFinanceGate.js).
 */

const { gateFor } = require('../../../utils/asyncFinanceGate.js');

const WAVES = Object.freeze([1, 2, 3]);

/**
 * @param {number} wave
 * @param {string|object} userId
 * @param {object} [env] - injectable for tests
 * @returns {boolean}
 */
function kpiWaveEnabledFor(wave, userId, env = process.env) {
    if (!WAVES.includes(wave) || !userId) return false;
    return gateFor(userId, env, `KPI_TASKS_WAVE${wave}`, 'KPI_TASKS_USER_IDS');
}

/** @returns {number[]} the waves enabled for this account */
function enabledKpiWaves(userId, env = process.env) {
    return WAVES.filter(wave => kpiWaveEnabledFor(wave, userId, env));
}

module.exports = { kpiWaveEnabledFor, enabledKpiWaves, WAVES };

/**
 * credentialSkipGate.js — whether the daily pipeline acts on an account's missing or revoked
 * Amazon credentials, or only reports what it would do.
 *
 *   CREDENTIAL_SKIP_MODE=off|dry_run|on
 *   CREDENTIAL_SKIP_USER_IDS=6a57b823571ceb9266953c30[,<more>]
 *
 *   off      the legacy behaviour: every account is enqueued, and a service whose token is
 *            missing is recorded as a failure. The kill switch / rollback.
 *   dry_run  legacy behaviour still runs; the producer logs the accounts it would skip and
 *            finalize logs whether the day would have been stamped complete, so the effect can
 *            be counted in production before it acts.
 *   on       accounts with no usable credential are not enqueued, and services whose
 *            connection was never made are recorded as skipped rather than failed.
 *            THE DEFAULT when unset (or set to an unrecognised value, with a warning).
 *
 * Revoked-grant fields on sellerAccount are written in EVERY mode — only acting on them is gated.
 *
 * Allowlist semantics match asyncFinanceGate.gateFor: no list means every account; a list means
 * only those ids (everyone else is `off`); a list with no valid id fails CLOSED to `off`. With the
 * mode unset, a list still scopes the default `on` to those ids.
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
function credentialSkipModeFor(userId, env = process.env) {
    const requested = String(env.CREDENTIAL_SKIP_MODE || '').trim().toLowerCase();
    let mode;
    if (requested === '' || requested === MODES.ON) mode = MODES.ON;
    else if (requested === MODES.OFF) return MODES.OFF;
    else if (requested === MODES.DRY_RUN) mode = MODES.DRY_RUN;
    else {
        // A typo must not silently disable it — and must not silently mean "off" either, since
        // `off` is the kill switch someone reaching for it will type deliberately.
        console.warn(`[credentialSkipGate] CREDENTIAL_SKIP_MODE="${requested}" is not off|dry_run|on — using the default (on).`);
        mode = MODES.ON;
    }

    const raw = String(env.CREDENTIAL_SKIP_USER_IDS || '').trim();
    if (raw === '') return mode;

    const allowlist = parseUserIdList(raw);
    if (allowlist.size === 0) {
        console.warn(
            `[credentialSkipGate] CREDENTIAL_SKIP_USER_IDS is set ("${raw}") but contains no valid ObjectId — ` +
            `keeping every account on the legacy path. Fix the value or unset it.`
        );
        return MODES.OFF;
    }

    return allowlist.has(String(userId)) ? mode : MODES.OFF;
}

module.exports = { credentialSkipModeFor, MODES };

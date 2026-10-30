/**
 * Switches for changes SellerQI makes on Amazon.
 *
 *   AMAZON_WRITES_DISABLED=true     stops every change (TASK_ACTIONS_DISABLED=true too)
 *   AMAZON_ACTIONS_<FEATURE>_ENABLED=true  + optional AMAZON_ACTIONS_<FEATURE>_USER_IDS
 *                                   turns on a NEW kind of change, for an allowlist
 *                                   first (same semantics as asyncFinanceGate.gateFor)
 *
 * Changes SellerQI already made before the change-request flow (pausing keywords,
 * negatives, listing text, ...) have no flag: they keep working as before.
 */
const { gateFor } = require('../../utils/asyncFinanceGate.js');

const truthy = (v) => String(v || '').trim().toLowerCase() === 'true';

function writesDisabled(env = process.env) {
    return truthy(env.AMAZON_WRITES_DISABLED) || truthy(env.TASK_ACTIONS_DISABLED);
}

/** Whether this handler may be used for this account. */
function handlerEnabledFor(handler, userId, env = process.env) {
    if (!handler) return false;
    if (!handler.flag) return true;
    return gateFor(userId, env, `${handler.flag}_ENABLED`, `${handler.flag}_USER_IDS`);
}

module.exports = { writesDisabled, handlerEnabledFor };

/**
 * Errors a change handler throws:
 * - userError: the request itself is wrong (shown to the seller as is, HTTP 400)
 * - staleError: Amazon no longer matches what the preview showed, so nothing was sent
 */
const userError = (message) => Object.assign(new Error(message), { isUserError: true, statusCode: 400 });
const staleError = (message) => Object.assign(new Error(message), { isStale: true });

/** A send that may or may not have reached Amazon (network timeout or reset). */
const isTimeout = (error) => ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ESOCKETTIMEDOUT'].includes(error?.code)
    || /timeout|socket hang up/i.test(String(error?.message || ''));

module.exports = { userError, staleError, isTimeout };

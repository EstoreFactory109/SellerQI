/**
 * accountCredentials.js — what Amazon access ONE sellerAccount entry actually has.
 *
 * Pure: reads only the fields on the entry, never calls Amazon. The point is to decide before a
 * run is enqueued whether it can do anything at all. A run for an account with no usable
 * credential fails every token-gated service in every phase, is never stamped complete, and is
 * re-run every hourly tick up to UserSchedulingService's daily attempt cap.
 *
 *   'connected'      a refresh token is stored and no revocation is recorded
 *   'not_connected'  the seller never connected this API (or Ads has no ProfileId)
 *   'revoked'        Amazon answered `invalid_grant` on the last exchange — reconnect needed
 *
 * The Ads rule mirrors ScheduledIntegration.getSellerDataAndTokens, which nulls the Ads refresh
 * token when ProfileId is missing: without a profile no Ads call can be made.
 */

const STATES = Object.freeze({
    CONNECTED: 'connected',
    NOT_CONNECTED: 'not_connected',
    REVOKED: 'revoked',
});

/**
 * The sellerAccount fields recording a revoked grant, per credential. Every path that stores a
 * NEW refresh token must clear the matching pair, or a reconnected seller would stay skipped
 * until the next daily run happened to clear it.
 */
const REVOCATION_FIELDS = Object.freeze({
    sp: Object.freeze(['spiAuthRevokedAt', 'spiAuthRevokedReason']),
    ads: Object.freeze(['adsAuthRevokedAt', 'adsAuthRevokedReason']),
});

/** Clear the revocation pair on a hydrated sellerAccount subdocument before .save(). */
function clearRevocation(sellerAccount, which) {
    if (!sellerAccount) return;
    for (const field of REVOCATION_FIELDS[which] || []) sellerAccount[field] = undefined;
}

const present = (value) => typeof value === 'string' ? value.trim() !== '' : value != null;

function classifyAccountCredentials(sellerAccount = {}) {
    const acct = sellerAccount || {};

    let sp = STATES.CONNECTED;
    if (!present(acct.spiRefreshToken)) sp = STATES.NOT_CONNECTED;
    else if (acct.spiAuthRevokedAt) sp = STATES.REVOKED;

    let ads = STATES.CONNECTED;
    if (!present(acct.adsRefreshToken) || !present(acct.ProfileId)) ads = STATES.NOT_CONNECTED;
    else if (acct.adsAuthRevokedAt) ads = STATES.REVOKED;

    return {
        sp,
        ads,
        // An Ads-only account still has work to do, so either credential is enough.
        runnable: sp === STATES.CONNECTED || ads === STATES.CONNECTED,
    };
}

module.exports = { classifyAccountCredentials, clearRevocation, REVOCATION_FIELDS, STATES };

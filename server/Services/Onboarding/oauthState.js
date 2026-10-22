/**
 * Single-use OAuth `state` for the multi-marketplace onboarding connect flow.
 *
 * The server mints a random value, remembers who asked for it and for which Amazon region and
 * kind of connection (Seller Central or Ads), and accepts it back exactly once. The callback takes
 * the region from here, never from a cookie or the browser's storage: that is what kept the old
 * flow approving one region while saving the token against another. It also gives the callback a
 * real check that the person returning from Amazon is the one who left (the old client-side check
 * read a key nothing wrote, so it never ran).
 *
 * Same pattern as the Gmail connect flow (controllers/integration/GmailController.js).
 */
const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError.js');

const STATE_PREFIX = 'sqi:onboarding:oauth_state:';
const STATE_TTL_SECONDS = 15 * 60;
const KINDS = ['spapi', 'ads'];

const redis = () => {
    try {
        const { getRedisClient } = require('../../config/redisConn.js');
        return getRedisClient();
    } catch (_) {
        return null;
    }
};

const requireRedis = () => {
    const client = redis();
    // An unverifiable callback is exactly what state exists to prevent, so a missing store
    // fails the connect rather than proceeding without one.
    if (!client) throw new ApiError(503, 'Cannot connect Amazon right now: the state store is unavailable');
    return client;
};

/**
 * @param {{userId: string, kind: 'spapi'|'ads', region: 'NA'|'EU'|'FE', primaryCountry?: string}} payload
 *   primaryCountry: the main marketplace the seller picked, sent with their first region's approval
 * @returns {Promise<string>} the state value to send to Amazon
 */
const createState = async ({ userId, kind, region, primaryCountry = null }) => {
    const client = requireRedis();
    const state = crypto.randomBytes(32).toString('hex');
    await client.setEx(`${STATE_PREFIX}${state}`, STATE_TTL_SECONDS, JSON.stringify({
        userId: String(userId),
        kind,
        region,
        primaryCountry,
    }));
    return state;
};

/**
 * Accepts a state once. Returns its payload, or null when it is unknown, expired, already used,
 * minted for another user, or for the other kind of connection.
 */
const consumeState = async (state, { userId, kind }) => {
    if (typeof state !== 'string' || !/^[0-9a-f]{64}$/.test(state)) return null;
    const client = requireRedis();
    const key = `${STATE_PREFIX}${state}`;

    // GETDEL where available, so two simultaneous callbacks cannot both accept it.
    const raw = typeof client.getDel === 'function'
        ? await client.getDel(key)
        : await client.get(key).then(async (value) => { if (value) await client.del(key); return value; });
    if (!raw) return null;

    let payload;
    try { payload = JSON.parse(raw); } catch (_) { return null; }
    if (payload.userId !== String(userId) || payload.kind !== kind) return null;
    return payload;
};

module.exports = { createState, consumeState, KINDS, STATE_TTL_SECONDS };

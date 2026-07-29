/**
 * authCache.js — cross-phase caching for Amazon access tokens + AWS STS credentials.
 *
 * Motivation: the scheduled daily pipeline runs 8–9 separate phase-jobs per account per
 * day, and each phase independently re-generated SP-API/Ads access tokens (LWA OAuth) and
 * AWS STS temporary credentials from scratch — even though all are valid for ~60 minutes
 * and a full run finishes well inside that window. This cache lets phases reuse a token/cred
 * instead of regenerating it, cutting ~90% of the redundant OAuth/STS calls.
 *
 * SAFETY / "same data" guarantees:
 *  - Access tokens are cached in the shared cache Redis (config/redisConn.js), keyed by a
 *    hash of the *refresh token* — so a reconnect (new refresh token) or a different
 *    region/account naturally produces a different key (never a stale cross-account hit).
 *  - TTL is 50 min, strictly below Amazon's 60 min token expiry, so any served token is
 *    always still valid. A revoked grant fails identically with or without this cache.
 *  - Write-through: the low-level generators repopulate the cache whenever they generate a
 *    fresh token (incl. the 401-driven refresh callbacks), so a stale entry never survives a
 *    refresh — this is the "invalidate on 401" behaviour.
 *  - Fail-open: any Redis error (down / not connected) is swallowed and treated as a cache
 *    miss, so behaviour degrades to exactly the current (uncached) path — never a data change.
 *  - STS temporary credentials contain AWS secret keys, so they are cached ONLY in-process
 *    (a Map with TTL), never written to the shared external Redis.
 */

const crypto = require('crypto');
const logger = require('./Logger.js');

const TOKEN_TTL_SECONDS = 3000;          // 50 min — below Amazon's 3600s token expiry
const STS_TTL_MS = 50 * 60 * 1000;       // 50 min — below STS DurationSeconds (3600)

function keyFor(kind, refreshToken) {
    const hash = crypto.createHash('sha256').update(String(refreshToken)).digest('hex');
    return `sqi:tok:${kind}:${hash}`;
}

// Lazily grab the already-initialised cache Redis client. Returns null if unavailable
// (not connected / module error) so callers fall back to a plain cache-miss.
function tryGetRedis() {
    try {
        const { getRedisClient } = require('../config/redisConn.js');
        return getRedisClient();
    } catch (_) {
        return null;
    }
}

/**
 * Read a cached access token. kind: 'sp' | 'ads'. Returns the token string or null.
 * Never throws — any error is a cache miss.
 */
async function getToken(kind, refreshToken) {
    if (!refreshToken) return null;
    const client = tryGetRedis();
    if (!client) return null;
    try {
        const val = await client.get(keyFor(kind, refreshToken));
        return val || null;
    } catch (err) {
        logger.warn(`[authCache] getToken(${kind}) miss due to error: ${err.message}`);
        return null;
    }
}

/**
 * Write-through: store a freshly generated access token. Never throws.
 */
async function setToken(kind, refreshToken, token) {
    if (!refreshToken || !token) return;
    const client = tryGetRedis();
    if (!client) return;
    try {
        await client.setEx(keyFor(kind, refreshToken), TOKEN_TTL_SECONDS, token);
    } catch (err) {
        logger.warn(`[authCache] setToken(${kind}) failed (non-fatal): ${err.message}`);
    }
}

/**
 * Explicitly drop a cached token (e.g. on a detected auth failure). Never throws.
 */
async function invalidateToken(kind, refreshToken) {
    if (!refreshToken) return;
    const client = tryGetRedis();
    if (!client) return;
    try {
        await client.del(keyFor(kind, refreshToken));
    } catch (err) {
        logger.warn(`[authCache] invalidateToken(${kind}) failed (non-fatal): ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// In-process STS temporary-credential cache (secrets stay off external Redis).
// ---------------------------------------------------------------------------
const _stsCache = new Map(); // key -> { credentials, expiresAt }

function _stsKey(regionConfig) {
    try {
        return typeof regionConfig === 'string' ? regionConfig : JSON.stringify(regionConfig);
    } catch (_) {
        return String(regionConfig);
    }
}

function getCredentials(regionConfig) {
    const entry = _stsCache.get(_stsKey(regionConfig));
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
        _stsCache.delete(_stsKey(regionConfig));
        return null;
    }
    return entry.credentials;
}

function setCredentials(regionConfig, credentials) {
    if (!credentials) return;
    _stsCache.set(_stsKey(regionConfig), { credentials, expiresAt: Date.now() + STS_TTL_MS });
}

module.exports = {
    getToken,
    setToken,
    invalidateToken,
    getCredentials,
    setCredentials,
    TOKEN_TTL_SECONDS,
    STS_TTL_MS,
};

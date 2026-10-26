/**
 * Which marketplaces a user owns, and whether a requested one is among them.
 *
 * ── WHY THIS EXISTS ──
 * The app used to know only one marketplace per session: the signed IBEXLocationToken cookie.
 * Pages now name the marketplace they want on each request (the X-Marketplace header, see
 * getLocation.js), so the server has to check every such request against the user's own
 * Seller record. Without the check, a hand-written header would read — and fill the Redis
 * cache with — another seller's data.
 *
 * The list is cached in process memory for a minute: getLocation runs on almost every API
 * call, and the Seller document rarely changes. Anything that connects or disconnects a
 * marketplace calls invalidateMarketplaceAccess so the change is visible immediately.
 */
const Seller = require('../models/user-auth/sellerCentralModel.js');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // userId -> { at, list }

const REGIONS = new Set(['NA', 'EU', 'FE']);
const HEADER_PATTERN = /^([A-Z]{2}):(NA|EU|FE)$/;

/**
 * Every marketplace on the user's Seller record, in connection order, once each.
 * `isConnected` mirrors the navbar's rule: an SP-API refresh token is present.
 */
const listOwnedMarketplaces = async (userId) => {
    if (!userId) return [];
    const key = String(userId);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.list;

    const seller = await Seller.findOne({ User: userId })
        .select('sellerAccount.country sellerAccount.region sellerAccount.spiRefreshToken')
        .lean();

    const seen = new Set();
    const list = [];
    for (const account of seller?.sellerAccount || []) {
        const country = String(account.country || '').toUpperCase();
        const region = String(account.region || '').toUpperCase();
        if (!country || !REGIONS.has(region)) continue;
        const id = `${country}:${region}`;
        if (seen.has(id)) continue;
        seen.add(id);
        list.push({ country, region, isConnected: Boolean(account.spiRefreshToken && String(account.spiRefreshToken).trim()) });
    }

    cache.set(key, { at: Date.now(), list });
    return list;
};

const ownsMarketplace = async (userId, country, region) => {
    if (!userId || !country || !region) return false;
    const c = String(country).toUpperCase();
    const r = String(region).toUpperCase();
    return (await listOwnedMarketplaces(userId)).some((m) => m.country === c && m.region === r);
};

/** The user's first connected marketplace, else the first one on record, else null. */
const primaryMarketplace = async (userId) => {
    const list = await listOwnedMarketplaces(userId);
    const pick = list.find((m) => m.isConnected) || list[0];
    return pick ? { country: pick.country, region: pick.region } : null;
};

const invalidateMarketplaceAccess = (userId) => {
    if (userId) cache.delete(String(userId));
};

/**
 * Express middleware for routes that connect or disconnect a marketplace: drops the user's cached
 * marketplace list once the response has gone out, so a page can select the new marketplace
 * straight away instead of being refused for up to a minute.
 */
const invalidateMarketplaceAccessAfter = (req, res, next) => {
    res.on('finish', () => invalidateMarketplaceAccess(req.userId));
    next();
};

/**
 * Parses an explicit marketplace such as "UK:EU" (case-insensitive).
 * Returns { country, region } or null when the value is malformed.
 */
const parseMarketplaceHeader = (value) => {
    if (typeof value !== 'string') return null;
    const match = HEADER_PATTERN.exec(value.trim().toUpperCase());
    return match ? { country: match[1], region: match[2] } : null;
};

module.exports = {
    listOwnedMarketplaces,
    ownsMarketplace,
    primaryMarketplace,
    invalidateMarketplaceAccess,
    invalidateMarketplaceAccessAfter,
    parseMarketplaceHeader,
    // exported for tests
    _cache: cache,
};

const {ApiError}=require('../../utils/ApiError');
const asyncHandler = require('../../utils/AsyncHandler');
const logger = require('../../utils/Logger');
const { ApiResponse } = require('../../utils/ApiResponse');
const {verifyLocationToken}=require('../../utils/Tokens');
const User = require('../../models/user-auth/userModel.js');

const { parseMarketplaceHeader, ownsMarketplace, primaryMarketplace } = require('../../utils/marketplaceAccess.js');

/**
 * Works out which marketplace a request is about.
 *
 * ── ORDER ──
 *   1. An explicit X-Marketplace header ("UK:EU"), or ?marketplace= on a GET (links, PDFs).
 *      Pages send this so each one can show its own marketplace. It must name one of the
 *      user's own marketplaces: malformed → 400, not owned → 403. It never silently falls
 *      back, because the page would then show one marketplace's data under another's label.
 *   2. The IBEXLocationToken cookie — exactly what every route used before pages sent (1).
 *   3. The user's saved preferredMarketplace (set by the page switchers), if still owned.
 *   4. The user's primary marketplace.
 *
 * Steps 3-4 only run when there is neither a header nor a cookie, so normal traffic costs no
 * extra database reads. They need req.userId, i.e. `auth` running first; without it they are
 * skipped and the old "no cookie" answer stands.
 *
 * Returns { country, region, source } or { error: { status, message } } or null (nothing found).
 * Setting req.country/req.region here — before analyseDataCache runs — is what keeps every
 * cached response keyed to the marketplace actually requested.
 */
const resolveLocation = async (req, { strictCookie = true } = {}) => {
    const rawHeader = req.headers?.['x-marketplace']
        ?? (req.method === 'GET' ? req.query?.marketplace : undefined);

    if (rawHeader !== undefined && rawHeader !== null && String(rawHeader).trim() !== '') {
        const parsed = parseMarketplaceHeader(String(rawHeader));
        if (!parsed) return { error: { status: 400, message: 'Invalid marketplace' } };
        if (!req.userId || !(await ownsMarketplace(req.userId, parsed.country, parsed.region))) {
            return { error: { status: 403, message: 'Marketplace not connected to this account' } };
        }
        return { ...parsed, source: 'explicit' };
    }

    const locationtoken = req.cookies?.IBEXLocationToken;
    if (locationtoken) {
        const decoded = await verifyLocationToken(locationtoken);
        if (decoded) return { country: decoded.country, region: decoded.region, source: 'cookie' };
        if (strictCookie) return { error: { status: 400, message: 'Invalid location token' } };
        logger.warn('[getLocationOptional] ignoring an unreadable location token');
    }

    if (!req.userId) return null;

    try {
        const user = await User.findById(req.userId).select('preferredMarketplace').lean();
        const pref = user?.preferredMarketplace;
        if (pref?.country && pref?.region && await ownsMarketplace(req.userId, pref.country, pref.region)) {
            return { country: pref.country, region: pref.region, source: 'preference' };
        }
        const primary = await primaryMarketplace(req.userId);
        if (primary) return { ...primary, source: 'primary' };
    } catch (err) {
        logger.warn(`[getLocation] fallback lookup failed for ${req.userId}: ${err.message}`);
    }
    return null;
};

const apply = (req, location) => {
    req.country = location.country;
    req.region = location.region;
    req.marketplaceSource = location.source;
};

const getLocation=asyncHandler(async(req,res,next)=>{
    const location = await resolveLocation(req);

    if (location?.error) {
        logger.error(new ApiError(location.error.status, location.error.message));
        return res.status(location.error.status).json(new ApiResponse(location.error.status, "", location.error.message));
    }
    if (!location) {
        logger.error(new ApiError(401,"Unauthorized"));
        return res.status(401).json(new ApiResponse(401,"","Unauthorized"));
    }

    apply(req, location);
    next();
})

/**
 * The same marketplace lookup, but a missing cookie is not an error.
 *
 * ── WHY THIS EXISTS ──
 * `getLocation` answers 401 when there is no IBEXLocationToken, which is right for a route
 * whose data is marketplace-scoped and wrong for one that merely wants a cache key. The ESF
 * reports routes were the latter — their own comment in pageWiseData.routes.js says so — and
 * the 401 made Reports the only client-facing ESF page that hard-failed for a brand-new
 * client, who has no marketplace yet because createEsfClient never minted the cookie.
 *
 * Deleting the middleware from those routes would have been simpler and worse: analyseDataCache
 * keys on req.country/req.region, so every client would have lost a 10-minute cache over a
 * fan-out that touches eight collections. This keeps the cache for everyone who has a
 * marketplace and lets everyone else through uncached.
 *
 * A caller that genuinely NEEDS a marketplace must therefore handle both fields being
 * undefined — it can no longer assume the middleware guaranteed them.
 */
const getLocationOptional = asyncHandler(async (req, res, next) => {
    const location = await resolveLocation(req, { strictCookie: false });
    // An explicit marketplace that is malformed or not the user's is still refused: "optional"
    // means the caller may name none, not that it may name someone else's.
    if (location?.error) {
        return res.status(location.error.status).json(new ApiResponse(location.error.status, "", location.error.message));
    }
    if (location) apply(req, location);
    return next();
});

/**
 * The cookie alone, for destructive routes (e.g. deleting stored tokens). A header or a stale URL
 * parameter must never be what decides which marketplace's data gets removed.
 */
const getLocationCookieOnly = asyncHandler(async (req, res, next) => {
    const locationtoken = req.cookies?.IBEXLocationToken;
    const decoded = locationtoken ? await verifyLocationToken(locationtoken) : null;
    if (!decoded) {
        return res.status(401).json(new ApiResponse(401, "", "Unauthorized"));
    }
    req.country = decoded.country;
    req.region = decoded.region;
    req.marketplaceSource = 'cookie';
    return next();
});

module.exports = { getLocation, getLocationOptional, getLocationCookieOnly, resolveLocation };

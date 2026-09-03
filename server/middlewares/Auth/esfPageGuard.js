const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const UserModel = require('../../models/user-auth/userModel.js');
const { verifyAccessToken } = require('../../utils/Tokens.js');
const { isEsfOwner } = require('../../Services/User/esfRoles.js');
const { pageKeyForApiPath, isPageDeniedFor } = require('../../Services/User/esfPages.js');
const logger = require('../../utils/Logger.js');

/**
 * Enforce per-member page permissions for ESF clients.
 *
 * Mounted in front of the data routes rather than baked into each controller,
 * so hiding a page in the sidebar and blocking its data are the same decision.
 *
 * Only engages when ALL of these hold:
 *   - an ESFToken cookie is present (a staff member is driving this session)
 *   - the account being viewed is an ESF client
 *   - the request maps to a restrictable page
 *   - that page is on the staff member's blocklist
 *
 * Everything else falls through untouched, so agency clients, self-serve
 * sellers and shared endpoints (navbar, profile, location) are unaffected and
 * cannot be broken by a misconfigured blocklist.
 */
const esfPageGuard = asyncHandler(async (req, res, next) => {
    const esfToken = req.cookies?.ESFToken;
    if (!esfToken) return next();

    // Which page is this request for? Shared infrastructure returns null.
    const pageKey = pageKeyForApiPath(req.baseUrl ? `${req.baseUrl}${req.path}` : req.originalUrl);
    if (!pageKey) return next();

    const decoded = await verifyAccessToken(esfToken);
    if (!decoded || !decoded.isvalid) return next(); // stale cookie — not our problem here

    const staff = await UserModel.findById(decoded.tokenData).select('accessType esfRole esfDeniedPages email');
    if (!staff || staff.accessType !== 'esfUser') return next();

    // The restriction is scoped to ESF clients only.
    //
    // This middleware is mounted with app.use(), so it runs BEFORE each route's
    // own `auth` — req.userId is not populated yet. Resolve the viewed account
    // from the access-token cookie directly instead of relying on it, otherwise
    // the guard silently falls through and never blocks anything.
    const accessToken = req.cookies?.IBEXAccessToken;
    if (!accessToken) return next();

    const viewedToken = await verifyAccessToken(accessToken);
    if (!viewedToken || !viewedToken.isvalid) return next();

    const viewed = await UserModel.findById(viewedToken.tokenData).select('isEsfClient');
    if (!viewed?.isEsfClient) return next();

    if (isPageDeniedFor(staff, pageKey, { isOwner: isEsfOwner(staff) })) {
        logger.warn(`ESF staff ${staff.email} blocked from page "${pageKey}" for client ${viewed._id}`);
        return res
            .status(403)
            .json(new ApiResponse(403, { pageKey }, 'You do not have access to this page for this client'));
    }

    return next();
});

module.exports = esfPageGuard;

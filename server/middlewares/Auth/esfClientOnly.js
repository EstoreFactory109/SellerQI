const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const UserModel = require('../../models/user-auth/userModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Gate for ESF-only pages that live INSIDE a client's own account
 * (e.g. /seller-central-checker/client-dashboard).
 *
 * Runs after `auth`, so req.userId is the account currently being viewed —
 * which, for an ESF client, is only ever reachable by staff impersonation via
 * POST /app/esf/clients/switch (ESF clients have no password and are blocked
 * from /app/login).
 *
 * ── A PLATFORM superAdmin IS NOT ADMITTED, AND THAT IS NOT A GAP ──
 * It reads like one, so: `req.userId` is the account BEING VIEWED. Servicing a real ESF
 * client goes through the switch above, which mints a session as that client — so the
 * viewed account is an ESF client and passes on `isEsfClient` alone. The superAdmin
 * clause that used to sit here therefore only ever fired for an admin looking at their
 * OWN account, where the ESF pages describe an agency relationship that does not exist.
 * Showing them there was misleading, so it went.
 */
const esfClientOnly = asyncHandler(async (req, res, next) => {
    if (!req.userId) {
        return res.status(401).json(new ApiResponse(401, '', 'Authentication required'));
    }

    const user = await UserModel.findById(req.userId).select('isEsfClient');
    if (!user) {
        return res.status(401).json(new ApiResponse(401, '', 'User not found'));
    }

    if (user.isEsfClient !== true) {
        logger.warn(`User ${req.userId} attempted to access an ESF-only client page`);
        return res.status(403).json(new ApiResponse(403, '', 'This page is not available for this account'));
    }

    next();
});

module.exports = esfClientOnly;

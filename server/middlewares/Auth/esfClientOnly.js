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
 * Allowing superAdmin through keeps platform admins able to service the page.
 */
const esfClientOnly = asyncHandler(async (req, res, next) => {
    if (!req.userId) {
        return res.status(401).json(new ApiResponse(401, '', 'Authentication required'));
    }

    const user = await UserModel.findById(req.userId).select('isEsfClient accessType');
    if (!user) {
        return res.status(401).json(new ApiResponse(401, '', 'User not found'));
    }

    const allowed = user.isEsfClient === true || user.accessType === 'superAdmin';
    if (!allowed) {
        logger.warn(`User ${req.userId} attempted to access an ESF-only client page`);
        return res.status(403).json(new ApiResponse(403, '', 'This page is not available for this account'));
    }

    next();
});

module.exports = esfClientOnly;

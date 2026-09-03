const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { verifyAccessToken } = require('../../utils/Tokens.js');
const UserModel = require('../../models/user-auth/userModel.js');
const logger = require('../../utils/Logger.js');

/**
 * ESF staff portal auth.
 *
 * Follows the superAdminAuth pattern deliberately: a single dedicated cookie,
 * with no dependency on IBEXAccessToken. That decoupling is what lets a staff
 * member impersonate a client (which replaces the IBEX* cookies) and still be
 * recognised by this portal afterwards.
 *
 * Sets req.esfUserId.
 */
const esfAuth = asyncHandler(async (req, res, next) => {
    const esfToken = req.cookies.ESFToken;

    if (!esfToken) {
        logger.error(new ApiError(401, 'ESF token required'));
        return res.status(401).json(new ApiResponse(401, '', 'ESF token required'));
    }

    const decoded = await verifyAccessToken(esfToken);
    if (!decoded || !decoded.isvalid) {
        logger.error(new ApiError(401, 'Invalid or expired ESF token'));
        return res.status(401).json(new ApiResponse(401, '', 'Invalid or expired ESF token'));
    }

    // Re-check the role on every request so revoking access takes effect
    // immediately rather than when the 15-day token happens to expire.
    const user = await UserModel.findById(decoded.tokenData).select('accessType firstName lastName email phone');
    if (!user) {
        logger.error(new ApiError(401, 'ESF user not found'));
        return res.status(401).json(new ApiResponse(401, '', 'ESF user not found'));
    }

    // superAdmin is allowed through so platform admins can service the portal.
    if (!['esfUser', 'superAdmin'].includes(user.accessType)) {
        logger.warn(`User ${user._id} attempted to access an ESF endpoint without permission`);
        return res.status(403).json(new ApiResponse(403, '', 'ESF portal access required'));
    }

    req.esfUserId = user._id;
    req.esfUser = user;
    next();
});

module.exports = esfAuth;

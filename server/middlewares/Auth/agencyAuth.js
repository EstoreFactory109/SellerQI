const { verifyAccessToken } = require('../../utils/Tokens');
const asyncHandler = require('../../utils/AsyncHandler');
const logger = require('../../utils/Logger');
const { ApiResponse } = require('../../utils/ApiResponse');

/**
 * Agency-only auth middleware.
 * Authenticates using AdminToken cookie (agency owner's token).
 * Does NOT require IBEXAccessToken or IBEXLocationToken.
 * Sets req.adminId to the agency owner's userId.
 *
 * If IBEXAccessToken is also present and valid, sets req.userId as well
 * (for backward compatibility), but it is not required.
 */
const agencyAuth = asyncHandler(async (req, res, next) => {
    const adminToken = req.cookies.AdminToken;
    const accessToken = req.cookies.IBEXAccessToken;

    if (!adminToken) {
        logger.error('agencyAuth: AdminToken cookie missing');
        return res.status(401).json(new ApiResponse(401, "", "Agency admin token is required"));
    }

    const decodedAdmin = await verifyAccessToken(adminToken);
    if (!decodedAdmin || !decodedAdmin.isvalid) {
        logger.error('agencyAuth: AdminToken invalid or expired');
        return res.status(401).json(new ApiResponse(401, "", "Agency admin token is invalid or expired"));
    }

    req.adminId = decodedAdmin.tokenData;

    if (accessToken) {
        const decoded = await verifyAccessToken(accessToken);
        if (decoded && decoded.isvalid) {
            req.userId = decoded.tokenData;
        }
    }

    next();
});

module.exports = agencyAuth;

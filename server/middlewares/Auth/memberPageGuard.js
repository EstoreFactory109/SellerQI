const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const AccountMember = require('../../models/user-auth/AccountMemberModel.js');
const { verifyAccessToken } = require('../../utils/Tokens.js');
const { pageKeyForApiPath, sanitizeDeniedPages } = require('../../Services/User/esfPages.js');
const logger = require('../../utils/Logger.js');

/**
 * Enforce a seller-account member's page access (set on the owner's Add member
 * page). Mounted next to esfPageGuard, in front of the same data routes, so hiding
 * a page in the sidebar and refusing its data are the same decision.
 *
 * Engages only when the request carries a MEMBER's token (the owner's own token
 * names no member - see utils/Tokens.js) and maps to a restrictable page.
 * Everything else, including shared endpoints, falls straight through.
 *
 * Runs before each route's own `auth`, so it reads the token itself.
 */
const memberPageGuard = asyncHandler(async (req, res, next) => {
    const accessToken = req.cookies?.IBEXAccessToken;
    if (!accessToken) return next();

    const pageKey = pageKeyForApiPath(req.baseUrl ? `${req.baseUrl}${req.path}` : req.originalUrl);
    if (!pageKey) return next();

    const decoded = await verifyAccessToken(accessToken);
    if (!decoded || !decoded.isvalid || !decoded.memberId) return next();

    const member = await AccountMember.findOne({ _id: decoded.memberId, owner: decoded.tokenData })
        .select('deniedPages email')
        .lean();
    // A removed member is refused by `auth` itself; nothing to add here.
    if (!member) return next();

    if (sanitizeDeniedPages(member.deniedPages).includes(pageKey)) {
        logger.warn(`Member ${member.email} blocked from page "${pageKey}" on account ${decoded.tokenData}`);
        return res
            .status(403)
            .json(new ApiResponse(403, { pageKey }, 'You do not have access to this page'));
    }

    return next();
});

module.exports = memberPageGuard;

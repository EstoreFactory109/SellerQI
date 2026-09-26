const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');

/**
 * After `auth`, on endpoints that change the account OWNER's own details (name,
 * phone, photo, email addresses, password). A member signed in to the account
 * (req.memberId, see middlewares/Auth/auth.js) can use everything else, but these
 * describe the owner as a person, so only the owner may change them.
 */
const ownerOnly = (req, res, next) => {
    if (!req.memberId) return next();
    logger.warn(`Member ${req.memberId} tried to change owner details on account ${req.userId}: ${req.method} ${req.originalUrl}`);
    return res.status(403).json(new ApiResponse(403, '', "Only the account owner can change the owner's details"));
};

module.exports = ownerOnly;

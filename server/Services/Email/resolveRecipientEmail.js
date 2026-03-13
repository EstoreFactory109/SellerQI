const User = require('../../models/user-auth/userModel.js');
const logger = require('../../utils/Logger.js');

/**
 * If the user is an agency client (isAgencyClient === true && agencyId is set),
 * returns the agency owner's email. Otherwise returns the original email unchanged.
 *
 * Looks up the user by userId when provided, or falls back to an email-based
 * lookup (email is unique in the User model) so callers that don't have userId
 * still get the correct agency redirect.
 *
 * @param {string} email - The user's own email (fallback)
 * @param {string|null} userId - The user's _id (optional — email lookup used when absent)
 * @returns {Promise<string>} Resolved email address
 */
async function resolveRecipientEmail(email, userId = null) {
    if (!email) return email;

    try {
        let user;
        if (userId) {
            user = await User.findById(userId).select('isAgencyClient agencyId').lean();
        } else {
            user = await User.findOne({ email: email.toLowerCase().trim() }).select('isAgencyClient agencyId').lean();
        }

        if (user && user.isAgencyClient === true && user.agencyId) {
            const agency = await User.findById(user.agencyId).select('email').lean();
            if (agency && agency.email) {
                logger.info(`[resolveRecipientEmail] Redirecting email for agency client ${userId || email} → agency ${agency.email}`);
                return agency.email;
            }
        }
    } catch (err) {
        logger.warn(`[resolveRecipientEmail] Failed to resolve agency email for ${userId || email}, using original: ${err.message}`);
    }

    return email;
}

module.exports = { resolveRecipientEmail };

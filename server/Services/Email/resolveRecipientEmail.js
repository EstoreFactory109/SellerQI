const User = require('../../models/user-auth/userModel.js');
const logger = require('../../utils/Logger.js');
const { getMailRecipients, normalizeEmail } = require('../User/emailAccounts.js');

/**
 * Work out who a given email should actually be delivered to.
 *
 * Every email sender in the app already funnels through here, so this is the
 * one place that needs to know about multiple addresses. It returns a
 * comma-separated list, which nodemailer accepts wherever a single address was
 * accepted before — so all existing callers keep working unchanged.
 *
 * Two behaviours, in order:
 *   1. Agency clients still redirect to their agency owner (unchanged).
 *   2. The resolved user's mail then fans out to every address they have
 *      verified and left switched on.
 *
 * @param {string} email  - The user's own email (also the fallback)
 * @param {string|null} userId - The user's _id (optional; email lookup used when absent)
 * @param {object} [options]
 * @param {boolean} [options.agencyRedirect=true] When false, never redirect to
 *   the agency owner. Used when a message is about one specific address (an
 *   address-verification code), which must reach that address and nowhere else.
 * @param {boolean} [options.fanOut=true] When false, deliver to `email` alone.
 *   Used for password-reset links, which must reach the exact address the user
 *   typed even if that address has been muted — otherwise muting an address
 *   would quietly remove it as a recovery route.
 * @returns {Promise<string>} One address, or several joined by ", "
 */
async function resolveRecipientEmail(email, userId = null, options = {}) {
    const { fanOut = true, agencyRedirect = true } = options;
    if (!email) return email;

    // Nothing to resolve — the caller wants this exact address.
    if (!fanOut && !agencyRedirect) return email;

    try {
        let user;
        if (userId) {
            user = await User.findById(userId)
                .select('isAgencyClient agencyId email additionalEmails primaryReceivesMail')
                .lean();
        } else {
            // Match any address the user owns, so a send addressed to a
            // secondary address still resolves to the right account.
            const normalized = normalizeEmail(email);
            user = await User.findOne({
                $or: [
                    { email: normalized },
                    { additionalEmails: { $elemMatch: { email: normalized, isVerified: true } } },
                ],
            })
                .select('isAgencyClient agencyId email additionalEmails primaryReceivesMail')
                .lean();
        }

        // Agency clients: their mail belongs to the agency owner.
        if (agencyRedirect && user && user.isAgencyClient === true && user.agencyId) {
            const agency = await User.findById(user.agencyId)
                .select('email additionalEmails primaryReceivesMail')
                .lean();
            if (agency && agency.email) {
                logger.info(`[resolveRecipientEmail] Redirecting email for agency client ${userId || email} → agency ${agency.email}`);
                if (!fanOut) return agency.email;
                const agencyRecipients = getMailRecipients(agency);
                return agencyRecipients.length ? agencyRecipients.join(', ') : agency.email;
            }
        }

        if (!fanOut) return email;

        if (user) {
            const recipients = getMailRecipients(user);
            // Everything muted — fall back to the address we were given rather
            // than returning nothing and having the send fail with no recipient.
            if (recipients.length) return recipients.join(', ');
        }
    } catch (err) {
        logger.warn(`[resolveRecipientEmail] Failed to resolve recipients for ${userId || email}, using original: ${err.message}`);
    }

    return email;
}

module.exports = { resolveRecipientEmail };

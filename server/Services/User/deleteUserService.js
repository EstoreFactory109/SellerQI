/**
 * Delete User Service
 *
 * Removes a user's Amazon connection and operational data. There are two
 * delete modes, chosen by the caller via the `hardDelete` option:
 *
 * SOFT (default) — used by the automated six-month inactivity cleanup.
 *   - All Seller documents (Amazon SP-API/Ads tokens, product catalog) deleted.
 *   - The User document's dangling refs into collections that
 *     fullUserDataPurgeService is about to purge are cleared.
 *   - purgedAt is stamped on the User document.
 *   - email/password/name are left untouched, so the person can still log
 *     back in later and reconnect their Amazon accounts.
 *
 * HARD (`{ hardDelete: true }`) — used by the admin's manual delete only.
 *   - Same Seller deletion, then the User document itself is removed.
 *   - The account is gone: the person cannot log in, and the email is freed
 *     for a fresh signup.
 *
 * Billing history (Subscription + PaymentLogs) is kept on the soft path and removed
 * on the hard path. That deletion happens in fullUserDataPurgeService, driven by its
 * `includeBillingHistory` option, which the admin route sets when it enqueues.
 */

const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');

// Refs on the User document that point into collections fullUserDataPurgeService
// deletes. Cleared on purge so they don't dangle.
const DANGLING_REF_FIELDS = {
    sellerCentral: 1,
    APlusContent: 1,
    numberOfProductReviews: 1,
    restockInventoryRecommendations: 1,
    GET_FBA_INVENTORY_PLANNING_DATA: 1,
    GET_V2_SELLER_PERFORMANCE_REPORT: 1,
    listFinancialEvents: 1,
};

/**
 * Delete all Seller documents for a user, returning how many were removed.
 * @param {string} userId
 * @returns {Promise<number>}
 */
const deleteSellerDocumentsForUser = async (userId) => {
    const sellerDocuments = await Seller.find({ User: userId });
    let sellerDocumentsDeleted = 0;
    for (const sellerDoc of sellerDocuments) {
        await Seller.findByIdAndDelete(sellerDoc._id);
        sellerDocumentsDeleted++;
    }
    return sellerDocumentsDeleted;
};

/**
 * Purge a user's Seller data and mark the account purged, by email.
 * @param {string} email - User email address
 * @returns {Object} - Result object with success status and details
 */
const deleteUserByEmail = async (email) => {
    try {
        if (!email || typeof email !== 'string') {
            throw new ApiError(400, "Email is required and must be a string");
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new ApiError(400, "Invalid email format");
        }

        const user = await User.findOne({ email: email.toLowerCase().trim() });

        if (!user) {
            throw new ApiError(404, "User not found with the provided email");
        }

        const userId = user._id;
        const userName = `${user.firstName} ${user.lastName}`;

        const sellerDocumentsDeleted = await deleteSellerDocumentsForUser(userId);

        await User.findByIdAndUpdate(userId, {
            $set: { purgedAt: new Date() },
            $unset: DANGLING_REF_FIELDS,
        });

        logger.info(`User purged (data cleared, account retained): ${email} (${userId})`, {
            email,
            userId,
            userName,
            sellerDocumentsDeleted
        });

        return {
            success: true,
            message: "Seller documents and operational data removed. User account retained.",
            data: {
                email,
                userId,
                userName,
                sellerDocumentsDeleted
            }
        };

    } catch (error) {
        logger.error(`Error deleting user by email: ${error.message}`, {
            error: error.message,
            stack: error.stack,
            email: email
        });

        if (error instanceof ApiError) {
            throw error;
        }

        throw new ApiError(500, `Error deleting user: ${error.message}`);
    }
};

/**
 * Delete a user's Seller data, then either mark the account purged (soft) or
 * remove the account outright (hard). See the module header for the two modes.
 * @param {string} userId - User ID
 * @param {{ hardDelete?: boolean }} [options] - hardDelete removes the User document
 * @returns {Object} - Result object with success status and details
 */
const deleteUserById = async (userId, options = {}) => {
    const { hardDelete = false } = options;
    try {
        if (!userId) {
            throw new ApiError(400, "User ID is required");
        }

        const user = await User.findById(userId);

        if (!user) {
            throw new ApiError(404, "User not found with the provided ID");
        }

        const email = user.email;
        const userName = `${user.firstName} ${user.lastName}`;

        // An agency owner's clients point at them via agencyId (or the legacy
        // adminId — switchToClient still accepts either). Removing the owner document
        // would leave those clients pointing at nothing, so refuse instead of
        // silently orphaning them.
        if (hardDelete) {
            const dependentClients = await User.countDocuments({
                $or: [{ agencyId: userId }, { adminId: userId }],
            });
            if (dependentClients > 0) {
                throw new ApiError(
                    409,
                    `This agency still has ${dependentClients} client account(s). Remove or reassign them before deleting the agency.`
                );
            }
        }

        const sellerDocumentsDeleted = await deleteSellerDocumentsForUser(userId);

        if (hardDelete) {
            await User.findByIdAndDelete(userId);
        } else {
            await User.findByIdAndUpdate(userId, {
                $set: { purgedAt: new Date() },
                $unset: DANGLING_REF_FIELDS,
            });
        }

        const message = hardDelete
            ? "Seller documents, operational data and the user account were removed."
            : "Seller documents and operational data removed. User account retained.";

        logger.info(
            hardDelete
                ? `User hard-deleted (account removed): ${email} (${userId})`
                : `User purged (data cleared, account retained): ${email} (${userId})`,
            { email, userId, userName, sellerDocumentsDeleted, hardDelete }
        );

        return {
            success: true,
            message,
            data: {
                email,
                userId,
                userName,
                sellerDocumentsDeleted,
                hardDelete
            }
        };

    } catch (error) {
        logger.error(`Error deleting user by ID: ${error.message}`, {
            error: error.message,
            stack: error.stack,
            userId: userId
        });

        if (error instanceof ApiError) {
            throw error;
        }

        throw new ApiError(500, `Error deleting user: ${error.message}`);
    }
};

module.exports = {
    deleteUserByEmail,
    deleteUserById
};

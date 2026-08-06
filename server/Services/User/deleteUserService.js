/**
 * Delete User Service
 *
 * Removes a user's Amazon connection and operational data while retaining
 * the User document itself for audit/history. This is the single delete
 * behavior used by both the admin manual-delete route and the automated
 * six-month inactivity cleanup — there is no separate hard-delete mode.
 *
 * What happens:
 * - All Seller documents (Amazon SP-API/Ads tokens, product catalog) for
 *   the user are deleted.
 * - The User document's dangling refs into collections that
 *   fullUserDataPurgeService is about to purge are cleared.
 * - purgedAt is stamped on the User document.
 * - email/password/name are left untouched, so the person can still log
 *   back in later and reconnect their Amazon accounts.
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
 * Purge a user's Seller data and mark the account purged, by user ID.
 * @param {string} userId - User ID
 * @returns {Object} - Result object with success status and details
 */
const deleteUserById = async (userId) => {
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

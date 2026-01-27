/**
 * Delete User Service
 * 
 * Service to delete a user and all associated seller documents from the database.
 * This service handles the complete removal of user data including:
 * - All seller documents associated with the user
 * - The user document itself
 */

const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');

/**
 * Delete user and all associated seller documents by email
 * @param {string} email - User email address
 * @returns {Object} - Result object with success status and details
 */
const deleteUserByEmail = async (email) => {
    try {
        // Validate email format
        if (!email || typeof email !== 'string') {
            throw new ApiError(400, "Email is required and must be a string");
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new ApiError(400, "Invalid email format");
        }

        // Find user by email (case-insensitive)
        const user = await User.findOne({ email: email.toLowerCase().trim() });

        if (!user) {
            throw new ApiError(404, "User not found with the provided email");
        }

        const userId = user._id;
        const userName = `${user.firstName} ${user.lastName}`;

        // Find all seller documents associated with this user
        const sellerDocuments = await Seller.find({ User: userId });

        // Delete all seller documents
        let sellerDocumentsDeleted = 0;
        if (sellerDocuments && sellerDocuments.length > 0) {
            for (const sellerDoc of sellerDocuments) {
                await Seller.findByIdAndDelete(sellerDoc._id);
                sellerDocumentsDeleted++;
            }
        }

        // Delete the user document
        await User.findByIdAndDelete(userId);

        logger.info(`User deleted: ${email} (${userId})`, {
            email: email,
            userId: userId,
            userName: userName,
            sellerDocumentsDeleted: sellerDocumentsDeleted
        });

        return {
            success: true,
            message: "User and associated seller documents deleted successfully",
            data: {
                email: email,
                userId: userId,
                userName: userName,
                sellerDocumentsDeleted: sellerDocumentsDeleted
            }
        };

    } catch (error) {
        logger.error(`Error deleting user by email: ${error.message}`, {
            error: error.message,
            stack: error.stack,
            email: email
        });

        // Re-throw ApiError as-is, wrap other errors
        if (error instanceof ApiError) {
            throw error;
        }

        throw new ApiError(500, `Error deleting user: ${error.message}`);
    }
};

/**
 * Delete user and all associated seller documents by user ID
 * @param {string} userId - User ID
 * @returns {Object} - Result object with success status and details
 */
const deleteUserById = async (userId) => {
    try {
        // Validate userId
        if (!userId) {
            throw new ApiError(400, "User ID is required");
        }

        // Find user by ID
        const user = await User.findById(userId);

        if (!user) {
            throw new ApiError(404, "User not found with the provided ID");
        }

        const email = user.email;
        const userName = `${user.firstName} ${user.lastName}`;

        // Find all seller documents associated with this user
        const sellerDocuments = await Seller.find({ User: userId });

        // Delete all seller documents
        let sellerDocumentsDeleted = 0;
        if (sellerDocuments && sellerDocuments.length > 0) {
            for (const sellerDoc of sellerDocuments) {
                await Seller.findByIdAndDelete(sellerDoc._id);
                sellerDocumentsDeleted++;
            }
        }

        // Delete the user document
        await User.findByIdAndDelete(userId);

        logger.info(`User deleted: ${email} (${userId})`, {
            email: email,
            userId: userId,
            userName: userName,
            sellerDocumentsDeleted: sellerDocumentsDeleted
        });

        return {
            success: true,
            message: "User and associated seller documents deleted successfully",
            data: {
                email: email,
                userId: userId,
                userName: userName,
                sellerDocumentsDeleted: sellerDocumentsDeleted
            }
        };

    } catch (error) {
        logger.error(`Error deleting user by ID: ${error.message}`, {
            error: error.message,
            stack: error.stack,
            userId: userId
        });

        // Re-throw ApiError as-is, wrap other errors
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

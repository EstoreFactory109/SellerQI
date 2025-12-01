const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const User = require('../../models/user-auth/userModel.js');
const logger = require('../../utils/Logger.js');

const adminAuth = asyncHandler(async (req, res, next) => {
    try {
        const userId = req.userId; // Should be set by regular auth middleware
        
        if (!userId) {
            throw new ApiError(401, "Authentication required");
        }

        // Get user and check access type
        const user = await User.findById(userId);
        
        if (!user) {
            throw new ApiError(401, "User not found");
        }

        if (!['enterpriseAdmin'].includes(user.accessType)) {
            logger.warn(`User ${userId} attempted to access admin endpoint without proper permissions`);
            throw new ApiError(403, "Admin access required");
        }

        // User is authorized, continue
        req.userAccessType = user.accessType;
        next();

    } catch (error) {
        logger.error('Admin authorization error:', error);
        throw error;
    }
});

module.exports = adminAuth; 
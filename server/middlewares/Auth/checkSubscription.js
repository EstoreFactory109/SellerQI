const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');

/**
 * Middleware to check subscription - DISABLED
 * Since payment functionality has been removed, all users have full access
 */
const checkSubscription = (requiredPlans, options = {}) => {
    return asyncHandler(async (req, res, next) => {
        // Since payment functionality is removed, allow all authenticated users
        next();
    });
};

/**
 * Middleware specifically for LITE plan requirements
 */
const requireLite = checkSubscription(['LITE']);

/**
 * Middleware specifically for PRO plan requirements
 */
const requirePro = checkSubscription(['PRO']);

/**
 * Middleware specifically for AGENCY plan requirements
 */
const requireAgency = checkSubscription(['AGENCY']);

/**
 * Middleware for any paid plan (PRO or AGENCY)
 */
const requirePaid = checkSubscription(['PRO', 'AGENCY']);

/**
 * Get user subscription information - DISABLED
 * Returns default LITE plan since payment functionality is removed
 */
const getSubscriptionInfo = asyncHandler(async (req, res, next) => {
    try {
        const userId = req.userId;
        
        if (!userId) {
            return res.status(401).json(
                new ApiResponse(401, null, 'Authentication required')
            );
        }

        // Since payment functionality is removed, return default LITE plan info
        req.subscriptionInfo = {
            hasSubscription: true,
            planType: 'LITE',
            status: 'active',
            isActive: true,
            currentPeriodEnd: null,
            gracePeriod: false
        };

        next();
    } catch (error) {
        logger.error('Error in getSubscriptionInfo middleware:', error);
        return res.status(500).json(
            new ApiResponse(500, null, 'Internal server error')
        );
    }
});

module.exports = {
    checkSubscription,
    requireLite,
    requirePro,
    requireAgency,
    requirePaid,
    getSubscriptionInfo
}; 
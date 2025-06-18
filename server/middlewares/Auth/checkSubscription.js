const SubscriptionModel = require('../../models/SubscriptionModel.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');

/**
 * Middleware to check if user has required subscription level
 * @param {Array|String} requiredPlans - Array of plan types or single plan type ['PRO', 'AGENCY'] or 'PRO'
 * @param {Object} options - Additional options
 * @param {Boolean} options.allowExpiredGracePeriod - Allow access for expired subscriptions within grace period (default: false)
 * @param {Number} options.gracePeriodDays - Grace period in days (default: 3)
 */
const checkSubscription = (requiredPlans, options = {}) => {
    return asyncHandler(async (req, res, next) => {
        try {
            const userId = req.userId;
            
            if (!userId) {
                return res.status(401).json(
                    new ApiResponse(401, null, 'Authentication required')
                );
            }

            // Convert single plan to array
            if (typeof requiredPlans === 'string') {
                requiredPlans = [requiredPlans];
            }

            // If LITE is in required plans, allow all users (everyone has LITE access)
            if (requiredPlans.includes('LITE')) {
                return next();
            }

            // Find user's active subscription
            const subscription = await SubscriptionModel.findActiveForUser(userId);
            
            if (!subscription) {
                // Check if user has any subscription history
                const anySubscription = await SubscriptionModel.findOne({ userId: userId }).sort({ createdAt: -1 });
                
                if (!anySubscription) {
                    return res.status(403).json(
                        new ApiResponse(403, {
                            hasSubscription: false,
                            currentPlan: 'LITE',
                            requiredPlans: requiredPlans,
                            upgradeRequired: true
                        }, 'Subscription required for this feature')
                    );
                }

                // Handle expired subscriptions with grace period
                if (options.allowExpiredGracePeriod && anySubscription.status === 'canceled') {
                    const gracePeriodDays = options.gracePeriodDays || 3;
                    const gracePeriodEnd = new Date(anySubscription.endedAt || anySubscription.canceledAt);
                    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + gracePeriodDays);
                    
                    if (new Date() <= gracePeriodEnd) {
                        // Within grace period, allow access but add warning
                        req.subscriptionWarning = {
                            type: 'grace_period',
                            message: 'Subscription expired but within grace period',
                            expiresAt: gracePeriodEnd
                        };
                        return next();
                    }
                }

                return res.status(403).json(
                    new ApiResponse(403, {
                        hasSubscription: false,
                        currentPlan: anySubscription.planType,
                        currentStatus: anySubscription.status,
                        requiredPlans: requiredPlans,
                        upgradeRequired: true
                    }, 'Active subscription required for this feature')
                );
            }

            // Check if current plan meets requirements
            if (!subscription.hasFeatureAccess(requiredPlans)) {
                return res.status(403).json(
                    new ApiResponse(403, {
                        hasSubscription: true,
                        currentPlan: subscription.planType,
                        currentStatus: subscription.status,
                        requiredPlans: requiredPlans,
                        upgradeRequired: true
                    }, `${requiredPlans.join(' or ')} subscription required for this feature`)
                );
            }

            // Check if subscription is expiring soon (within 7 days)
            const daysUntilExpiry = Math.ceil((subscription.currentPeriodEnd - new Date()) / (1000 * 60 * 60 * 24));
            if (daysUntilExpiry <= 7 && daysUntilExpiry > 0) {
                req.subscriptionWarning = {
                    type: 'expiring_soon',
                    message: `Subscription expires in ${daysUntilExpiry} days`,
                    expiresAt: subscription.currentPeriodEnd
                };
            }

            // Check if subscription is scheduled for cancellation
            if (subscription.cancelAtPeriodEnd) {
                req.subscriptionWarning = {
                    type: 'scheduled_cancellation',
                    message: 'Subscription scheduled for cancellation',
                    expiresAt: subscription.currentPeriodEnd
                };
            }

            // Add subscription info to request for use in controllers
            req.subscription = {
                id: subscription._id,
                planType: subscription.planType,
                status: subscription.status,
                currentPeriodEnd: subscription.currentPeriodEnd,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
            };

            next();
        } catch (error) {
            logger.error(`Error checking subscription: ${error.message}`);
            return res.status(500).json(
                new ApiResponse(500, null, 'Failed to verify subscription')
            );
        }
    });
};

/**
 * Middleware to check if user has PRO subscription
 */
const requirePro = checkSubscription(['PRO']);

/**
 * Middleware to check if user has AGENCY subscription
 */
const requireAgency = checkSubscription(['AGENCY']);

/**
 * Middleware to check if user has PRO or AGENCY subscription
 */
const requirePaid = checkSubscription(['PRO', 'AGENCY']);

/**
 * Middleware to get subscription info without blocking access
 */
const getSubscriptionInfo = asyncHandler(async (req, res, next) => {
    try {
        const userId = req.userId;
        
        if (userId) {
            const subscription = await SubscriptionModel.findActiveForUser(userId);
            
            req.subscription = subscription ? {
                id: subscription._id,
                planType: subscription.planType,
                status: subscription.status,
                currentPeriodEnd: subscription.currentPeriodEnd,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                isActive: subscription.isActive
            } : {
                planType: 'LITE',
                status: 'none',
                isActive: false
            };
        }
        
        next();
    } catch (error) {
        logger.error(`Error getting subscription info: ${error.message}`);
        // Don't block request, just continue without subscription info
        next();
    }
});

module.exports = {
    checkSubscription,
    requirePro,
    requireAgency,
    requirePaid,
    getSubscriptionInfo
}; 
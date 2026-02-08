const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const User = require('../../models/user-auth/userModel.js');
const Subscription = require('../../models/user-auth/SubscriptionModel.js');

/**
 * Check if a trial has expired based on the trial end date
 */
const isTrialExpired = (trialEndsDate) => {
    if (!trialEndsDate) return false;
    return new Date() > new Date(trialEndsDate);
};

/**
 * Determine if user has access based on their subscription status
 * @param {Object} user - User object from database
 * @param {Object} subscription - Subscription object (can be null for LITE users)
 * @param {Array} requiredPlans - Array of plan types that have access
 * @param {Object} options - Additional options
 * @returns {Object} - { hasAccess: boolean, reason: string, effectivePlan: string }
 */
const determineAccess = (user, subscription, requiredPlans, options = {}) => {
    const { allowGracePeriod = true, gracePeriodDays = 3 } = options;
    
    // Get the user's package type
    const packageType = user.packageType || 'LITE';
    const subscriptionStatus = user.subscriptionStatus || 'active';
    const isInTrial = user.isInTrialPeriod || false;
    const trialEndsDate = user.trialEndsDate;
    
    // LITE users always have access to LITE-level features
    // LITE is the default free tier, no payment required
    if (packageType === 'LITE') {
        if (requiredPlans.includes('LITE')) {
            return { hasAccess: true, reason: 'LITE plan access', effectivePlan: 'LITE' };
        }
        return { hasAccess: false, reason: 'Feature requires higher plan', effectivePlan: 'LITE' };
    }
    
    // For paid plans (PRO/AGENCY), check subscription status
    
    // Check if user is in trial period
    if (isInTrial && trialEndsDate) {
        if (isTrialExpired(trialEndsDate)) {
            // Trial has expired - treat as LITE
            return { 
                hasAccess: requiredPlans.includes('LITE'), 
                reason: 'Trial expired', 
                effectivePlan: 'LITE',
                trialExpired: true
            };
        }
        // Active trial - has access to their plan
        if (requiredPlans.includes(packageType)) {
            return { hasAccess: true, reason: 'Active trial', effectivePlan: packageType };
        }
        return { hasAccess: false, reason: 'Feature requires different plan', effectivePlan: packageType };
    }
    
    // Check subscription status for non-trial paid users
    switch (subscriptionStatus) {
        case 'active':
        case 'trialing':
            // Active subscription - full access
            if (requiredPlans.includes(packageType)) {
                return { hasAccess: true, reason: 'Active subscription', effectivePlan: packageType };
            }
            return { hasAccess: false, reason: 'Feature requires different plan', effectivePlan: packageType };
            
        case 'past_due':
            // Payment failed but in grace period
            if (allowGracePeriod && subscription) {
                const lastPaymentAttempt = subscription.currentPeriodEnd || subscription.updatedAt;
                const gracePeriodEnd = new Date(lastPaymentAttempt);
                gracePeriodEnd.setDate(gracePeriodEnd.getDate() + gracePeriodDays);
                
                if (new Date() < gracePeriodEnd) {
                    // Still in grace period - allow access but flag it
                    if (requiredPlans.includes(packageType)) {
                        return { 
                            hasAccess: true, 
                            reason: 'Grace period - payment pending', 
                            effectivePlan: packageType,
                            isGracePeriod: true
                        };
                    }
                }
            }
            // Grace period expired or not allowed
            return { 
                hasAccess: requiredPlans.includes('LITE'), 
                reason: 'Payment overdue', 
                effectivePlan: 'LITE',
                paymentRequired: true
            };
            
        case 'cancelled':
        case 'inactive':
            // Subscription cancelled - check if still within paid period
            if (subscription && subscription.currentPeriodEnd) {
                if (new Date() < new Date(subscription.currentPeriodEnd)) {
                    // Still within paid period
                    if (requiredPlans.includes(packageType)) {
                        return { 
                            hasAccess: true, 
                            reason: 'Access until period end', 
                            effectivePlan: packageType,
                            cancelledButActive: true
                        };
                    }
                }
            }
            // Period ended - treat as LITE
            return { 
                hasAccess: requiredPlans.includes('LITE'), 
                reason: 'Subscription inactive', 
                effectivePlan: 'LITE' 
            };
            
        default:
            // Unknown status - be permissive for LITE, restrictive for paid features
            return { 
                hasAccess: requiredPlans.includes('LITE'), 
                reason: 'Unknown subscription status', 
                effectivePlan: 'LITE' 
            };
    }
};

/**
 * Middleware to check if user has access based on their subscription/plan
 * @param {Array} requiredPlans - Array of plan types that have access (e.g., ['PRO', 'AGENCY'])
 * @param {Object} options - Additional options
 *   - allowGracePeriod: boolean (default: true) - Allow access during grace period for past_due
 *   - gracePeriodDays: number (default: 3) - Number of grace period days
 *   - softBlock: boolean (default: false) - If true, adds info to req but doesn't block
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
            
            // Fetch user from database
            const user = await User.findById(userId);
            
            if (!user) {
                return res.status(401).json(
                    new ApiResponse(401, null, 'User not found')
                );
            }
            
            // Check if user is verified - unverified users shouldn't have access
            if (!user.isVerified) {
                return res.status(403).json(
                    new ApiResponse(403, null, 'Please verify your email first')
                );
            }
            
            // Fetch subscription record (may not exist for LITE users)
            const subscription = await Subscription.findOne({ userId });
            
            // Determine access
            const accessResult = determineAccess(user, subscription, requiredPlans, options);
            
            // Attach subscription info to request for downstream use
            req.subscriptionInfo = {
                hasSubscription: !!subscription,
                planType: accessResult.effectivePlan,
                actualPlanType: user.packageType,
                status: user.subscriptionStatus,
                isActive: accessResult.hasAccess,
                isInTrial: user.isInTrialPeriod,
                trialEndsDate: user.trialEndsDate,
                currentPeriodEnd: subscription?.currentPeriodEnd,
                isGracePeriod: accessResult.isGracePeriod || false,
                trialExpired: accessResult.trialExpired || false,
                paymentRequired: accessResult.paymentRequired || false,
                cancelledButActive: accessResult.cancelledButActive || false,
                accessReason: accessResult.reason
            };
            
            // If soft block, just add info and continue
            if (options.softBlock) {
                next();
                return;
            }
            
            // Check access
            if (!accessResult.hasAccess) {
                // Log blocked access for monitoring
                logger.warn(`Access blocked for user ${userId}: ${accessResult.reason}`, {
                    userId,
                    requiredPlans,
                    userPlan: user.packageType,
                    subscriptionStatus: user.subscriptionStatus
                });
                
                return res.status(403).json(
                    new ApiResponse(403, {
                        reason: accessResult.reason,
                        currentPlan: accessResult.effectivePlan,
                        requiredPlans,
                        trialExpired: accessResult.trialExpired,
                        paymentRequired: accessResult.paymentRequired
                    }, 'You do not have access to this feature. Please upgrade your plan.')
                );
            }
            
            next();
        } catch (error) {
            logger.error('Error in checkSubscription middleware:', error);
            // On error, allow access to prevent blocking legitimate users
            // but log for investigation
            next();
        }
    });
};

/**
 * Middleware specifically for LITE plan requirements (all users have access)
 */
const requireLite = checkSubscription(['LITE', 'PRO', 'AGENCY']);

/**
 * Middleware specifically for PRO plan requirements
 */
const requirePro = checkSubscription(['PRO', 'AGENCY']);

/**
 * Middleware specifically for AGENCY plan requirements
 */
const requireAgency = checkSubscription(['AGENCY']);

/**
 * Middleware for any paid plan (PRO or AGENCY)
 */
const requirePaid = checkSubscription(['PRO', 'AGENCY']);

/**
 * Get user subscription information without blocking
 * Attaches subscription info to req.subscriptionInfo
 */
const getSubscriptionInfo = asyncHandler(async (req, res, next) => {
    try {
        const userId = req.userId;
        
        if (!userId) {
            return res.status(401).json(
                new ApiResponse(401, null, 'Authentication required')
            );
        }

        // Fetch user from database
        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(401).json(
                new ApiResponse(401, null, 'User not found')
            );
        }
        
        // Fetch subscription record (may not exist for LITE users)
        const subscription = await Subscription.findOne({ userId });
        
        // Check trial expiry
        const trialExpired = user.isInTrialPeriod && user.trialEndsDate && isTrialExpired(user.trialEndsDate);
        
        // Determine effective plan
        let effectivePlan = user.packageType || 'LITE';
        if (trialExpired) {
            effectivePlan = 'LITE';
        }
        
        // Check if subscription is active
        const isActive = ['active', 'trialing'].includes(user.subscriptionStatus) && !trialExpired;
        
        req.subscriptionInfo = {
            hasSubscription: !!subscription,
            planType: effectivePlan,
            actualPlanType: user.packageType,
            status: user.subscriptionStatus,
            isActive: isActive,
            isInTrial: user.isInTrialPeriod && !trialExpired,
            trialEndsDate: user.trialEndsDate,
            trialExpired: trialExpired,
            currentPeriodEnd: subscription?.currentPeriodEnd,
            gracePeriod: user.subscriptionStatus === 'past_due',
            cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd || false
        };

        next();
    } catch (error) {
        logger.error('Error in getSubscriptionInfo middleware:', error);
        // On error, set default LITE info to not block the request
        req.subscriptionInfo = {
            hasSubscription: false,
            planType: 'LITE',
            status: 'active',
            isActive: true,
            currentPeriodEnd: null,
            gracePeriod: false,
            error: true
        };
        next();
    }
});

module.exports = {
    checkSubscription,
    requireLite,
    requirePro,
    requireAgency,
    requirePaid,
    getSubscriptionInfo,
    determineAccess,
    isTrialExpired
}; 
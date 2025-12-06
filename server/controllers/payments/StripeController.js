const stripeService = require('../../Services/Stripe/StripeService');
const Subscription = require('../../models/user-auth/SubscriptionModel');
const User = require('../../models/user-auth/userModel');
const asyncHandler = require('../../utils/AsyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const logger = require('../../utils/Logger');
const { getHttpsCookieOptions } = require('../../utils/cookieConfig.js');

/**
 * Create checkout session for subscription
 */
const createCheckoutSession = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;
        const { planType } = req.body;

        // Validate plan type
        if (!planType || !['PRO', 'AGENCY'].includes(planType)) {
            return res.status(400).json(
                new ApiResponse(400, null, 'Invalid plan type. Only PRO and AGENCY plans require payment.')
            );
        }

        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json(
                new ApiResponse(404, null, 'User not found')
            );
        }

        // Create success and cancel URLs
        const baseUrl = process.env.NODE_ENV === 'production' 
            ? process.env.FRONTEND_URL 
            : (process.env.FRONTEND_URL || 'http://localhost:3000');

        const successUrl = `${baseUrl}/subscription-success?session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${baseUrl}/payment-failed`;

        // Create checkout session
        const checkoutSession = await stripeService.createCheckoutSession(
            userId,
            planType,
            successUrl,
            cancelUrl
        );

        logger.info(`Checkout session created for user: ${userId}, plan: ${planType}`);

        return res.status(200).json(
            new ApiResponse(200, {
                sessionId: checkoutSession.sessionId,
                url: checkoutSession.url
            }, 'Checkout session created successfully')
        );

    } catch (error) {
        logger.error('Error creating checkout session:', error);
        return res.status(500).json(
            new ApiResponse(500, null, error.message || 'Failed to create checkout session')
        );
    }
});

/**
 * Handle successful payment
 */
const handlePaymentSuccess = asyncHandler(async (req, res) => {
    try {
        const { session_id } = req.query;

        if (!session_id) {
            return res.status(400).json(
                new ApiResponse(400, null, 'Session ID is required')
            );
        }

        // Handle successful payment
        const result = await stripeService.handleSuccessfulPayment(session_id);

        logger.info(`Payment success handled for session: ${session_id}`);

        // If admin token was created for AGENCY user, set it as cookie
        if (result.adminToken) {
            const cookieOptions = getHttpsCookieOptions();
            
            res.cookie("AdminToken", result.adminToken, cookieOptions);
            logger.info(`Admin token cookie set for AGENCY user: ${result.userId}`);
            
            // Remove admin token from response for security
            delete result.adminToken;
        }

        return res.status(200).json(
            new ApiResponse(200, result, 'Payment processed successfully')
        );

    } catch (error) {
        logger.error('Error handling payment success:', error);
        return res.status(500).json(
            new ApiResponse(500, null, error.message || 'Failed to process payment')
        );
    }
});

/**
 * Get user subscription details
 */
const getSubscription = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;

        const subscription = await stripeService.getSubscription(userId);

        return res.status(200).json(
            new ApiResponse(200, subscription, 'Subscription details retrieved successfully')
        );

    } catch (error) {
        logger.error('Error getting subscription:', error);
        return res.status(500).json(
            new ApiResponse(500, null, error.message || 'Failed to get subscription')
        );
    }
});

/**
 * Cancel subscription
 */
const cancelSubscription = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;
        const { cancelAtPeriodEnd = true } = req.body;

        const result = await stripeService.cancelSubscription(userId, cancelAtPeriodEnd);

        const message = cancelAtPeriodEnd 
            ? 'Subscription will be cancelled at the end of the current period'
            : 'Subscription cancelled immediately';

        logger.info(`Subscription cancellation requested for user: ${userId}, cancelAtPeriodEnd: ${cancelAtPeriodEnd}`);

        return res.status(200).json(
            new ApiResponse(200, result, message)
        );

    } catch (error) {
        logger.error('Error cancelling subscription:', error);
        return res.status(500).json(
            new ApiResponse(500, null, error.message || 'Failed to cancel subscription')
        );
    }
});

/**
 * Reactivate cancelled subscription
 */
const reactivateSubscription = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;

        const result = await stripeService.reactivateSubscription(userId);

        logger.info(`Subscription reactivated for user: ${userId}`);

        return res.status(200).json(
            new ApiResponse(200, result, 'Subscription reactivated successfully')
        );

    } catch (error) {
        logger.error('Error reactivating subscription:', error);
        return res.status(500).json(
            new ApiResponse(500, null, error.message || 'Failed to reactivate subscription')
        );
    }
});

/**
 * Get user's payment history
 */
const getPaymentHistory = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;

        const subscription = await Subscription.findOne({ userId }).select('paymentHistory');
        
        const paymentHistory = subscription ? subscription.paymentHistory : [];

        return res.status(200).json(
            new ApiResponse(200, { paymentHistory }, 'Payment history retrieved successfully')
        );

    } catch (error) {
        logger.error('Error getting payment history:', error);
        return res.status(500).json(
            new ApiResponse(500, null, error.message || 'Failed to get payment history')
        );
    }
});

/**
 * Get subscription configuration (for frontend)
 */
const getSubscriptionConfig = asyncHandler(async (req, res) => {
    try {
        const config = {
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
            plans: {
                PRO: {
                    priceId: process.env.STRIPE_PRO_PRICE_ID,
                    name: 'PRO',
                    features: ['Advanced Analytics', 'Priority Support', 'API Access']
                },
                AGENCY: {
                    priceId: process.env.STRIPE_AGENCY_PRICE_ID,
                    name: 'AGENCY',
                    features: ['Everything in PRO', 'White Label', 'Unlimited Users', 'Custom Integrations']
                }
            }
        };

        return res.status(200).json(
            new ApiResponse(200, config, 'Subscription configuration retrieved successfully')
        );

    } catch (error) {
        logger.error('Error getting subscription config:', error);
        return res.status(500).json(
            new ApiResponse(500, null, 'Failed to get subscription configuration')
        );
    }
});

module.exports = {
    createCheckoutSession,
    handlePaymentSuccess,
    getSubscription,
    cancelSubscription,
    reactivateSubscription,
    getPaymentHistory,
    getSubscriptionConfig
}; 
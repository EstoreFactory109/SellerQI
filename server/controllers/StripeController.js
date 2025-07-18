const StripeService = require('../Services/Stripe/StripeService.js');
const { ApiError } = require('../utils/ApiError.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const asyncHandler = require('../utils/AsyncHandler.js');
const logger = require('../utils/Logger.js');
const SubscriptionModel = require('../models/SubscriptionModel.js');
const UserModel = require('../models/userModel.js');
const { sendWelcomeLiteEmail } = require('../Services/Email/SendWelcomeLiteEmail.js');

// Get Stripe publishable key
const getPublishableKey = asyncHandler(async (req, res) => {
    try {
        const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
        
        if (!publishableKey) {
            logger.error('STRIPE_PUBLISHABLE_KEY not found in environment variables');
            return res.status(500).json(new ApiResponse(500, null, 'Stripe configuration error'));
        }

        return res.status(200).json(new ApiResponse(200, { 
            publishableKey 
        }, 'Publishable key retrieved'));
    } catch (error) {
        logger.error(`Error getting publishable key: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to get publishable key'));
    }
});

// Create checkout session
const createCheckoutSession = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { planType } = req.body;

    if (!planType || !['LITE', 'PRO', 'AGENCY'].includes(planType)) {
        return res.status(400).json(new ApiResponse(400, null, 'Invalid plan type'));
    }

    try {
        const successUrl = `${process.env.CLIENT_URL}/subscription-success?session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${process.env.CLIENT_URL}/pricing`;

        // For LITE plan, update user directly and return success URL
        if (planType === 'LITE') {
            const user = await UserModel.findById(userId);
            if (!user) {
                throw new ApiError(404, 'User not found');
            }
            
            user.subscriptionPlan = 'LITE';
            user.subscriptionStatus = 'active';
            await user.save();
            
            // Check if subscription record already exists
            const existingSubscription = await SubscriptionModel.findOne({
                userId: userId,
                planType: 'LITE'
            });
            
            if (!existingSubscription) {
                // Create subscription record for LITE plan
                await SubscriptionModel.create({
                    userId: userId,
                    stripeSubscriptionId: 'LITE_' + userId, // Special ID for LITE plan
                    stripeCustomerId: 'LITE_' + userId, // Special ID for LITE plan
                    planType: 'LITE',
                    status: 'active',
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
                    cancelAtPeriodEnd: false
                });

                // Send welcome email for lite package after subscription is created
                try {
                    const connectAccountUrl = `${process.env.CLIENT_URL}/connect-accounts`;
                    const emailSent = await sendWelcomeLiteEmail(user.email, user.firstName, connectAccountUrl);
                    if (emailSent) {
                        logger.info(`Welcome Lite email sent successfully to ${user.email} for user ${userId}`);
                    } else {
                        logger.warn(`Failed to send welcome Lite email to ${user.email} for user ${userId}`);
                    }
                } catch (emailError) {
                    logger.error(`Error sending welcome Lite email to ${user.email} for user ${userId}:`, emailError);
                    // Don't fail the subscription process if email fails
                }
            }
            
            return res.status(200).json(new ApiResponse(200, { url: successUrl }, 'Free plan activated'));
        }

        // For paid plans, create Stripe checkout session
        const session = await StripeService.createCheckoutSession(userId, planType, successUrl, cancelUrl);

        return res.status(200).json(new ApiResponse(200, session, 'Checkout session created'));
    } catch (error) {
        logger.error(`Error creating checkout session: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to create checkout session'));
    }
});

// Create portal session for subscription management
const createPortalSession = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        const session = await StripeService.createPortalSession(userId);
        return res.status(200).json(new ApiResponse(200, session, 'Portal session created'));
    } catch (error) {
        logger.error(`Error creating portal session: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to create portal session'));
    }
});

// Get subscription status
const getSubscriptionStatus = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        logger.info(`Getting subscription status for user: ${userId}`);
        
        // First check user record
        const user = await UserModel.findById(userId);
        if (!user) {
            logger.error(`User not found: ${userId}`);
            return res.status(404).json(new ApiResponse(404, null, 'User not found'));
        }

        logger.info(`User found - current status: ${user.subscriptionStatus}, plan: ${user.subscriptionPlan}`);

        // Get subscription record from database
        const subscription = await SubscriptionModel.findOne({
            userId: userId,
            status: { $in: ['active', 'trialing'] }
        }).sort({ createdAt: -1 });

        if (!subscription) {
            logger.info(`No active subscription found for user: ${userId}`);
            return res.status(200).json(new ApiResponse(200, {
                hasSubscription: false,
                plan: 'LITE',
                status: 'none',
                userRecord: {
                    subscriptionStatus: user.subscriptionStatus,
                    subscriptionPlan: user.subscriptionPlan
                }
            }, 'No active subscription'));
        }

        logger.info(`Found subscription: ${subscription._id}, plan: ${subscription.planType}, status: ${subscription.status}`);

        // For non-LITE plans, also check Stripe data
        let stripeData = null;
        if (subscription.planType !== 'LITE' && !subscription.stripeSubscriptionId.startsWith('LITE_')) {
            try {
                const stripeSubscription = await StripeService.getActiveSubscription(userId);
                if (stripeSubscription) {
                    stripeData = {
                        id: stripeSubscription.id,
                        status: stripeSubscription.status,
                        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
                        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end
                    };
                    logger.info(`Stripe data: status=${stripeSubscription.status}, cancelAtPeriodEnd=${stripeSubscription.cancel_at_period_end}`);
                }
            } catch (error) {
                logger.warn(`Error fetching Stripe subscription data: ${error.message}`);
            }
        }

        return res.status(200).json(new ApiResponse(200, {
            hasSubscription: true,
            plan: subscription.planType,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            stripeData: stripeData,
            userRecord: {
                subscriptionStatus: user.subscriptionStatus,
                subscriptionPlan: user.subscriptionPlan
            },
            subscriptionRecord: {
                id: subscription._id,
                status: subscription.status,
                planType: subscription.planType,
                createdAt: subscription.createdAt
            }
        }, 'Subscription status retrieved'));
    } catch (error) {
        logger.error(`Error getting subscription status: ${error.message}`);
        logger.error(`Error stack: ${error.stack}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to get subscription status'));
    }
});

// Cancel subscription
const cancelSubscription = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        const subscription = await SubscriptionModel.findOne({
            userId: userId,
            status: { $in: ['active', 'trialing'] }
        });

        if (!subscription) {
            return res.status(404).json(new ApiResponse(404, null, 'No active subscription found'));
        }

        const canceledSubscription = await StripeService.cancelSubscription(subscription.stripeSubscriptionId);

        return res.status(200).json(new ApiResponse(200, {
            cancelAtPeriodEnd: canceledSubscription.cancel_at_period_end,
            currentPeriodEnd: new Date(canceledSubscription.current_period_end * 1000)
        }, 'Subscription will be canceled at the end of the billing period'));
    } catch (error) {
        logger.error(`Error canceling subscription: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to cancel subscription'));
    }
});

// Reactivate subscription
const reactivateSubscription = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        const subscription = await SubscriptionModel.findOne({
            userId: userId,
            status: 'active',
            cancelAtPeriodEnd: true
        });

        if (!subscription) {
            return res.status(404).json(new ApiResponse(404, null, 'No subscription scheduled for cancellation'));
        }

        const reactivatedSubscription = await StripeService.reactivateSubscription(subscription.stripeSubscriptionId);

        return res.status(200).json(new ApiResponse(200, {
            status: reactivatedSubscription.status,
            cancelAtPeriodEnd: reactivatedSubscription.cancel_at_period_end
        }, 'Subscription reactivated'));
    } catch (error) {
        logger.error(`Error reactivating subscription: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to reactivate subscription'));
    }
});

// Update subscription plan
const updateSubscriptionPlan = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { newPlanType } = req.body;

    if (!newPlanType || !['PRO', 'AGENCY'].includes(newPlanType)) {
        return res.status(400).json(new ApiResponse(400, null, 'Invalid plan type'));
    }

    try {
        const subscription = await SubscriptionModel.findOne({
            userId: userId,
            status: { $in: ['active', 'trialing'] }
        });

        if (!subscription) {
            return res.status(404).json(new ApiResponse(404, null, 'No active subscription found'));
        }

        if (subscription.planType === newPlanType) {
            return res.status(400).json(new ApiResponse(400, null, 'Already subscribed to this plan'));
        }

        const updatedSubscription = await StripeService.updateSubscription(
            subscription.stripeSubscriptionId,
            newPlanType
        );

        return res.status(200).json(new ApiResponse(200, {
            planType: newPlanType,
            status: updatedSubscription.status
        }, 'Subscription plan updated'));
    } catch (error) {
        logger.error(`Error updating subscription plan: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to update subscription plan'));
    }
});

// Get invoice preview for plan change
const getInvoicePreview = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { newPlanType } = req.query;

    if (!newPlanType || !['PRO', 'AGENCY'].includes(newPlanType)) {
        return res.status(400).json(new ApiResponse(400, null, 'Invalid plan type'));
    }

    try {
        const subscription = await SubscriptionModel.findOne({
            userId: userId,
            status: { $in: ['active', 'trialing'] }
        });

        if (!subscription) {
            return res.status(404).json(new ApiResponse(404, null, 'No active subscription found'));
        }

        const preview = await StripeService.getInvoicePreview(
            subscription.stripeSubscriptionId,
            newPlanType
        );

        return res.status(200).json(new ApiResponse(200, preview, 'Invoice preview retrieved'));
    } catch (error) {
        logger.error(`Error getting invoice preview: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to get invoice preview'));
    }
});

// Get payment methods
const getPaymentMethods = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        const paymentMethods = await StripeService.getPaymentMethods(userId);

        return res.status(200).json(new ApiResponse(200, paymentMethods, 'Payment methods retrieved'));
    } catch (error) {
        logger.error(`Error getting payment methods: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to get payment methods'));
    }
});

// Get invoices
const getInvoices = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { limit = 10 } = req.query;

    try {
        const invoices = await StripeService.getInvoices(userId, parseInt(limit));

        return res.status(200).json(new ApiResponse(200, invoices, 'Invoices retrieved'));
    } catch (error) {
        logger.error(`Error getting invoices: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to get invoices'));
    }
});

module.exports = {
    getPublishableKey,
    createCheckoutSession,
    createPortalSession,
    getSubscriptionStatus,
    cancelSubscription,
    reactivateSubscription,
    updateSubscriptionPlan,
    getInvoicePreview,
    getPaymentMethods,
    getInvoices
};
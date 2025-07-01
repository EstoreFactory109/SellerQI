const StripeService = require('../Services/Stripe/StripeService.js');
const { ApiError } = require('../utils/ApiError.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const asyncHandler = require('../utils/AsyncHandler.js');
const logger = require('../utils/Logger.js');
const SubscriptionModel = require('../models/SubscriptionModel.js');
const UserModel = require('../models/userModel.js');
const { createAgencyOwnerToken } = require('../utils/Tokens.js');

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
            
            // Check if user already has a subscription and update it, otherwise create new one
            const existingSubscription = await SubscriptionModel.findOne({ userId: userId });
            
            if (existingSubscription) {
                // Update existing subscription
                existingSubscription.planType = 'LITE';
                existingSubscription.status = 'active';
                existingSubscription.stripeSubscriptionId = 'LITE_' + userId;
                existingSubscription.stripeCustomerId = 'LITE_' + userId;
                existingSubscription.currentPeriodStart = new Date();
                existingSubscription.currentPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
                existingSubscription.cancelAtPeriodEnd = false;
                await existingSubscription.save();
            } else {
                // Create new subscription record for LITE plan
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
            }
            
            return res.status(200).json(new ApiResponse(200, { url: successUrl }, 'Free plan activated'));
        }

        // For AGENCY plan (testing), update user directly and return success URL
        if (planType === 'AGENCY') {
            const user = await UserModel.findById(userId);
            if (!user) {
                throw new ApiError(404, 'User not found');
            }
            
            user.subscriptionPlan = 'AGENCY';
            user.subscriptionStatus = 'active';
            
            // Generate agency owner token
            const agencyOwnerToken = await createAgencyOwnerToken(userId);
            if (agencyOwnerToken) {
                user.agencyOwnerToken = agencyOwnerToken;
            }
            
            await user.save();
            
            // Check if user already has a subscription and update it, otherwise create new one
            const existingSubscription = await SubscriptionModel.findOne({ userId: userId });
            
            if (existingSubscription) {
                // Update existing subscription
                existingSubscription.planType = 'AGENCY';
                existingSubscription.status = 'active';
                existingSubscription.stripeSubscriptionId = 'AGENCY_' + userId;
                existingSubscription.stripeCustomerId = 'AGENCY_' + userId;
                existingSubscription.currentPeriodStart = new Date();
                existingSubscription.currentPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
                existingSubscription.cancelAtPeriodEnd = false;
                await existingSubscription.save();
            } else {
                // Create new subscription record for AGENCY plan
                await SubscriptionModel.create({
                    userId: userId,
                    stripeSubscriptionId: 'AGENCY_' + userId, // Special ID for testing
                    stripeCustomerId: 'AGENCY_' + userId, // Special ID for testing
                    planType: 'AGENCY',
                    status: 'active',
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
                    cancelAtPeriodEnd: false
                });
            }
            
            return res.status(200).json(new ApiResponse(200, { url: successUrl }, 'Agency plan activated'));
        }

        // For paid plans, create Stripe checkout session
        const session = await StripeService.createCheckoutSession(
            userId,
            planType,
            successUrl,
            cancelUrl
        );

        return res.status(200).json(new ApiResponse(200, { url: session.url }, 'Checkout session created'));
    } catch (error) {
        logger.error(`Error creating checkout session: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to create checkout session'));
    }
});

// Create customer portal session
const createPortalSession = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        const returnUrl = `${process.env.CLIENT_URL}/account`;
        const session = await StripeService.createPortalSession(userId, returnUrl);

        return res.status(200).json(new ApiResponse(200, { url: session.url }, 'Portal session created'));
    } catch (error) {
        logger.error(`Error creating portal session: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to create portal session'));
    }
});

// Get subscription status
const getSubscriptionStatus = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        const subscription = await SubscriptionModel.findOne({
            userId: userId,
            status: { $in: ['active', 'trialing'] }
        }).sort({ createdAt: -1 });

        if (!subscription) {
            return res.status(200).json(new ApiResponse(200, {
                hasSubscription: false,
                plan: 'LITE',
                status: 'none'
            }, 'No active subscription'));
        }

        const stripeSubscription = await StripeService.getActiveSubscription(userId);

        return res.status(200).json(new ApiResponse(200, {
            hasSubscription: true,
            plan: subscription.planType,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            stripeData: stripeSubscription ? {
                id: stripeSubscription.id,
                status: stripeSubscription.status,
                currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
                cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end
            } : null
        }, 'Subscription status retrieved'));
    } catch (error) {
        logger.error(`Error getting subscription status: ${error.message}`);
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

const getPublishableKey = asyncHandler(async (req, res) => {
    return res.status(200).json(new ApiResponse(200, {
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    }, 'Publishable key retrieved'));
});

// Check subscription and set agency owner cookie if needed
const checkAndSetAgencyOwnerCookie = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json(new ApiResponse(404, null, 'User not found'));
        }

        // Check if user has AGENCY plan and needs agency owner token
        if (user.subscriptionPlan === 'AGENCY') {
            let agencyOwnerToken = user.agencyOwnerToken;
            
            // Generate agency owner token if it doesn't exist
            if (!agencyOwnerToken) {
                agencyOwnerToken = await createAgencyOwnerToken(userId);
                if (agencyOwnerToken) {
                    user.agencyOwnerToken = agencyOwnerToken;
                    await user.save();
                } else {
                    logger.error(`Failed to generate agency owner token for user ${userId}`);
                    return res.status(500).json(new ApiResponse(500, null, 'Failed to generate agency owner token'));
                }
            }

            const options = {
                httpOnly: true,
                secure: true,
                sameSite: "None"
            };

            return res.status(200)
                .cookie("agencyOwnerCookie", agencyOwnerToken, options)
                .json(new ApiResponse(200, { 
                    isAgencyOwner: true,
                    subscriptionPlan: user.subscriptionPlan 
                }, 'Agency owner cookie set successfully'));
        }

        return res.status(200).json(new ApiResponse(200, { 
            isAgencyOwner: false,
            subscriptionPlan: user.subscriptionPlan 
        }, 'User is not an agency owner'));

    } catch (error) {
        logger.error(`Error checking agency owner status: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, null, 'Failed to check agency owner status'));
    }
});

module.exports = {
    createCheckoutSession,
    createPortalSession,
    getSubscriptionStatus,
    cancelSubscription,
    reactivateSubscription,
    updateSubscriptionPlan,
    getInvoicePreview,
    getPaymentMethods,
    getInvoices,
    getPublishableKey,
    checkAndSetAgencyOwnerCookie
};
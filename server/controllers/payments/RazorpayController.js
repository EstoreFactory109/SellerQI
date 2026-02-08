const razorpayService = require('../../Services/Razorpay/RazorpayService');
const asyncHandler = require('../../utils/AsyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const logger = require('../../utils/Logger');
const User = require('../../models/user-auth/userModel');

/**
 * Sanitize error messages to prevent information disclosure
 */
const sanitizeErrorMessage = (error) => {
    // List of safe error messages that can be shown to users
    const safeMessages = [
        'Invalid plan type',
        'Trial period must be between 0 and 365 days',
        'Payment service is not configured',
        'Missing required payment verification fields',
        'No subscription found',
        'Payment ID is required',
        'You have already used your free trial',
        'Invalid webhook signature'
    ];
    
    // Check if the error message is safe to show
    if (error.message && safeMessages.some(safe => error.message.includes(safe))) {
        return error.message;
    }
    
    // Return generic message for other errors
    return null;
};

/**
 * Create Razorpay order for subscription
 */
const createOrder = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;
        const { planType, trialPeriodDays } = req.body;

        // Validate plan type - Only PRO is available for India via Razorpay
        if (!planType || planType !== 'PRO') {
            return res.status(400).json(
                new ApiResponse(400, null, 'Invalid plan type. Only PRO plan is available for India.')
            );
        }

        // Validate trial period if provided (only allowed for PRO plan)
        if (trialPeriodDays !== undefined && trialPeriodDays !== null) {
            const trialDays = parseInt(trialPeriodDays);
            if (isNaN(trialDays) || trialDays < 0 || trialDays > 365) {
                return res.status(400).json(
                    new ApiResponse(400, null, 'Trial period must be between 0 and 365 days.')
                );
            }
            
            // SERVER-SIDE VALIDATION: Check if user has already used their trial
            if (trialDays > 0) {
                const user = await User.findById(userId);
                if (user && user.servedTrial === true) {
                    logger.warn(`User ${userId} attempted to start trial again but has already used trial`);
                    return res.status(400).json(
                        new ApiResponse(400, null, 'You have already used your free trial. Please subscribe to continue.')
                    );
                }
            }
        }

        // Check if Razorpay is configured
        if (!razorpayService.isConfigured()) {
            return res.status(503).json(
                new ApiResponse(503, null, 'Payment service is not configured')
            );
        }

        // Create Razorpay order with optional trial period
        const orderData = await razorpayService.createOrder(
            userId, 
            planType, 
            trialPeriodDays ? parseInt(trialPeriodDays) : null
        );

        const trialInfo = orderData.hasTrial ? `, trial: ${orderData.trialDays} days` : '';
        logger.info(`Razorpay order created for user: ${userId}, plan: ${planType}${trialInfo}`);

        return res.status(200).json(
            new ApiResponse(200, orderData, 'Order created successfully')
        );

    } catch (error) {
        logger.error('Error creating Razorpay order:', {
            error: error.message,
            stack: error.stack,
            userId: req.userId,
            planType: req.body?.planType,
            trialPeriodDays: req.body?.trialPeriodDays
        });
        const safeMessage = sanitizeErrorMessage(error);
        return res.status(500).json(
            new ApiResponse(500, null, safeMessage || 'Failed to create order')
        );
    }
});

/**
 * Verify Razorpay subscription payment
 */
const verifyPayment = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;
        const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature } = req.body;

        // Validate required fields
        if (!razorpay_subscription_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json(
                new ApiResponse(400, null, 'Missing required payment verification fields')
            );
        }

        // Verify and process payment
        const result = await razorpayService.handlePaymentSuccess(
            razorpay_subscription_id,
            razorpay_payment_id,
            razorpay_signature,
            userId
        );

        logger.info(`Razorpay subscription payment verified for user: ${userId}, subscription: ${razorpay_subscription_id}`);

        return res.status(200).json(
            new ApiResponse(200, result, 'Payment verified successfully')
        );

    } catch (error) {
        logger.error('Error verifying Razorpay payment:', {
            message: error.message,
            stack: error.stack,
            userId: req.userId,
            subscriptionId: req.body?.razorpay_subscription_id,
            paymentId: req.body?.razorpay_payment_id,
            errorName: error.name
        });
        const safeMessage = sanitizeErrorMessage(error);
        return res.status(500).json(
            new ApiResponse(500, null, safeMessage || 'Failed to verify payment')
        );
    }
});

/**
 * Get Razorpay configuration for frontend
 */
const getConfig = asyncHandler(async (req, res) => {
    try {
        const config = razorpayService.getConfig();

        return res.status(200).json(
            new ApiResponse(200, config, 'Configuration retrieved successfully')
        );

    } catch (error) {
        logger.error('Error getting Razorpay config:', error);
        return res.status(500).json(
            new ApiResponse(500, null, 'Failed to get configuration')
        );
    }
});

/**
 * Handle Razorpay webhook
 * SECURITY: Webhook signature verification is MANDATORY in production
 */
const handleWebhook = asyncHandler(async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const webhookSecret = process.env.RAZOR_PAY_WEBHOOK_SECRET;
        const isProduction = process.env.NODE_ENV === 'production';

        // CRITICAL: In production, webhook secret MUST be configured
        if (isProduction && !webhookSecret) {
            logger.error('CRITICAL: RAZOR_PAY_WEBHOOK_SECRET is not configured in production!');
            return res.status(500).json(
                new ApiResponse(500, null, 'Webhook configuration error')
            );
        }

        // CRITICAL: In production, signature MUST be present
        if (isProduction && !signature) {
            logger.warn('Razorpay webhook received without signature header');
            return res.status(400).json(
                new ApiResponse(400, null, 'Missing webhook signature')
            );
        }

        // Verify signature when both secret and signature are available
        if (webhookSecret && signature) {
            const body = JSON.stringify(req.body);
            const isValid = razorpayService.verifyWebhookSignature(body, signature, webhookSecret);
            
            if (!isValid) {
                logger.warn('Invalid Razorpay webhook signature - possible forgery attempt');
                return res.status(400).json(
                    new ApiResponse(400, null, 'Invalid webhook signature')
                );
            }
            logger.info('Razorpay webhook signature verified successfully');
        } else if (!isProduction) {
            // Only allow unverified webhooks in development with a warning
            logger.warn('Processing Razorpay webhook without signature verification (development mode)');
        }

        const event = req.body.event;
        const payload = req.body.payload;

        await razorpayService.handleWebhook(event, payload);

        logger.info(`Razorpay webhook processed: ${event}`);

        return res.status(200).json(
            new ApiResponse(200, { received: true }, 'Webhook processed successfully')
        );

    } catch (error) {
        logger.error('Error handling Razorpay webhook:', error);
        
        // Determine if this is a transient error that should be retried
        const isTransientError = error.name === 'MongoNetworkError' || 
                                  error.name === 'MongoTimeoutError' ||
                                  error.message?.includes('ECONNREFUSED') ||
                                  error.message?.includes('ETIMEDOUT');
        
        if (isTransientError) {
            // Return 500 to allow Razorpay to retry
            logger.warn('Transient error processing webhook - returning 500 for retry');
            return res.status(500).json(
                new ApiResponse(500, null, 'Temporary error, please retry')
            );
        }
        
        // For permanent errors, acknowledge receipt to prevent infinite retries
        return res.status(200).json(
            new ApiResponse(200, { received: true }, 'Webhook received')
        );
    }
});

/**
 * Cancel Razorpay subscription
 */
const cancelSubscription = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;

        // Check if Razorpay is configured
        if (!razorpayService.isConfigured()) {
            return res.status(503).json(
                new ApiResponse(503, null, 'Payment service is not configured')
            );
        }

        // Cancel subscription
        const result = await razorpayService.cancelSubscription(userId);

        logger.info(`Razorpay subscription cancelled for user: ${userId}`);

        return res.status(200).json(
            new ApiResponse(200, result, 'Subscription cancelled successfully')
        );

    } catch (error) {
        logger.error('Error cancelling Razorpay subscription:', error);
        const safeMessage = sanitizeErrorMessage(error);
        return res.status(500).json(
            new ApiResponse(500, null, safeMessage || 'Failed to cancel subscription')
        );
    }
});

/**
 * Get user's Razorpay subscription details
 */
const getSubscription = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;

        const subscription = await razorpayService.getSubscription(userId);

        if (!subscription) {
            return res.status(404).json(
                new ApiResponse(404, null, 'No subscription found')
            );
        }

        return res.status(200).json(
            new ApiResponse(200, subscription, 'Subscription retrieved successfully')
        );

    } catch (error) {
        logger.error('Error getting Razorpay subscription:', error);
        return res.status(500).json(
            new ApiResponse(500, null, 'Failed to get subscription')
        );
    }
});

/**
 * Get payment history for Razorpay
 */
const getPaymentHistory = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;

        const history = await razorpayService.getPaymentHistory(userId);

        return res.status(200).json(
            new ApiResponse(200, { paymentHistory: history }, 'Payment history retrieved successfully')
        );

    } catch (error) {
        logger.error('Error getting Razorpay payment history:', error);
        return res.status(500).json(
            new ApiResponse(500, null, 'Failed to get payment history')
        );
    }
});

/**
 * Get invoice download URL for Razorpay payment
 */
const getInvoiceDownloadUrl = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;
        const { paymentId } = req.query;

        if (!paymentId) {
            return res.status(400).json(
                new ApiResponse(400, null, 'Payment ID is required')
            );
        }

        const invoiceData = await razorpayService.getInvoiceDownloadUrl(userId, paymentId);

        return res.status(200).json(
            new ApiResponse(200, invoiceData, 'Invoice URL retrieved successfully')
        );

    } catch (error) {
        logger.error('Error getting Razorpay invoice download URL:', error);
        return res.status(500).json(
            new ApiResponse(500, null, 'Failed to get invoice URL')
        );
    }
});

module.exports = {
    createOrder,
    verifyPayment,
    getConfig,
    handleWebhook,
    cancelSubscription,
    getSubscription,
    getPaymentHistory,
    getInvoiceDownloadUrl
};


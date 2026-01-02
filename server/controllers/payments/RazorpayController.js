const razorpayService = require('../../Services/Razorpay/RazorpayService');
const asyncHandler = require('../../utils/AsyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const logger = require('../../utils/Logger');

/**
 * Create Razorpay order for subscription
 */
const createOrder = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;
        const { planType } = req.body;

        // Validate plan type - Only PRO is available for India via Razorpay
        if (!planType || planType !== 'PRO') {
            return res.status(400).json(
                new ApiResponse(400, null, 'Invalid plan type. Only PRO plan is available for India.')
            );
        }

        // Check if Razorpay is configured
        if (!razorpayService.isConfigured()) {
            return res.status(503).json(
                new ApiResponse(503, null, 'Payment service is not configured')
            );
        }

        // Create Razorpay order
        const orderData = await razorpayService.createOrder(userId, planType);

        logger.info(`Razorpay order created for user: ${userId}, plan: ${planType}`);

        return res.status(200).json(
            new ApiResponse(200, orderData, 'Order created successfully')
        );

    } catch (error) {
        logger.error('Error creating Razorpay order:', error);
        return res.status(500).json(
            new ApiResponse(500, null, error.message || 'Failed to create order')
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
        logger.error('Error verifying Razorpay payment:', error);
        return res.status(500).json(
            new ApiResponse(500, null, error.message || 'Failed to verify payment')
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
 */
const handleWebhook = asyncHandler(async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const webhookSecret = process.env.RAZOR_PAY_WEBHOOK_SECRET;

        // If webhook secret is configured, verify signature
        if (webhookSecret && signature) {
            const body = JSON.stringify(req.body);
            const isValid = razorpayService.verifyWebhookSignature(body, signature, webhookSecret);
            
            if (!isValid) {
                logger.warn('Invalid Razorpay webhook signature');
                return res.status(400).json(
                    new ApiResponse(400, null, 'Invalid webhook signature')
                );
            }
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
        // Still return 200 to acknowledge receipt
        return res.status(200).json(
            new ApiResponse(200, { received: true, error: error.message }, 'Webhook received with errors')
        );
    }
});

module.exports = {
    createOrder,
    verifyPayment,
    getConfig,
    handleWebhook
};


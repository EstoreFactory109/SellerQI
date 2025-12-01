const stripeWebhookService = require('../../Services/Stripe/StripeWebhookService');
const asyncHandler = require('../../utils/AsyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const logger = require('../../utils/Logger');

/**
 * Handle Stripe webhook events
 */
const handleWebhook = asyncHandler(async (req, res) => {
    try {
        const signature = req.headers['stripe-signature'];
        const payload = req.body;

        if (!signature) {
            logger.error('Missing Stripe signature header');
            return res.status(400).json(
                new ApiResponse(400, null, 'Missing Stripe signature')
            );
        }

        // Verify webhook signature and get event
        const event = stripeWebhookService.verifyWebhookSignature(payload, signature);
        
        logger.info(`Received webhook event: ${event.type}, ID: ${event.id}`);

        // Handle the webhook event
        const result = await stripeWebhookService.handleWebhookEvent(event);

        logger.info(`Successfully processed webhook event: ${event.type}`);

        // Always return 200 to acknowledge receipt
        return res.status(200).json(
            new ApiResponse(200, result, 'Webhook processed successfully')
        );

    } catch (error) {
        logger.error('Webhook processing failed:', error);
        
        // For signature verification errors, return 400
        if (error.message === 'Invalid signature') {
            return res.status(400).json(
                new ApiResponse(400, null, 'Invalid webhook signature')
            );
        }

        // For other errors, still return 200 to prevent webhook retries
        // but log the error for investigation
        return res.status(200).json(
            new ApiResponse(200, null, 'Webhook received but processing failed')
        );
    }
});

/**
 * Test webhook endpoint (for development)
 */
const testWebhook = asyncHandler(async (req, res) => {
    try {
        logger.info('Test webhook endpoint called');
        
        return res.status(200).json(
            new ApiResponse(200, { 
                message: 'Webhook endpoint is working',
                timestamp: new Date().toISOString()
            }, 'Test webhook successful')
        );

    } catch (error) {
        logger.error('Test webhook failed:', error);
        return res.status(500).json(
            new ApiResponse(500, null, 'Test webhook failed')
        );
    }
});

module.exports = {
    handleWebhook,
    testWebhook
}; 
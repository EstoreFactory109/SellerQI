const StripeWebhookService = require('../Services/Stripe/StripeWebhookService.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const logger = require('../utils/Logger.js');

const handleWebhook = async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const payload = req.body; // With express.raw middleware, body contains the raw buffer

    logger.info(`Received webhook with signature: ${signature ? 'present' : 'missing'}`);
    logger.info(`Payload type: ${typeof payload}, length: ${payload ? payload.length : 'null'}`);

    try {
        // Verify webhook signature
        const event = StripeWebhookService.verifyWebhookSignature(payload, signature);
        
        logger.info(`Webhook event verified: ${event.type} - ${event.id}`);

        // Process the event
        await StripeWebhookService.processWebhookEvent(event);

        logger.info(`Webhook event processed successfully: ${event.type} - ${event.id}`);

        // Return 200 OK to acknowledge receipt
        res.status(200).json({ received: true, eventType: event.type, eventId: event.id });
    } catch (error) {
        logger.error(`Webhook error: ${error.message}`);
        logger.error(`Webhook error stack: ${error.stack}`);
        
        // Log request details for debugging
        logger.error(`Request headers: ${JSON.stringify(req.headers)}`);
        logger.error(`Payload info: type=${typeof payload}, length=${payload ? payload.length : 'null'}`);
        
        // Return 400 to indicate webhook processing failed
        // Stripe will retry the webhook
        return res.status(400).json(new ApiResponse(400, null, `Webhook Error: ${error.message}`));
    }
};

module.exports = {
    handleWebhook
};
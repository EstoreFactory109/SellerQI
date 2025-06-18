const StripeWebhookService = require('../Services/Stripe/StripeWebhookService.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const logger = require('../utils/Logger.js');

const handleWebhook = async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const payload = req.rawBody; // We'll need to capture raw body

    try {
        // Verify webhook signature
        const event = StripeWebhookService.verifyWebhookSignature(payload, signature);

        // Process the event
        await StripeWebhookService.processWebhookEvent(event);

        // Return 200 OK to acknowledge receipt
        res.status(200).json({ received: true });
    } catch (error) {
        logger.error(`Webhook error: ${error.message}`);
        
        // Return 400 to indicate webhook processing failed
        // Stripe will retry the webhook
        return res.status(400).json(new ApiResponse(400, null, `Webhook Error: ${error.message}`));
    }
};

module.exports = {
    handleWebhook
};
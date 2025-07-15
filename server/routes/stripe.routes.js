const express = require('express');
const router = express.Router();

// Import controllers
const StripeController = require('../controllers/StripeController.js');
const StripeWebhookController = require('../controllers/StripeWebhookController.js');

// Import middleware
const auth = require('../middlewares/Auth/auth.js');

// Debug endpoint for testing webhook connectivity (no auth required)
router.get('/webhook-debug', (req, res) => {
    res.json({
        message: 'Webhook endpoint is accessible',
        timestamp: new Date().toISOString(),
        environment: {
            hasStripeSecretKey: !!process.env.STRIPE_SECRET_KEY,
            hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
            nodeEnv: process.env.NODE_ENV
        }
    });
});

// Webhook endpoint (must be before express.json middleware and auth)
// This needs to use raw body parsing for Stripe signature verification
router.post('/webhook', express.raw({ type: 'application/json' }), StripeWebhookController.handleWebhook);

// Get publishable key (no auth required for frontend setup)
router.get('/publishable-key', StripeController.getPublishableKey);

// Protected routes (require authentication)
router.use(auth);

// Subscription management
router.post('/create-checkout-session', StripeController.createCheckoutSession);
router.post('/create-portal-session', StripeController.createPortalSession);
router.get('/subscription-status', StripeController.getSubscriptionStatus);
router.post('/cancel-subscription', StripeController.cancelSubscription);
router.post('/reactivate-subscription', StripeController.reactivateSubscription);
router.put('/update-subscription', StripeController.updateSubscriptionPlan);

// Invoice and pricing
router.get('/invoice-preview', StripeController.getInvoicePreview);
router.get('/invoices', StripeController.getInvoices);

// Payment methods
router.get('/payment-methods', StripeController.getPaymentMethods);

module.exports = router; 
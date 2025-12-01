const express = require('express');
const router = express.Router();

// Import controllers
const {
    createCheckoutSession,
    handlePaymentSuccess,
    getSubscription,
    cancelSubscription,
    reactivateSubscription,
    getPaymentHistory,
    getSubscriptionConfig
} = require('../controllers/payments/StripeController');

const {
    handleWebhook,
    testWebhook
} = require('../controllers/payments/StripeWebhookController');

// Import middleware
const auth = require('../middlewares/Auth/auth');

// Webhook routes (no auth required, Stripe handles verification)
router.post('/webhook', handleWebhook);
router.get('/webhook/test', testWebhook);

// Subscription management routes (auth required)
router.post('/create-checkout-session', auth, createCheckoutSession);
router.get('/payment-success', auth, handlePaymentSuccess);
router.get('/subscription', auth, getSubscription);
router.post('/cancel-subscription', auth, cancelSubscription);
router.post('/reactivate-subscription', auth, reactivateSubscription);
router.get('/payment-history', auth, getPaymentHistory);

// Configuration routes (no auth required for config)
router.get('/config', getSubscriptionConfig);

module.exports = router; 
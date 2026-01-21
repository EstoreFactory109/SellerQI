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
    getInvoiceDownloadUrl,
    getSubscriptionConfig
} = require('../controllers/payments/StripeController');

const {
    handleWebhook,
    testWebhook
} = require('../controllers/payments/StripeWebhookController');

// Import middleware
const auth = require('../middlewares/Auth/auth');
const { webhookRateLimiter, paymentRateLimiter } = require('../middlewares/rateLimiting.js');
const { validateCheckoutSession } = require('../middlewares/validator/paymentValidate.js');

// Webhook routes (no auth required, Stripe handles verification)
// Webhooks are whitelisted in the rate limiter (skipped if signature is present)
router.post('/webhook', webhookRateLimiter, handleWebhook);
router.get('/webhook/test', testWebhook);

// Subscription management routes (auth required)
router.post('/create-checkout-session', paymentRateLimiter, auth, validateCheckoutSession, createCheckoutSession);
router.get('/payment-success', paymentRateLimiter, auth, handlePaymentSuccess);
router.get('/subscription', paymentRateLimiter, auth, getSubscription);
router.post('/cancel-subscription', paymentRateLimiter, auth, cancelSubscription);
router.post('/reactivate-subscription', paymentRateLimiter, auth, reactivateSubscription);
router.get('/payment-history', paymentRateLimiter, auth, getPaymentHistory);
router.get('/invoice-download', paymentRateLimiter, auth, getInvoiceDownloadUrl);

// Configuration routes (no auth required for config)
router.get('/config', getSubscriptionConfig);

module.exports = router; 
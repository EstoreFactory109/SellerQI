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
const { validateCheckoutSession } = require('../middlewares/validator/paymentValidate.js');

// Webhook routes (no auth required, Stripe handles verification via signature)
router.post('/webhook', handleWebhook);

// Test webhook endpoint - restrict in production
router.get('/webhook/test', (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ message: 'Not found' });
    }
    next();
}, testWebhook);

// Subscription management routes (auth required)
router.post('/create-checkout-session', auth, validateCheckoutSession, createCheckoutSession);
router.get('/payment-success', auth, handlePaymentSuccess);
router.get('/subscription', auth, getSubscription);
router.post('/cancel-subscription', auth, cancelSubscription);
router.post('/reactivate-subscription', auth, reactivateSubscription);
router.get('/payment-history', auth, getPaymentHistory);
router.get('/invoice-download', auth, getInvoiceDownloadUrl);

// Configuration routes (no auth required for config)
router.get('/config', getSubscriptionConfig);

module.exports = router; 
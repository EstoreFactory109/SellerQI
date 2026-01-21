const express = require('express');
const router = express.Router();

// Import controllers
const {
    createOrder,
    verifyPayment,
    getConfig,
    handleWebhook,
    cancelSubscription,
    getSubscription,
    getPaymentHistory,
    getInvoiceDownloadUrl
} = require('../controllers/payments/RazorpayController');

// Import middleware
const auth = require('../middlewares/Auth/auth');
const { webhookRateLimiter, paymentRateLimiter } = require('../middlewares/rateLimiting.js');
const { validateRazorpayOrder, validateRazorpayPayment } = require('../middlewares/validator/razorpayValidate.js');

// Webhook route (no auth required, Razorpay handles verification)
// Webhooks are whitelisted in the rate limiter (skipped if signature is present)
router.post('/webhook', webhookRateLimiter, handleWebhook);

// Configuration route (no auth required)
router.get('/config', getConfig);

// Payment routes (auth required)
router.post('/create-order', paymentRateLimiter, auth, validateRazorpayOrder, createOrder);
router.post('/verify-payment', paymentRateLimiter, auth, validateRazorpayPayment, verifyPayment);

// Subscription management routes (auth required)
router.get('/subscription', paymentRateLimiter, auth, getSubscription);
router.post('/cancel-subscription', paymentRateLimiter, auth, cancelSubscription);
router.get('/payment-history', paymentRateLimiter, auth, getPaymentHistory);
router.get('/invoice-download', paymentRateLimiter, auth, getInvoiceDownloadUrl);

module.exports = router;


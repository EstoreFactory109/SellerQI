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
// Rate limiters disabled except for authentication
// const { webhookRateLimiter, paymentRateLimiter } = require('../middlewares/rateLimiting.js');
const { validateRazorpayOrder, validateRazorpayPayment } = require('../middlewares/validator/razorpayValidate.js');

// Webhook route (no auth required, Razorpay handles verification)
router.post('/webhook', handleWebhook);

// Configuration route (no auth required)
router.get('/config', getConfig);

// Payment routes (auth required)
// Note: Rate limiting temporarily disabled on payment routes to prevent blocking legitimate payment flows
router.post('/create-order', auth, validateRazorpayOrder, createOrder);
router.post('/verify-payment', auth, validateRazorpayPayment, verifyPayment);

// Subscription management routes (auth required)
router.get('/subscription', auth, getSubscription);
router.post('/cancel-subscription', auth, cancelSubscription);
router.get('/payment-history', auth, getPaymentHistory);
router.get('/invoice-download', auth, getInvoiceDownloadUrl);

module.exports = router;


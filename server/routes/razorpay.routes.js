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

// Webhook route (no auth required, Razorpay handles verification)
router.post('/webhook', handleWebhook);

// Configuration route (no auth required)
router.get('/config', getConfig);

// Payment routes (auth required)
router.post('/create-order', auth, createOrder);
router.post('/verify-payment', auth, verifyPayment);

// Subscription management routes (auth required)
router.get('/subscription', auth, getSubscription);
router.post('/cancel-subscription', auth, cancelSubscription);
router.get('/payment-history', auth, getPaymentHistory);
router.get('/invoice-download', auth, getInvoiceDownloadUrl);

module.exports = router;


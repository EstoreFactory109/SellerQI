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
const { validateRazorpayOrder, validateRazorpayPayment } = require('../middlewares/validator/razorpayValidate.js');

// Webhook route (no auth required, Razorpay handles verification via signature)
router.post('/webhook', handleWebhook);

// Configuration route (no auth required)
router.get('/config', getConfig);

// Payment routes (auth required)
router.post('/create-order', auth, validateRazorpayOrder, createOrder);
router.post('/verify-payment', auth, validateRazorpayPayment, verifyPayment);

// Subscription management routes (auth required)
router.get('/subscription', auth, getSubscription);
router.post('/cancel-subscription', auth, cancelSubscription);
router.get('/payment-history', auth, getPaymentHistory);
router.get('/invoice-download', auth, getInvoiceDownloadUrl);

module.exports = router;


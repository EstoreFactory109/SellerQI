const express = require('express');
const router = express.Router();

// Import controllers
const {
    createOrder,
    verifyPayment,
    getConfig,
    handleWebhook
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

module.exports = router;


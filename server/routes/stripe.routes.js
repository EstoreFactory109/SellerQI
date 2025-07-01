const express = require('express');
const router = express.Router();

// Import controllers
const StripeController = require('../controllers/StripeController.js');
const StripeWebhookController = require('../controllers/StripeWebhookController.js');

// Import middleware
const {auth} = require('../middlewares/Auth/auth.js');

// Webhook endpoint (must be before express.json middleware and auth)
router.post('/webhook', express.raw({ type: 'application/json' }), StripeWebhookController.handleWebhook);

// Public endpoints (no auth required)
router.get('/publishable-key', StripeController.getPublishableKey);

// Protected routes (require authentication)
router.use(auth); // Apply auth middleware to all routes below

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

// Agency owner cookie management
router.post('/check-agency-owner', StripeController.checkAndSetAgencyOwnerCookie);

module.exports = router; 
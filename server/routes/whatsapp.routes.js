const express = require('express');
const router = express.Router();

// Import controllers
const {
    mintLinkToken,
    verifyWebhook,
    handleWebhook,
} = require('../controllers/whatsapp/WhatsAppController.js');

// Import middleware
const auth = require('../middlewares/Auth/auth.js');
const { webhookRateLimiter } = require('../middlewares/rateLimiting.js');

// Meta webhook verification handshake (GET) — echoes hub.challenge.
router.get('/webhook', verifyWebhook);

// Inbound Meta WhatsApp webhook (no auth — verified by X-Hub-Signature-256 over
// the raw body). The raw-body parser for this exact path is registered in
// api/app.js before express.json(), mirroring the Stripe webhook.
router.post('/webhook', webhookRateLimiter, handleWebhook);

// Mint a one-time WhatsApp link token for the logged-in user (auth required).
router.post('/mint-link-token', auth, mintLinkToken);

module.exports = router;

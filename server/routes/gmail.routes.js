/**
 * gmail.routes.js
 *
 * Routes for the shared ESF inbox. Additive — the only shared file touched is
 * api/app.js, and nothing here changes existing behaviour.
 *
 * Auth mirrors zoho.routes.js: the surface sits behind esfAuth (which already admits
 * accessType 'superAdmin' alongside 'esfUser'), with connect/disconnect/watch further
 * limited to owner/admin in the controller — one shared company credential granting
 * read access to every client conversation.
 *
 * - GET    /api/gmail/status         connection health
 * - GET    /api/gmail/auth/url       consent URL (owner/admin)
 * - GET    /api/gmail/auth/callback  OAuth redirect target (NO auth — see below)
 * - DELETE /api/gmail/disconnect     forget the connection (owner/admin)
 * - POST   /api/gmail/watch          start or renew the push watch (owner/admin)
 */

const express = require('express');
const router = express.Router();
const esfAuth = require('../middlewares/Auth/esfAuth.js');
const {
    getGmailStatus,
    startGmailAuth,
    handleGmailCallback,
    disconnectGmail,
    startGmailWatch,
} = require('../controllers/integration/GmailController.js');

router.get('/status', esfAuth, getGmailStatus);
router.get('/auth/url', esfAuth, startGmailAuth);

// Unauthenticated by necessity: the browser lands here via a redirect from Google, which
// does not carry our SameSite cookies. The single-use CSRF state is what protects it.
router.get('/auth/callback', handleGmailCallback);

router.delete('/disconnect', esfAuth, disconnectGmail);
router.post('/watch', esfAuth, startGmailWatch);

module.exports = router;

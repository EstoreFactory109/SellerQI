const express = require('express');
const router = express.Router();

const auth = require('../middlewares/Auth/auth.js');
const { getLoggedInUserLocation } = require('../controllers/user-auth/UserLocationController.js');

/**
 * Standalone router for the user-location endpoint.
 *
 * This router is intentionally isolated from the existing profile / token /
 * user routers so it cannot accidentally alter their behavior. It exposes a
 * single read-only endpoint used by the onboarding ConnectAccounts page.
 *
 * GET /app/user-location
 *   - Requires a valid IBEXAccessToken cookie (enforced by `auth` middleware).
 *   - Responds with { country, region } for the authenticated user.
 */
router.get('/', auth, getLoggedInUserLocation);

module.exports = router;

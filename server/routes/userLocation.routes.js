const express = require('express');
const router = express.Router();

const auth = require('../middlewares/Auth/auth.js');
const { getLocationOptional } = require('../middlewares/Auth/getLocation.js');
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
// getLocationOptional: the session's marketplace, when there is one, is a fallback.
router.get('/', auth, getLocationOptional, getLoggedInUserLocation);

module.exports = router;

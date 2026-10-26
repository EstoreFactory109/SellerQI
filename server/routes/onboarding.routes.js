const express = require('express');
const router = express.Router();

const auth = require('../middlewares/Auth/auth.js');
const { getLocationOptional } = require('../middlewares/Auth/getLocation.js');
const {
    requireEnabled,
    getChecklist,
    createOauthState,
    sellerCentralCallback,
    confirmMarketplaces,
    adsCallback,
    saveAdsProfiles,
    startFetches,
} = require('../controllers/user-auth/OnboardingMarketplacesController.js');

/**
 * Multi-marketplace onboarding (/app/onboarding): connect each Amazon region once, confirm its
 * marketplaces. On by default; MULTI_MARKETPLACE_ONBOARDING_ENABLED=false switches it off (the
 * _USERS allowlist still gets it). The checklist read tells the client which flow to show.
 *
 * getLocationOptional: the session's marketplace, when there is one, lets the endpoints that
 * point the session at the main marketplace skip a cookie that is already right.
 */
router.get('/marketplaces', auth, getChecklist);
router.post('/oauth-state', auth, requireEnabled, createOauthState);
router.post('/spapi/callback', auth, requireEnabled, sellerCentralCallback);
router.post('/marketplaces', auth, requireEnabled, getLocationOptional, confirmMarketplaces);
router.post('/ads/callback', auth, requireEnabled, adsCallback);
router.post('/ads/profiles', auth, requireEnabled, saveAdsProfiles);
router.post('/start', auth, requireEnabled, getLocationOptional, startFetches);

module.exports = router;

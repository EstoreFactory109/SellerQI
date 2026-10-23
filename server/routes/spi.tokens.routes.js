const {
  generateSPAPITokens,
  SaveAllDetails,
  generateAmazonAdsTokens,
  generateAdsTokensForClient,
  saveDetailsOfOtherAccounts,
  deleteAmazonAdsRefreshToken,
  deleteAllSellerRefreshTokens
} = require('../controllers/user-auth/TokenControllers');
const {
  getSellerAccountsForUser,
} = require('../controllers/user-auth/AccountIntegrationController.js');
const auth =require('../middlewares/Auth/auth.js')
const agencyAuth = require('../middlewares/Auth/agencyAuth.js');
// Cookie-only on purpose: connect/disconnect flows act on the marketplace the onboarding flow put
// in the cookie, which may not be a connected (owned) marketplace yet. A page's X-Marketplace
// header must never redirect a token write or delete to a different marketplace.
const {getLocationCookieOnly: getLocation}=require('../middlewares/Auth/getLocation.js');
const { invalidateMarketplaceAccessAfter } = require('../utils/marketplaceAccess.js');
const express=require('express');
const router=express.Router();

// Every route here can add, change or remove a connected marketplace.
router.use(invalidateMarketplaceAccessAfter);

router.post('/generateSPAPITokens', auth, getLocation, generateSPAPITokens);
router.post('/SaveAllDetails', auth, SaveAllDetails);
router.post('/generateAdsTokens', auth, getLocation, generateAmazonAdsTokens);
router.post('/generateAdsTokensForClient', agencyAuth, generateAdsTokensForClient);
router.post('/saveDetailsOfOtherAccounts', auth, getLocation, saveDetailsOfOtherAccounts);

// Fresh seller accounts for Account Integrations page (no cached dashboard data)
router.get('/seller-accounts', auth, getSellerAccountsForUser);

// Token deletion routes for seller accounts (use current IBEXLocationToken)
router.delete('/deleteAdsRefreshToken', auth, getLocation, deleteAmazonAdsRefreshToken);
router.delete('/deleteAllSellerRefreshTokens', auth, getLocation, deleteAllSellerRefreshTokens);

module.exports=router;
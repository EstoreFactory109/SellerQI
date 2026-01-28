const {
  generateSPAPITokens,
  SaveAllDetails,
  generateAmazonAdsTokens,
  saveDetailsOfOtherAccounts,
  deleteAmazonAdsRefreshToken,
  deleteAllSellerRefreshTokens
} = require('../controllers/user-auth/TokenControllers');
const {
  getSellerAccountsForUser,
} = require('../controllers/user-auth/AccountIntegrationController.js');
const auth =require('../middlewares/Auth/auth.js')
const {getLocation}=require('../middlewares/Auth/getLocation.js');
const express=require('express');
const router=express.Router();

router.post('/generateSPAPITokens', auth, getLocation, generateSPAPITokens);
router.post('/SaveAllDetails', auth, SaveAllDetails);
router.post('/generateAdsTokens', auth, getLocation, generateAmazonAdsTokens);
router.post('/saveDetailsOfOtherAccounts', auth, getLocation, saveDetailsOfOtherAccounts);

// Fresh seller accounts for Account Integrations page (no cached dashboard data)
router.get('/seller-accounts', auth, getSellerAccountsForUser);

// Token deletion routes for seller accounts (use current IBEXLocationToken)
router.delete('/deleteAdsRefreshToken', auth, getLocation, deleteAmazonAdsRefreshToken);
router.delete('/deleteAllSellerRefreshTokens', auth, getLocation, deleteAllSellerRefreshTokens);

module.exports=router;
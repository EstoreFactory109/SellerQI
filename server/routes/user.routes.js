const express=require('express');
const router=express.Router();
const {registerUser,registerAgencyClient,verifyUser,loginUser,profileUser,logoutUser,refreshAccessToken,updateProfilePic,updateDetails,switchAccount,verifyEmailForPasswordReset,resetPassword,TrackIP,getIPTracking, googleLoginUser,googleRegisterUser, updateSubscriptionPlan, activateFreeTrial, checkTrialStatus, getAdminProfile, getAdminClients, removeAdminClient, getAdminBillingInfo, resendOtp, superAdminUpdateUserPassword, checkFirstAnalysisStatus}=require('../controllers/user-auth/UserController.js')
const registerValidate=require('../middlewares/validator/registerValidate.js')
const validateLogin =require('../middlewares/validator/LoginValidate.js');
const { validatePasswordResetEmail, validateResetPasswordCode, validateNewPassword } = require('../middlewares/validator/passwordResetValidate.js');
const { validateOtpResend } = require('../middlewares/validator/otpValidate.js');
const { validateUpdateDetails } = require('../middlewares/validator/updateDetailsValidate.js');
const { validateGoogleIdToken } = require('../middlewares/validator/googleAuthValidate.js');
const { validateAgencyClientRegistration } = require('../middlewares/validator/agencyClientValidate.js');
const { validateUpdateSubscriptionPlan } = require('../middlewares/validator/subscriptionValidate.js');
const auth=require('../middlewares/Auth/auth.js')
const upload=require('../middlewares/multer/multer.js')
const {verifyResetPasswordCode}=require('../controllers/user-auth/UserController.js')
const { authRateLimiter, registerRateLimiter, passwordResetRateLimiter, otpRateLimiter } = require('../middlewares/rateLimiting.js');



// Rate limiting applied to authentication endpoints
router.post('/register', registerRateLimiter, registerValidate, registerUser);
router.post('/login', authRateLimiter, validateLogin, loginUser);
router.post('/verify-user', authRateLimiter, verifyUser);
router.get('/profile', auth, profileUser);
router.post('/refresh-token', refreshAccessToken); // No auth middleware - uses refresh token from cookie
router.get('/logout', auth, logoutUser);
router.put('/updateProfilePic', auth, upload.single('avatar'), updateProfilePic);
router.put('/updateDetails', auth, validateUpdateDetails, updateDetails);
router.post('/switch-account', auth, switchAccount);
router.post('/verify-email-for-password-reset', passwordResetRateLimiter, validatePasswordResetEmail, verifyEmailForPasswordReset);
router.post('/verify-reset-password-code', passwordResetRateLimiter, validateResetPasswordCode, verifyResetPasswordCode);
router.post('/reset-password', passwordResetRateLimiter, validateNewPassword, resetPassword);
router.post('/track-ip', TrackIP);
router.post('/get-ip-tracking', getIPTracking);
router.put('/update-subscription-plan', auth, validateUpdateSubscriptionPlan, updateSubscriptionPlan); // New route
router.post('/activate-free-trial', auth, activateFreeTrial); // New route for free trial (no body params needed)
router.get('/check-trial-status', auth, checkTrialStatus); // New route for checking trial status
router.get('/check-first-analysis-status', auth, checkFirstAnalysisStatus); // Route to check if first analysis is complete


router.post('/google-login', authRateLimiter, validateGoogleIdToken, googleLoginUser);
router.post('/google-register', registerRateLimiter, validateGoogleIdToken, googleRegisterUser);
router.post('/register-agency-client', auth, validateAgencyClientRegistration, registerAgencyClient);

// Admin routes
router.get('/admin/profile', auth, getAdminProfile);
router.get('/admin/clients', auth, getAdminClients);
router.delete('/admin/clients/:clientId', auth, removeAdminClient);
router.get('/admin/billing', auth, getAdminBillingInfo);
router.post('/resend-otp', otpRateLimiter, validateOtpResend, resendOtp);

// Super Admin routes
router.put('/super-admin/update-user-password', auth, superAdminUpdateUserPassword);

module.exports=router;
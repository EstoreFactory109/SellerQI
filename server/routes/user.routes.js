const express=require('express');
const router=express.Router();
const {registerUser,registerAgencyClient,verifyUser,loginUser,profileUser,logoutUser,updateProfilePic,updateDetails,switchAccount,verifyEmailForPasswordReset,resetPassword,TrackIP,getIPTracking, googleLoginUser,googleRegisterUser, updateSubscriptionPlan, activateFreeTrial, getAdminProfile, getAdminClients, removeAdminClient, getAdminBillingInfo }=require('../controllers/UserController.js')
const registerValidate=require('../middlewares/validator/registerValidate.js')
const validateLogin =require('../middlewares/validator/LoginValidate.js');
const auth=require('../middlewares/Auth/auth.js')
const upload=require('../middlewares/multer/multer.js')
const {verifyResetPasswordCode}=require('../controllers/UserController.js')



router.post('/register',registerUser);
router.post('/login',validateLogin,loginUser);
router.post('/verify-user',verifyUser);
router.get('/profile',auth,profileUser);
router.get('/logout',auth,logoutUser);
router.put('/updateProfilePic',auth,upload.single('avatar'),updateProfilePic);
router.put('/updateDetails',auth,updateDetails);
router.post('/switch-account',auth,switchAccount);
router.post('/verify-email-for-password-reset',verifyEmailForPasswordReset);
router.post('/verify-reset-password-code',verifyResetPasswordCode);
router.post('/reset-password', resetPassword);
router.post('/track-ip', TrackIP);
router.post('/get-ip-tracking', getIPTracking);
router.put('/update-subscription-plan', auth, updateSubscriptionPlan); // New route
router.post('/activate-free-trial', auth, activateFreeTrial); // New route for free trial


router.post('/google-login', googleLoginUser);
router.post('/google-register', googleRegisterUser);
router.post('/register-agency-client', auth, registerAgencyClient);

// Admin routes
router.get('/admin/profile', auth, getAdminProfile);
router.get('/admin/clients', auth, getAdminClients);
router.delete('/admin/clients/:clientId', auth, removeAdminClient);
router.get('/admin/billing', auth, getAdminBillingInfo);

module.exports=router;
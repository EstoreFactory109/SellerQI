const express=require('express');
const router=express.Router();
const {registerUser,verifyUser,loginUser,profileUser,logoutUser,updateProfilePic,updateDetails,switchAccount,verifyEmailForPasswordReset,resetPassword,TrackIP,getIPTracking, googleLoginUser,googleRegisterUser }=require('../controllers/UserController.js')
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


router.post('/google-login', googleLoginUser);
router.post('/google-register', googleRegisterUser);
module.exports=router;
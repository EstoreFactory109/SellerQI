const express=require('express');
const router=express.Router();
const {registerUser,verifyUser,loginUser,profileUser,logoutUser}=require('../controllers/UserController.js')
const registerValidate=require('../middlewares/validator/registerValidate.js')
const validateLogin =require('../middlewares/validator/LoginValidate.js');
const auth=require('../middlewares/Auth/auth.js')



router.post('/register',registerUser);
router.post('/login',validateLogin,loginUser);
router.post('/verify-user',verifyUser);
router.get('/profile',auth,profileUser);
router.get('/logout',auth,logoutUser);

module.exports=router;
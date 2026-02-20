const express=require('express');
const router=express.Router();
const {getProfileId,saveProfileId}=require('../controllers/user-auth/profileIdController.js');
const authMiddleware=require('../middlewares/Auth/auth.js');
const {getLocation}=require('../middlewares/Auth/getLocation.js');
const { validateSaveProfileId } = require('../middlewares/validator/profileValidate.js');

router.get('/getProfileId',authMiddleware,getLocation,getProfileId);
router.post('/saveProfileId',authMiddleware,getLocation,validateSaveProfileId,saveProfileId);

module.exports=router;
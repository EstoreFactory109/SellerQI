const express=require('express');
const router=express.Router();
const {getProfileId,saveProfileId}=require('../controllers/profileIdController.js');
const authMiddleware=require('../middlewares/Auth/auth.js');
const {getLocation}=require('../middlewares/Auth/getLocation.js');

router.get('/getProfileId',authMiddleware,getLocation,getProfileId);
router.post('/saveProfileId',authMiddleware,getLocation,saveProfileId);

module.exports=router;
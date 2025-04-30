const {generateSPAPITokens,SaveAllDetails,addNewAccount}=require('../controllers/TokenControllers');
const auth =require('../middlewares/Auth/auth.js')
const express=require('express');
const router=express.Router();

router.get('/generateSPAPITokens/:payload',auth,generateSPAPITokens);
router.post('/SaveAllDetails',auth,SaveAllDetails);
router.post('/addNewAccount',auth,addNewAccount);

module.exports=router;
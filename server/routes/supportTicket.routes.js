const express=require("express");
const {createSupportTicket}=require("../controllers/system/SupportController");
const router=express.Router();

router.post("",createSupportTicket);

module.exports=router;
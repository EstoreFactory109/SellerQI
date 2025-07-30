const express=require("express");
const {createSupportTicket}=require("../controllers/SupportController");
const router=express.Router();

router.post("",createSupportTicket);

module.exports=router;
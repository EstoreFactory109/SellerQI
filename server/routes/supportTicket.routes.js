const express=require("express");
const {createSupportTicket}=require("../controllers/system/SupportController");
const { validateSupportTicket } = require("../middlewares/validator/supportTicketValidate.js");
const router=express.Router();

router.post("", validateSupportTicket, createSupportTicket);

module.exports=router;
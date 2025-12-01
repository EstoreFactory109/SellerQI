const Support=require('../../models/system/SupportModel');
const {sendEmail}=require('../../Services/Email/SendClientMessageEmail');
const {ApiResponse}=require('../../utils/ApiResponse');
const {ApiError}=require('../../utils/ApiError');
const logger=require('../../utils/Logger');
const asyncHandler=require('../../utils/AsyncHandler.js');

const createSupportTicket=asyncHandler(async(req,res)=>{
    const {email,name,subject,message,topic}=req.body;

    if(!email || !name || !subject || !message || !topic){
        logger.error(new ApiError(400,"Invalid request body"));
        return res.status(400).json(new ApiResponse(400,"","Invalid request body"));
    }
   
    const supportTicket=await Support.create({email,name,subject,message,topic});

    if(!supportTicket){
        logger.error(new ApiError(500,"Error in creating support ticket"));
        return res.status(500).json(new ApiResponse(500,"","Error in creating support ticket"));
    }
    const SendEmailResponse=await sendEmail(email,name,message,subject,topic);
    if(!SendEmailResponse){
        logger.error(new ApiError(500,"Error in sending email"));
        return res.status(500).json(new ApiResponse(500,"","Error in sending email"));
    }
    return res.status(201).json(new ApiResponse(201,"","Support ticket created successfully"));
})

module.exports={createSupportTicket};
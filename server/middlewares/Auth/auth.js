const {verifyAccessToken}=require('../../utils/Tokens');
const {ApiError}=require('../../utils/ApiError');
const asyncHandler = require('../../utils/AsyncHandler');
const logger = require('../../utils/Logger');
const { ApiResponse } = require('../../utils/ApiResponse');

const auth=asyncHandler(async(req,res,next)=>{
    const accesstoken=req.cookies.IBEXAccessToken;
    const adminToken=req.cookies.AdminToken;
    console.log("adminToken: ",adminToken.length)
    
    if(!accesstoken){
        logger.error(new ApiError(401,"Unauthorized"));
        return res.status(401).json(new ApiResponse(401,"","Unauthorized"));
    }

    const decoded=await verifyAccessToken(accesstoken);
    if(!decoded){
        logger.error(new ApiError(400,"Invalid access token"));
        return res.status(400).json(new ApiResponse(400,"","Invalid access token"));
    }

    if(adminToken.length!==0){
        const decodedAdmin=await verifyAccessToken(adminToken);
        if(!decodedAdmin){
            logger.error(new ApiError(400,"Invalid admin token"));
            return res.status(400).json(new ApiResponse(400,"","Invalid admin token"));
        }
        req.adminId=decodedAdmin.tokenData;
    }else{
        req.adminId=null;
    }

    if(decoded.isvalid){
        req.userId=decoded.tokenData;
        next();
    }else{
        return res.status(401).json(new ApiResponse(401,"","Access token expired"));
    }
    
})

module.exports=auth;
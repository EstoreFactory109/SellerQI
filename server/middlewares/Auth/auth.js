const {verifyAccessToken, verifyAgencyOwnerToken}=require('../../utils/Tokens');
const {ApiError}=require('../../utils/ApiError');
const asyncHandler = require('../../utils/AsyncHandler');
const logger = require('../../utils/Logger');
const { ApiResponse } = require('../../utils/ApiResponse');

const auth=asyncHandler(async(req,res,next)=>{
    const accesstoken=req.cookies.IBEXAccessToken;
    const adminToken=req.cookies.AdminToken;
    const agencyOwnerToken=req.cookies.agencyOwnerCookie;
    
    if(adminToken) {
        console.log("adminToken: ",adminToken.length)
    }
    
    if(!accesstoken){
        logger.error(new ApiError(401,"Unauthorized"));
        return res.status(401).json(new ApiResponse(401,"","Unauthorized"));
    }

    const decoded=await verifyAccessToken(accesstoken);
    if(!decoded){
        logger.error(new ApiError(400,"Invalid access token"));
        return res.status(400).json(new ApiResponse(400,"","Invalid access token"));
    }

    if(adminToken && adminToken.length!==0){
        const decodedAdmin=await verifyAccessToken(adminToken);
        if(!decodedAdmin){
            logger.error(new ApiError(400,"Invalid admin token"));
            return res.status(400).json(new ApiResponse(400,"","Invalid admin token"));
        }
        req.adminId=decodedAdmin.tokenData;
    }else{
        req.adminId=null;
    }

    // Check for agency owner token
    if(agencyOwnerToken && agencyOwnerToken.length!==0){
        const decodedAgencyOwner=await verifyAgencyOwnerToken(agencyOwnerToken);
        if(!decodedAgencyOwner){
            logger.error(new ApiError(400,"Invalid agency owner token"));
            return res.status(400).json(new ApiResponse(400,"","Invalid agency owner token"));
        }
        req.agencyOwnerId=decodedAgencyOwner.agencyOwnerId;
    }else{
        req.agencyOwnerId=null;
    }

    if(decoded.isvalid){
        req.userId=decoded.tokenData;
        next();
    }else{
        return res.status(401).json(new ApiResponse(401,"","Access token expired"));
    }
    
})

// Middleware specifically for agency owners
const agencyAuth=asyncHandler(async(req,res,next)=>{
    const agencyOwnerToken=req.cookies.agencyOwnerCookie;
    
    if(!agencyOwnerToken){
        logger.error(new ApiError(401,"Agency owner token required"));
        return res.status(401).json(new ApiResponse(401,"","Agency owner access required"));
    }

    const decoded=await verifyAgencyOwnerToken(agencyOwnerToken);
    if(!decoded || !decoded.isvalid){
        logger.error(new ApiError(400,"Invalid agency owner token"));
        return res.status(400).json(new ApiResponse(400,"","Invalid agency owner token"));
    }

    req.agencyOwnerId=decoded.agencyOwnerId;
    next();
})

module.exports={auth,agencyAuth};
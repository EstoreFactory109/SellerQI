const {ApiError}=require('../../utils/ApiError');
const asyncHandler = require('../../utils/AsyncHandler');
const logger = require('../../utils/Logger');
const { ApiResponse } = require('../../utils/ApiResponse');
const {verifyLocationToken}=require('../../utils/Tokens');

const getLocation=asyncHandler(async(req,res,next)=>{
    const locationtoken=req.cookies.IBEXLocationToken;

    if(!locationtoken){
        logger.error(new ApiError(401,"Unauthorized"));
        return res.status(401).json(new ApiResponse(401,"","Unauthorized"));
    }
    const decoded=await verifyLocationToken(locationtoken);

   
    if(!decoded){
        logger.error(new ApiError(400,"Invalid location token"));
        return res.status(400).json(new ApiResponse(400,"","Invalid location token"));
    }

    if(decoded){
        req.country=decoded.country;
        req.region=decoded.region;
        next();
    }else{
        return res.status(401).json(new ApiResponse(401,"","Location token expired"));
    }
    
})

module.exports={getLocation};
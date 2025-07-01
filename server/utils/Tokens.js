var jwt = require('jsonwebtoken');
const logger = require('../utils/Logger.js');
const User = require('../models/userModel.js');
const {ApiError}=require('./ApiError.js')


const createAccessToken=async(userId)=>{
    if(!userId){
        logger.error(new ApiError(400,"User ID is missing"));
        return false;
    }
    const accessToken=jwt.sign({id:userId},process.env.JWT_SECRET,{expiresIn:'15d'});
   
    return accessToken;
}

const createRefreshToken=async(userId)=>{
    if(!userId){
        logger.error(new ApiError(400,"User ID is missing"));
        return false;
    }
    const refreshToken=jwt.sign({id:userId},process.env.JWT_SECRET);
    return refreshToken;
}

// Agency owner token functions
const createAgencyOwnerToken=async(userId)=>{
    if(!userId){
        logger.error(new ApiError(400,"User ID is missing"));
        return false;
    }
    const agencyOwnerToken=jwt.sign({agencyOwnerId:userId},process.env.JWT_SECRET,{expiresIn:'30d'});
   
    return agencyOwnerToken;
}

const verifyAgencyOwnerToken=async(token)=>{
    if(!token){
        logger.error(new ApiError(400,"Agency owner token is missing"));
        return false;
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if(!decoded || !decoded.agencyOwnerId){
            logger.error(new ApiError(400,"Invalid agency owner token"));
            return false;
        }
        const tokenResponse={
            agencyOwnerId:decoded.agencyOwnerId,
            isvalid:true
        }   
        return tokenResponse;
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            const tokenResponse={
                agencyOwnerId:null,
                isvalid:false
            }
            return tokenResponse;
        }else{
            logger.error(new ApiError(500,"Internal server error in verifying agency owner token"));
            return false;
        } 
    }
}

const createLocationToken=async(country,region)=>{
    if(!country || !region){
        logger.error(new ApiError(400,"Country and region is missing"));
        return false;
    }
    const locationToken=jwt.sign({country:country,region:region},process.env.JWT_SECRET);
    return locationToken;
}

const verifyAccessToken=async(token)=>{
    if(!token){
        logger.error(new ApiError(400,"Token is missing"));
        return false;
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log(decoded)
        if(!decoded){
            logger.error(new ApiError(400,"Invalid token"));
            return false;
        }
        const tokenResponse={
            tokenData:decoded.id,
            isvalid:true
        }   
        return tokenResponse;
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            const tokenResponse={
                tokenData:null,
                isvalid:false
            }
            return tokenResponse;
        }else{
            logger.error(new ApiError(500,"Internal server error in verifying access token"));
            return false;} 
    }
}

const refreshAccess=async(token)=>{
    if(!token){
        logger.error(new ApiError(400,"Token is missing"));
        return false;
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const CheckUserRefreshToken=await User.findById(decoded.id).select('appRefreshToken');
        if(!CheckUserRefreshToken){
            logger.error(new ApiError(404,"User not found"));
            return false;
        }

        if(CheckUserRefreshToken.appRefreshToken!==token){
            logger.error(new ApiError(400,"Invalid token"));
            return false;
        }
        const accessToken=await createAccessToken(decoded.id);
        return accessToken;
    } catch (error) {
        logger.error(new ApiError(400,"Invalid token"));
        return false;
    }
}

const verifyLocationToken=async(token)=>{
    if(!token){
        logger.error(new ApiError(400,"Token is missing"));
        return false;
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return decoded;
    } catch (error) {
        logger.error(new ApiError(400,"Invalid token"));
        return false;
    }
}

module.exports={createAccessToken,createRefreshToken,createAgencyOwnerToken,verifyAgencyOwnerToken,createLocationToken,verifyAccessToken,refreshAccess,verifyLocationToken}
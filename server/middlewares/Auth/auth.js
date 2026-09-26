const {verifyAccessToken}=require('../../utils/Tokens');
const {ApiError}=require('../../utils/ApiError');
const asyncHandler = require('../../utils/AsyncHandler');
const logger = require('../../utils/Logger');
const { ApiResponse } = require('../../utils/ApiResponse');
const AccountMember = require('../../models/user-auth/AccountMemberModel.js');

const auth=asyncHandler(async(req,res,next)=>{
    const accesstoken=req.cookies.IBEXAccessToken;
    const adminToken=req.cookies.AdminToken;
    const superAdminToken=req.cookies.SuperAdminToken;
    
    
    
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

    // Check for SuperAdminToken to track super admin session
    if(superAdminToken && superAdminToken.length!==0){
        const decodedSuperAdmin=await verifyAccessToken(superAdminToken);
        if(decodedSuperAdmin && decodedSuperAdmin.isvalid){
            req.isSuperAdminSession=true;
            req.superAdminId=decodedSuperAdmin.tokenData;
        }else{
            req.isSuperAdminSession=false;
            req.superAdminId=null;
        }
    }else{
        req.isSuperAdminSession=false;
        req.superAdminId=null;
    }

    if(decoded.isvalid){
        req.userId=decoded.tokenData;

        // A member signed in to this account (their token names them - see
        // createAccessToken). Once the owner removes them the row is gone, and this
        // refuses every request their token makes, cookie or no cookie.
        if(decoded.memberId){
            const stillMember=await AccountMember.exists({_id:decoded.memberId,owner:decoded.tokenData,status:'active'});
            if(!stillMember){
                logger.warn(`Refused a request from removed member ${decoded.memberId} of account ${decoded.tokenData}`);
                return res.status(401).json(new ApiResponse(401,"","Your access to this account has been removed"));
            }
            req.memberId=decoded.memberId;
        }

        next();
    }else{
        return res.status(401).json(new ApiResponse(401,"","Access token expired"));
    }
    
})

module.exports=auth;
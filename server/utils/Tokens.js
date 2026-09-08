var jwt = require('jsonwebtoken');
const logger = require('../utils/Logger.js');
const User = require('../models/user-auth/userModel.js');
const {ApiError}=require('./ApiError.js')


// How long a signed-in session survives, and how many devices can hold one at
// once. The oldest entry is dropped past the cap.
const REFRESH_TOKEN_TTL = '90d';
const MAX_REFRESH_TOKENS = 5;

// Access and refresh tokens carry the same {id} payload signed with the same
// secret, so without this claim a refresh token is accepted anywhere an access
// token is expected. Same guard as `purpose` on the WhatsApp link token below.
const ACCESS = 'access';
const REFRESH = 'refresh';

const createAccessToken=async(userId)=>{
    if(!userId){
        logger.error(new ApiError(400,"User ID is missing"));
        return false;
    }
    const accessToken=jwt.sign({id:userId,type:ACCESS},process.env.JWT_SECRET,{expiresIn:'15d'});

    return accessToken;
}

// Minting and recording are deliberately one operation. There are 17 call sites,
// and a token that is issued but not recorded is silently unusable — the user
// logs in fine, then cannot refresh. That was the original bug; keeping these
// coupled makes it unrepeatable.
//
// A failed write is logged loudly but still returns the token: the access token
// remains valid for 15 days, so a transient DB error degrades that one session
// rather than blocking the login outright.
const createRefreshToken=async(userId)=>{
    if(!userId){
        logger.error(new ApiError(400,"User ID is missing"));
        return false;
    }
    const refreshToken=jwt.sign({id:userId,type:REFRESH},process.env.JWT_SECRET,{expiresIn:REFRESH_TOKEN_TTL});
    try {
        await User.findByIdAndUpdate(userId,{
            $push:{refreshTokens:{$each:[refreshToken],$slice:-MAX_REFRESH_TOKENS}}
        });
    } catch (error) {
        logger.error(`Error recording refresh token session for ${userId}: ${error}`);
    }
    return refreshToken;
}

// Ends one session, leaving this user's other devices signed in. Keyed on the
// token alone: it is unique, and the caller's own id is the wrong one to trust
// under impersonation and agency client-switching, where the presented cookie
// belongs to a different user than the request's `userId`.
const revokeRefreshToken=async(token)=>{
    if(!token){
        logger.error(new ApiError(400,"Token is missing"));
        return false;
    }
    try {
        await User.updateOne({refreshTokens:token},{$pull:{refreshTokens:token}});
        return true;
    } catch (error) {
        logger.error(`Error revoking refresh token: ${error}`);
        return false;
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
        // console.log(decoded)
        if(!decoded){
            logger.error(new ApiError(400,"Invalid token"));
            return false;
        }
        if(decoded.type!==ACCESS){
            logger.error(new ApiError(400,"Token is not an access token"));
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
        if(decoded.type!==REFRESH){
            logger.error(new ApiError(400,"Token is not a refresh token"));
            return false;
        }
        const CheckUserRefreshToken=await User.findById(decoded.id).select('refreshTokens');
        if(!CheckUserRefreshToken){
            logger.error(new ApiError(404,"User not found"));
            return false;
        }

        if(!(CheckUserRefreshToken.refreshTokens||[]).includes(token)){
            logger.error(new ApiError(400,"Refresh token is not an active session"));
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

const createDemoAccessToken = async (userId) => {
    if (!userId) {
        logger.error(new ApiError(400, "User ID is missing"));
        return false;
    }
    const token = jwt.sign({ id: userId, type: ACCESS }, process.env.JWT_SECRET, { expiresIn: '1h' });
    return token;
};

// Short-lived, single-purpose token used to link a WhatsApp number to a user.
// Minted inside an authenticated web session and carried through a wa.me deep
// link. The `purpose` claim prevents this token from being accepted anywhere a
// normal access token is expected (and vice-versa).
const createLinkToken = async (userId) => {
    if (!userId) {
        logger.error(new ApiError(400, "User ID is missing"));
        return false;
    }
    const ttl = process.env.WHATSAPP_LINK_TOKEN_TTL || '10m';
    const token = jwt.sign({ id: userId, purpose: 'wa_link' }, process.env.JWT_SECRET, { expiresIn: ttl });
    return token;
};

const verifyLinkToken = async (token) => {
    if (!token) {
        logger.error(new ApiError(400, "Token is missing"));
        return false;
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded || decoded.purpose !== 'wa_link' || !decoded.id) {
            logger.error(new ApiError(400, "Invalid link token"));
            return false;
        }
        return { userId: decoded.id, isvalid: true };
    } catch (error) {
        // Expired or tampered token — treat as invalid, let caller re-prompt.
        return false;
    }
};

module.exports={createAccessToken, createRefreshToken,revokeRefreshToken,verifyAccessToken,refreshAccess,createLocationToken,verifyLocationToken,createDemoAccessToken,createLinkToken,verifyLinkToken,MAX_REFRESH_TOKENS};
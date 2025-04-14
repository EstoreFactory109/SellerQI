const User=require('../../models/userModel');
const logger = require('../../utils/Logger.js');
const credentials=require('./config.js');
const { ApiError } = require('../../utils/ApiError');
const axios=require('axios');

const generateRefreshToken=async(userId,authCode)=>{
    const refreshToken="Atzr|IwEBIE8XvnBL06gubRhb6QwVwwhtTK7k7778EJ4oUGc8NMv3w2KFGwKhP8NBR2X63lmh7kS5nRcX306AXThHPHCJgglzJQAr7ziNtP4KN5KbjapAcGqz8VMTJIuVjw7GtQNjeU9-ciUMH9dfCZHjVEnLJgIEyugth7HiBOWXHEu9ohwlo1OUe0ung38C3z_YMGmWUBJ-A_WYYyJW1BdcNpK9QOPtFg--FUmfMo-Sq8VdLV2bBuFZ3QedkvpV1KR9zfa5ElM7IITaRvRF_hUydUg71N2Z1rlTC9oeezpijZ8aXHqQi4iGIcYFHkDJcUr3Gq4seD8";
    if(!userId){
        logger.error(new ApiError(400,"User ID is missing"));
        return false;
    }
    const getUser=await User.findById(userId);
    if(!getUser){
        logger.error(new ApiError(404,"User not found"));
        return false;
    }
    getUser.spiRefreshToken=refreshToken;
    await getUser.save();
    return refreshToken;;
}

const generateAccessToken=async(userId,refreshToken)=>{
    if(!refreshToken){
        logger.error(new ApiError(400,"Refresh token is missing"));
        return false;
    }

    const clientId=credentials.clientId;
    const clientSecret=credentials.clientSecret;

    
    try {
        const response = await axios.post(
                    "https://api.amazon.com/auth/o2/token",
                    new URLSearchParams({
                        grant_type: "refresh_token",
                        refresh_token: refreshToken,
                        client_id: clientId,
                        client_secret: clientSecret
                    }),
                    {
                        headers: { "Content-Type": "application/x-www-form-urlencoded" }
                    }
                );
            if(!response){
                logger.error(new ApiError(500,"Internal server error in generating access token"));
                return false;
            }
            const accessToken = response.data.access_token;
            const getUser=await User.findById(userId);
            getUser.spiAccessToken=accessToken;
            await getUser.save();
            return accessToken;
    } catch (error) {
        logger.error(new ApiError(500, `Error generating access token: ${error.message}`));
        return false; 
    }

}

module.exports={generateRefreshToken,generateAccessToken}
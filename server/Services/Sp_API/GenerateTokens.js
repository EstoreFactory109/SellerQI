const User=require('../../models/userModel');
const logger = require('../../utils/Logger.js');
const credentials=require('./config.js');
const { ApiError } = require('../../utils/ApiError');
const axios=require('axios');

const generateRefreshToken=async(authCode)=>{
    if(!authCode){
        logger.error(new ApiError(400,"auth code is missing"));
        return false;
    }

    const clientId=credentials.clientId;
    const clientSecret=credentials.clientSecret;

    
    try {
        const response = await axios.post(
                    "https://api.amazon.com/auth/o2/token",
                    new URLSearchParams({
                        grant_type: "authorization_code",
                        code: authCode,
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
            const refreshToken = response.data.refresh_token;
            const sellerId=response.data.seller_id;
            return {refreshToken,sellerId};
    } catch (error) {
        logger.error(new ApiError(500, `Error generating access token: ${error.message}`));
        return false; 
    }
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
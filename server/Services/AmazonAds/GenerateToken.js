const axios = require('axios');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');

const generateAdsAccessToken=async(refreshToken)=>{
    if(!refreshToken){
        logger.error(new ApiError(400,"Refresh token is missing"));
        return false;
    }

    const clientId=process.env.AMAZON_ADS_CLIENT_ID;
    const clientSecret=process.env.AMAZON_ADS_CLIENT_SECRET;

    
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

            return accessToken;
    } catch (error) {
        logger.error(new ApiError(500, `Error generating access token: ${error.message}`));
        return false; 
    }

}

module.exports={
    generateAdsAccessToken
}
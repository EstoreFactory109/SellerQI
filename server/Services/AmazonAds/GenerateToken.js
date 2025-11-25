const axios = require('axios');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');

const generateAdsAccessToken=async(refreshToken)=>{
    if(!refreshToken){
        const error = new ApiError(400,"Refresh token is missing");
        logger.error(error);
        throw error;
    }

    const clientId=process.env.AMAZON_ADS_CLIENT_ID;
    const clientSecret=process.env.AMAZON_ADS_CLIENT_SECRET;

    if(!clientId || !clientSecret){
        const error = new ApiError(500, "Amazon Ads client credentials are missing from environment variables");
        logger.error(error);
        throw error;
    }
    
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
            
            if(!response || !response.data){
                const error = new ApiError(500,"Internal server error in generating access token - no response received");
                logger.error(error);
                throw error;
            }

            // Check for error in response
            if(response.data.error){
                const errorMessage = response.data.error_description || response.data.error || 'Unknown error from Amazon token endpoint';
                const error = new ApiError(401, `Amazon Ads token refresh failed: ${errorMessage}`);
                logger.error(error, {
                    errorCode: response.data.error,
                    errorDescription: response.data.error_description
                });
                throw error;
            }

            const accessToken = response.data.access_token;

            if(!accessToken){
                const error = new ApiError(500, "Access token not found in response from Amazon");
                logger.error(error, { responseData: response.data });
                throw error;
            }

            return accessToken;
    } catch (error) {
        // If it's already an ApiError, re-throw it
        if(error instanceof ApiError){
            throw error;
        }

        // Handle axios errors with detailed logging
        if(error.response){
            const status = error.response.status;
            const errorData = error.response.data;
            const errorMessage = errorData?.error_description || errorData?.error || error.message;
            
            // Log detailed error for debugging
            console.error('🔴 Amazon Ads token refresh failed:', {
                status: status,
                error: errorData?.error,
                errorDescription: errorData?.error_description,
                refreshTokenLength: refreshToken?.length
            });
            
            logger.error(new ApiError(status, `Amazon Ads token refresh failed: ${errorMessage}`), {
                status: status,
                errorData: errorData,
                refreshTokenPresent: !!refreshToken
            });
            
            // If it's invalid_grant, the refresh token is expired or invalid
            if (errorData?.error === 'invalid_grant') {
                throw new ApiError(401, `Amazon Ads refresh token is invalid or expired. Please reconnect your Amazon Ads account.`);
            }
            
            throw new ApiError(status, `Amazon Ads token refresh failed: ${errorMessage}`);
        } else if(error.request){
            const error = new ApiError(500, "No response received from Amazon token endpoint");
            logger.error(error);
            throw error;
        } else {
            logger.error(new ApiError(500, `Error generating Ads access token: ${error.message}`));
            throw error;
        }
    }

}

module.exports={
    generateAdsAccessToken
}
const User=require('../../models/userModel');
const logger = require('../../utils/Logger.js');
const credentials=require('./config.js');
const { ApiError } = require('../../utils/ApiError');
const axios=require('axios');

const generateRefreshToken=async(authCode,state)=>{

    if (!authCode) {
        logger.error("Authorization code is missing");
        throw new ApiError(400, "Authorization code is required");
    }

    if (!redirectUri) {
        logger.error("Redirect URI is missing");
        throw new ApiError(400, "Redirect URI is required");
    }

    // Credentials validation
    if (!credentials.clientId || !credentials.clientSecret) {
        logger.error("Missing SP-API credentials");
        throw new ApiError(500, "SP-API credentials not configured");
    }

    const clientId = credentials.clientId;
    const clientSecret = credentials.clientSecret;


    try {
        logger.info(`Exchanging auth code for tokens...`);
        
        // IMPORTANT: redirect_uri MUST be included and match exactly
        const tokenParams = {
            state: state,
            code: authCode,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: "https://www.sellerqi.com/auth/callback"  // CRITICAL: This was missing!
        };

        const response = await axios.post(
            "https://api.amazon.com/auth/o2/token",
            new URLSearchParams(tokenParams),
            {
                headers: { 
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json"
                },
                timeout: 30000 // 30 second timeout
            }
        );
        console.log(response.data)
        // Validate response
        if (!response.data || !response.data.refresh_token) {
            logger.error("Invalid token response from Amazon", response.data);
            throw new ApiError(500, "Invalid response from Amazon token endpoint");
        }

        // Extract all tokens and metadata
        const tokenData = {
            refreshToken: response.data.refresh_token
        };

        logger.info(`Successfully obtained tokens for seller: ${tokenData.sellerId || 'unknown'}`);
        
        return tokenData;

    } catch (error) {
        // Handle specific Amazon API errors
        if (error.response) {
            const status = error.response.status;
            const errorCode = error.response.data?.error;
            const errorDescription = error.response.data?.error_description;
            
            logger.error(`Amazon API error: ${status} - ${errorCode}: ${errorDescription}`);
            
            switch (errorCode) {
                case 'invalid_grant':
                    throw new ApiError(400, "Invalid or expired authorization code");
                case 'invalid_client':
                    throw new ApiError(401, "Invalid client credentials");
                case 'invalid_request':
                    throw new ApiError(400, errorDescription || "Invalid request parameters");
                case 'unauthorized_client':
                    throw new ApiError(403, "Client not authorized for this grant type");
                case 'unsupported_grant_type':
                    throw new ApiError(400, "Unsupported grant type");
                default:
                    throw new ApiError(status || 500, errorDescription || "Failed to exchange authorization code");
            }
        }
        
        // Network or other errors
        logger.error(`Token exchange error: ${error.message}`);
        throw new ApiError(500, error);
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
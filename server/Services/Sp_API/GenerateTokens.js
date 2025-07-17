const User=require('../../models/userModel');
const logger = require('../../utils/Logger.js');
const credentials=require('./config.js');
const { ApiError } = require('../../utils/ApiError');
const axios=require('axios');

 const generateRefreshToken = async (authCode,region) => {
    // Validate required parameters
    if (!authCode) {
        logger.error("Authorization code is missing");
        throw new ApiError(400, "Authorization code is required");
    }

    // Credentials validation
    if (!credentials || !credentials.clientId || !credentials.clientSecret) {
        logger.error("Missing SP-API credentials");
        throw new ApiError(500, "SP-API credentials not configured");
    }


    const clientId = credentials.clientId;
    const clientSecret = credentials.clientSecret;
    const redirectUri = `${baseURL}/auth/callback`; // Define redirect URI

    try {
        logger.info(`Exchanging auth code for tokens...`);
        
        // Build token request parameters according to Amazon's API spec
        const body = {
            grant_type: 'authorization_code',  // CRITICAL: This was missing!
            code: authCode,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret
        };

        // Note: 'state' is not part of the token exchange request
        // It's only used during the authorization request

        const response = await axios.post(
            "https://api.amazon.com/auth/o2/token",
            body,
            {
                headers: { 
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "Accept": "application/json"
                },
                timeout: 30000 // 30 second timeout
            }
        );

        console.log("Token response:", response.data);

        // Validate response
        if (!response.data || !response.data.refresh_token) {
            logger.error("Invalid token response from Amazon", response.data);
            throw new ApiError(500, "Invalid response from Amazon token endpoint");
        }

        // Extract tokens from response
        const tokenData = {
            refreshToken: response.data.refresh_token,
            accessToken: response.data.access_token,
            tokenType: response.data.token_type,
            expiresIn: response.data.expires_in
        };

        logger.info("Successfully obtained tokens");
        
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
                    throw new ApiError(400, "Invalid or expired authorization code. Each code can only be used once.");
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
        throw new ApiError(500, error.message || "Failed to exchange authorization code");
    }
};


const generateAdsRefreshToken = async (authCode,region) => {
    // Validate required parameters
    if (!authCode) {
        logger.error("Authorization code is missing");
        throw new ApiError(400, "Authorization code is required");
    }

    // Credentials validation
    

    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET;
    const redirectUri = "https://www.sellerqi.com/auth/callback"; // Define redirect URI

    try {
        logger.info(`Exchanging auth code for tokens...`);
        
        // Build token request parameters according to Amazon's API spec
        const body = {
            grant_type: 'authorization_code',  // CRITICAL: This was missing!
            code: authCode,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret
        };

        // Note: 'state' is not part of the token exchange request
        // It's only used during the authorization request

        const response = await axios.post(
            "https://api.amazon.com/auth/o2/token",
            body,
            {
                headers: { 
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "Accept": "application/json"
                },
                timeout: 30000 // 30 second timeout
            }
        );

        console.log("Token response:", response.data);

        // Validate response
        if (!response.data || !response.data.refresh_token) {
            logger.error("Invalid token response from Amazon", response.data);
            throw new ApiError(500, "Invalid response from Amazon token endpoint");
        }

        // Extract tokens from response
        const tokenData = {
            refreshToken: response.data.refresh_token
        };

        logger.info("Successfully obtained tokens");
        
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
                    throw new ApiError(400, "Invalid or expired authorization code. Each code can only be used once.");
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
        throw new ApiError(500, error.message || "Failed to exchange authorization code");
    }
};


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

module.exports={generateRefreshToken,generateAccessToken,generateAdsRefreshToken}
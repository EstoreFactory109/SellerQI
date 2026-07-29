const User=require('../../models/user-auth/userModel');
const logger = require('../../utils/Logger.js');
const credentials=require('./config.js');
const { ApiError } = require('../../utils/ApiError');
const axios=require('axios');
const authCache = require('../../utils/authCache.js');

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
    
    // Use environment variable for redirect URI, fallback to production URL
    const redirectUri = 'https://members.sellerqi.com/auth/callback';

    try {
        logger.info(`Exchanging auth code for tokens using redirect URI: ${redirectUri}`);
        logger.info(`Using client ID: ${clientId.substring(0, 10)}...`); // Log partial client ID for debugging
        
        // Build token request parameters according to Amazon's API spec
        // Use URLSearchParams to properly format as application/x-www-form-urlencoded
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code: authCode,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret
        });

        // Note: 'state' is not part of the token exchange request
        // It's only used during the authorization request

        const response = await axios.post(
            "https://api.amazon.com/auth/o2/token",
            body,
            {
                headers: { 
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json"
                },
                timeout: 30000 // 30 second timeout
            }
        );

       

        // Validate response
        if (!response.data || !response.data.refresh_token) {
            logger.error("Invalid token response from Amazon");
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
        if (error.code) {
            logger.error(`Error code: ${error.code}`);
        }
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
    
    // Use environment variable for redirect URI, fallback to production URL
    const redirectUri = process.env.AMAZON_REDIRECT_URI || 'https://members.sellerqi.com/auth/callback';

    try {
        logger.info(`Exchanging ads auth code for tokens using redirect URI: ${redirectUri}`);
        
        // Build token request parameters according to Amazon's API spec
        // Use URLSearchParams to properly format as application/x-www-form-urlencoded
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code: authCode,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret
        });

        // Note: 'state' is not part of the token exchange request
        // It's only used during the authorization request

        const response = await axios.post(
            "https://api.amazon.com/auth/o2/token",
            body,
            {
                headers: { 
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json"
                },
                timeout: 30000 // 30 second timeout
            }
        );

        // Validate response
        if (!response.data || !response.data.refresh_token) {
            logger.error("Invalid token response from Amazon");
            throw new ApiError(500, "Invalid response from Amazon token endpoint");
        }

        // Extract tokens from response
        const tokenData = {
            refreshToken: response.data.refresh_token
        };

        logger.info("Successfully obtained ads tokens");
        
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


// `errorRef` is an optional out-param: on failure we set `errorRef.message` to
// the exact Amazon LWA reason (e.g. "invalid_grant : refresh_token …") so callers
// can surface the real cause to the user instead of a generic "token unavailable".
// Backward compatible — existing 2-arg callers are unaffected.
const generateAccessToken=async(userId,refreshToken,errorRef=null)=>{

    if(!refreshToken){
        logger.error(new ApiError(400,"Refresh token is missing"), { userId });
        if(errorRef) errorRef.message = 'Refresh token is missing';
        return false;
    }

    const clientId=credentials.clientId;
    const clientSecret=credentials.clientSecret;
    
    if(!clientId || !clientSecret){
        logger.error(new ApiError(500,"SP-API credentials not configured"), { userId });
        return false;
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

            if(!response){
                logger.error(new ApiError(500,"Internal server error in generating access token"));
                return false;
            }
            const accessToken = response.data.access_token;

            // Write-through cache: repopulate on every fresh generation (incl. 401-driven
            // refresh callbacks) so the scheduled pipeline reuses this token across phases
            // and a refreshed token always overwrites any stale cached entry. Non-fatal.
            authCache.setToken('sp', refreshToken, accessToken);

            // Try to save the access token to user, but don't fail if save fails.
            // Use a targeted updateOne instead of findById + full-document save() to
            // avoid reading and re-writing the entire User doc on every token generation.
            try {
                const updateResult = await User.updateOne(
                    { _id: userId },
                    { $set: { spiAccessToken: accessToken } }
                );
                if (!updateResult || updateResult.matchedCount === 0) {
                    logger.warn(`User not found when saving access token: ${userId}`);
                }
            } catch (saveError) {
                // Log the error but don't fail the token generation
                // The access token is still valid even if we can't save it
                logger.error(`Error saving access token to user (non-critical): ${saveError.message}`, {
                    userId,
                    errorName: saveError.name,
                    errorCode: saveError.code
                });
            }
            
            return accessToken;
    } catch (error) {
        // Log detailed error information
        if (error.response) {
            const status = error.response.status;
            const errorCode = error.response.data?.error;
            const errorDescription = error.response.data?.error_description;

            logger.error(`Error generating access token - Amazon API error: ${status} - ${errorCode}: ${errorDescription}`, {
                userId,
                status,
                errorCode,
                errorDescription
            });

            // The refresh token itself is dead (revoked / reconnected elsewhere), so any
            // access token cached against it is unusable too. Drop it now rather than letting
            // another phase serve it for the rest of the 50-min TTL. Non-fatal.
            if (errorCode === 'invalid_grant') {
                authCache.invalidateToken('sp', refreshToken).catch(() => {});
            }

            if (errorRef) errorRef.message = errorDescription || errorCode || `Amazon API error ${status}`;
        } else {
            logger.error(`Error generating access token: ${error.message}`, {
                userId,
                errorMessage: error.message,
                errorStack: error.stack
            });
            if (errorRef) errorRef.message = error.message;
        }
        return false;
    }

}

module.exports={generateRefreshToken,generateAccessToken,generateAdsRefreshToken}
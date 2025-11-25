const { generateAccessToken } = require('../Services/Sp_API/GenerateTokens.js');
const { generateAdsAccessToken } = require('../Services/AmazonAds/GenerateToken.js');
const logger = require('./Logger.js');

class TokenManager {
    constructor() {
        this.tokens = new Map(); // Store tokens by userId
        this.refreshPromises = new Map(); // Prevent concurrent refresh attempts
    }

    // Store tokens with metadata
    setTokens(userId, spApiToken, adsToken, spRefreshToken, adsRefreshToken) {
        const now = Date.now();
        this.tokens.set(userId, {
            spApiToken,
            adsToken,
            spRefreshToken,
            adsRefreshToken,
            spApiTokenTime: now,
            adsTokenTime: now,
            lastRefresh: now
        });
    }

    // Get current tokens
    getTokens(userId) {
        return this.tokens.get(userId);
    }

    // Check if tokens are near expiry (55 minutes = 3300 seconds)
    areTokensNearExpiry(userId) {
        const tokenData = this.tokens.get(userId);
        if (!tokenData) return true;

        const now = Date.now();
        const spApiAge = now - tokenData.spApiTokenTime;
        const adsAge = now - tokenData.adsTokenTime;
        
        // Amazon tokens typically expire after 1 hour (3600 seconds)
        // Refresh at 55 minutes (3300 seconds = 3300000 ms)
        const REFRESH_THRESHOLD = 55 * 60 * 1000; // 55 minutes in milliseconds
        
        return spApiAge > REFRESH_THRESHOLD || adsAge > REFRESH_THRESHOLD;
    }

    // Refresh both tokens together
    async refreshBothTokens(userId, spRefreshToken, adsRefreshToken) {
        // Prevent concurrent refresh attempts for the same user
        if (this.refreshPromises.has(userId)) {
            logger.info(`Token refresh already in progress for user ${userId}, waiting...`);
            return await this.refreshPromises.get(userId);
        }

        const refreshPromise = this._performTokenRefresh(userId, spRefreshToken, adsRefreshToken);
        this.refreshPromises.set(userId, refreshPromise);

        try {
            const result = await refreshPromise;
            return result;
        } finally {
            this.refreshPromises.delete(userId);
        }
    }

    async _performTokenRefresh(userId, spRefreshToken, adsRefreshToken) {
        try {
            logger.info(`Refreshing both tokens for user ${userId}`);

            // Track which tokens we're refreshing
            const tokensToRefresh = [];
            const refreshPromises = [];

            // Only refresh SP-API token if we have a refresh token
            if (spRefreshToken) {
                tokensToRefresh.push('SP-API');
                refreshPromises.push(
                    generateAccessToken(userId, spRefreshToken).catch(err => {
                        logger.error(`SP-API token refresh failed: ${err.message}`);
                        // Return null instead of throwing, so we can still refresh Ads token
                        return null;
                    })
                );
            } else {
                refreshPromises.push(Promise.resolve(null));
            }

            // Only refresh Ads token if we have a refresh token
            if (adsRefreshToken) {
                tokensToRefresh.push('Ads');
                refreshPromises.push(
                    generateAdsAccessToken(adsRefreshToken).catch(err => {
                        logger.error(`Ads token refresh failed: ${err.message}`);
                        // Check if it's a permanent failure (invalid refresh token)
                        if (err.message && (
                            err.message.includes('invalid_grant') ||
                            err.message.includes('invalid or expired') ||
                            err.message.includes('Invalid token')
                        )) {
                            // This refresh token is permanently invalid
                            logger.error(`⚠️ Ads refresh token is permanently invalid for user ${userId}. User needs to reconnect their Amazon Ads account.`);
                        }
                        throw err; // Still throw for Ads errors since that's what we're trying to refresh
                    })
                );
            } else {
                refreshPromises.push(Promise.resolve(null));
            }

            console.log(`🔄 Refreshing tokens for user ${userId}: ${tokensToRefresh.join(', ')}`);
            const [newSpApiToken, newAdsToken] = await Promise.all(refreshPromises);

            // Check if we got the tokens we needed
            if (spRefreshToken && !newSpApiToken) {
                logger.warn(`⚠️ SP-API token refresh failed for user ${userId}`);
            }
            if (adsRefreshToken && !newAdsToken) {
                throw new Error('Failed to refresh Ads token - refresh token may be invalid or expired');
            }

            // Update stored tokens (only if they were successfully refreshed)
            this.setTokens(
                userId, 
                newSpApiToken || this.getTokens(userId)?.spApiToken, 
                newAdsToken || this.getTokens(userId)?.adsToken, 
                spRefreshToken, 
                adsRefreshToken
            );

            logger.info(`Successfully refreshed tokens for user ${userId}: SP-API=${!!newSpApiToken}, Ads=${!!newAdsToken}`);
            return {
                spApiToken: newSpApiToken || this.getTokens(userId)?.spApiToken,
                adsToken: newAdsToken || this.getTokens(userId)?.adsToken
            };

        } catch (error) {
            logger.error(`Failed to refresh tokens for user ${userId}: ${error.message}`);
            
            // Add more context to the error
            if (error.message && (
                error.message.includes('invalid_grant') ||
                error.message.includes('invalid or expired') ||
                error.message.includes('Invalid token')
            )) {
                error.isRefreshTokenInvalid = true;
            }
            
            throw error;
        }
    }

    // Check if error indicates token expiry/unauthorized
    isUnauthorizedError(error) {
        if (!error) return false;
        
        const errorMessage = error.message || '';
        const errorString = errorMessage.toLowerCase();
        
        // ===== ENHANCED AMAZON API ERROR DETECTION =====
        
        // Check response status codes first
        if ((error.response && error.response.status === 401) ||
            (error.statusCode === 401) ||
            (error.status === 401)) {
            console.log("🔍 TokenManager: Detected 401 status code");
            return true;
        }
        
        // Check Amazon's specific error structure: error.response.data.errors[]
        if (error.response && error.response.data) {
            const responseData = error.response.data;
            
            // Amazon SP-API error format: { errors: [{ code: 'Unauthorized', message: '...' }] }
            if (Array.isArray(responseData.errors)) {
                const hasUnauthorizedError = responseData.errors.some(err => {
                    if (!err) return false;
                    
                    const code = (err.code || '').toLowerCase();
                    const message = (err.message || '').toLowerCase();
                    
                    const isUnauthorized = (
                        code === 'unauthorized' ||
                        code === 'invalid_token' ||
                        code === 'token_expired' ||
                        message.includes('unauthorized') ||
                        message.includes('access denied') ||
                        message.includes('access to requested resource is denied') ||
                        message.includes('invalid access token') ||
                        message.includes('authentication failed') ||
                        message.includes('token expired')
                    );
                    
                    if (isUnauthorized) {
                        console.log("🔍 TokenManager: Detected unauthorized in Amazon errors array", { code, message: err.message });
                    }
                    
                    return isUnauthorized;
                });
                
                if (hasUnauthorizedError) return true;
            }
            
            // Direct error properties (some APIs return errors directly)
            const directCode = (responseData.code || '').toLowerCase();
            const directMessage = (responseData.message || '').toLowerCase();
            
            if (directCode === 'unauthorized' ||
                directMessage.includes('unauthorized') ||
                directMessage.includes('access denied') ||
                directMessage.includes('access to requested resource is denied') ||
                directMessage.includes('invalid token') ||
                directMessage.includes('invalid_token') ||
                directMessage.includes('authenticating lwa token')) {
                console.log("🔍 TokenManager: Detected unauthorized in direct response", { code: directCode, message: responseData.message });
                return true;
            }
        }
        
        // Check standard error message patterns
        const messageChecks = (
            errorString.includes('unauthorized') ||
            errorString.includes('401') ||
            errorString.includes('invalid_token') ||
            errorString.includes('invalid token') ||
            errorString.includes('token expired') ||
            errorString.includes('access denied') ||
            errorString.includes('access to requested resource is denied') ||
            errorString.includes('invalid access token') ||
            errorString.includes('authentication failed') ||
            errorString.includes('authenticating lwa token') ||
            errorString.includes('lwa token')
        );
        
        if (messageChecks) {
            console.log("🔍 TokenManager: Detected unauthorized in error message", { message: errorMessage });
            return true;
        }
        
        // Check if error was thrown with Amazon API error structure preserved
        if (error.amazonApiError) {
            console.log("🔍 TokenManager: Detected amazonApiError flag");
            return true;
        }
        
        return false;
    }

    // Get valid tokens with proactive refresh
    async getValidTokens(userId, spRefreshToken, adsRefreshToken) {
        let tokenData = this.getTokens(userId);
        
        // If no tokens stored or tokens are near expiry, refresh them
        if (!tokenData || this.areTokensNearExpiry(userId)) {
            logger.info(`Proactively refreshing tokens for user ${userId} (${!tokenData ? 'no tokens stored' : 'tokens near expiry'})`);
            const refreshedTokens = await this.refreshBothTokens(userId, spRefreshToken, adsRefreshToken);
            tokenData = this.getTokens(userId);
        }

        return {
            spApiToken: tokenData.spApiToken,
            adsToken: tokenData.adsToken
        };
    }

    // Execute function without retry logic
    async executeWithTokenRefresh(fn, params, userId, spRefreshToken, adsRefreshToken) {
        console.log(`🔄 TokenManager: Executing function for user ${userId} (no retries)`);
        
        try {
            console.log(`🔄 TokenManager: Getting valid tokens for user ${userId}`);
            
            // Get valid tokens (with proactive refresh if needed)
            const validTokens = await this.getValidTokens(userId, spRefreshToken, adsRefreshToken);
            
            console.log(`✅ TokenManager: Got valid tokens for user ${userId}`);
            
            // Update params with fresh tokens if they contain token fields
            const updatedParams = this.updateParamsWithTokens(params, validTokens);
            
            // Execute the function
            const result = await fn(updatedParams);
            console.log(`✅ TokenManager: Function executed successfully for user ${userId}`);
            return result;
            
        } catch (error) {
            console.log(`❌ TokenManager: Function failed for user ${userId}:`, error.message);
            
            // Check if this is an unauthorized error
            const isUnauthorized = this.isUnauthorizedError(error);
            console.log(`🔍 TokenManager: Is unauthorized error: ${isUnauthorized}`);
            
            // If it's an unauthorized error, try to refresh tokens once
            if (isUnauthorized) {
                console.log(`⚠️ TokenManager: Unauthorized error detected, refreshing tokens...`);
                
                try {
                    console.log(`🔄 TokenManager: Starting token refresh for user ${userId}...`);
                    await this.refreshBothTokens(userId, spRefreshToken, adsRefreshToken);
                    console.log(`✅ TokenManager: Token refresh completed for user ${userId}`);
                    
                    // Get updated tokens and try once more
                    const updatedTokens = await this.getValidTokens(userId, spRefreshToken, adsRefreshToken);
                    const updatedParams = this.updateParamsWithTokens(params, updatedTokens);
                    
                    console.log(`🔄 TokenManager: Retrying function execution with refreshed tokens for user ${userId}...`);
                    const result = await fn(updatedParams);
                    console.log(`✅ TokenManager: Function executed successfully after token refresh for user ${userId}`);
                    return result;
                    
                } catch (refreshError) {
                    console.error(`❌ TokenManager: Token refresh failed for user ${userId}:`, refreshError.message);
                    logger.error(`Token refresh failed: ${refreshError.message}`);
                    throw refreshError;
                }
            } else {
                // Not an unauthorized error, throw the original error
                console.log(`❌ TokenManager: Non-unauthorized error, not retrying (user ${userId})`);
                throw error;
            }
        }
    }

    // Update function parameters with fresh tokens
    updateParamsWithTokens(params, validTokens) {
        if (!params || typeof params !== 'object') {
            return params;
        }

        // Handle array parameters (first element might be token)
        if (Array.isArray(params)) {
            return params;
        }

        // Handle object parameters
        const updatedParams = { ...params };
        
        // Update common token field names
        if ('AccessToken' in updatedParams) {
            updatedParams.AccessToken = validTokens.spApiToken;
        }
        if ('AdsAccessToken' in updatedParams) {
            updatedParams.AdsAccessToken = validTokens.adsToken;
        }
        if ('adsToken' in updatedParams) {
            updatedParams.adsToken = validTokens.adsToken;
        }
        if ('spApiToken' in updatedParams) {
            updatedParams.spApiToken = validTokens.spApiToken;
        }
        if ('dataToSend' in updatedParams && updatedParams.dataToSend) {
            updatedParams.dataToSend = {
                ...updatedParams.dataToSend,
                AccessToken: validTokens.spApiToken
            };
        }

        // Add validTokens to the params so wrapDataToSendFunction can access them
        updatedParams.validTokens = validTokens;

        return updatedParams;
    }

    // Create wrapper for SP-API functions
    wrapSpApiFunction(fn, userId, spRefreshToken, adsRefreshToken) {
        return async (...args) => {
            return await this.executeWithTokenRefresh(
                async (tokens) => {
                    // Replace first argument (token) with fresh token for SP-API functions
                    const updatedArgs = [tokens.spApiToken, ...args.slice(1)];
                    return await fn(...updatedArgs);
                },
                { spApiToken: args[0] }, // Current token
                userId,
                spRefreshToken,
                adsRefreshToken
            );
        };
    }

    // Create wrapper for Ads functions  
    wrapAdsFunction(fn, userId, spRefreshToken, adsRefreshToken) {
        return async (...args) => {
            console.log(`🔄 TokenManager: Wrapping Ads function for user ${userId}`);
            return await this.executeWithTokenRefresh(
                async (tokens) => {
                    // Replace first argument (token) with fresh token for Ads functions
                    console.log(`🔄 TokenManager: Using refreshed Ads token for function execution`);
                    const updatedArgs = [tokens.adsToken, ...args.slice(1)];
                    return await fn(...updatedArgs);
                },
                { adsToken: args[0] }, // Current token
                userId,
                spRefreshToken,
                adsRefreshToken
            );
        };
    }

    // Create wrapper for functions that use dataToSend object
    wrapDataToSendFunction(fn, userId, spRefreshToken, adsRefreshToken) {
        return async (...args) => {
            return await this.executeWithTokenRefresh(
                async (updatedParams) => {
                    // Create a copy of arguments to update
                    const updatedArgs = [...args];
                    
                    // Find and update any dataToSend objects in the arguments
                    for (let i = 0; i < updatedArgs.length; i++) {
                        const arg = updatedArgs[i];
                        
                        // Check if this argument is a dataToSend object (has AccessToken property)
                        if (arg && typeof arg === 'object' && 'AccessToken' in arg) {
                            updatedArgs[i] = {
                                ...arg,
                                AccessToken: updatedParams.validTokens.spApiToken
                            };
                            break; // Usually only one dataToSend object per function call
                        }
                    }
                    
                    return await fn(...updatedArgs);
                },
                { 
                    // Pass the original arguments to help identify dataToSend objects
                    originalArgs: args,
                    // Also pass any dataToSend-like object we can find
                    dataToSend: args.find(arg => arg && typeof arg === 'object' && 'AccessToken' in arg)
                },
                userId,
                spRefreshToken,
                adsRefreshToken
            );
        };
    }
}

// Create singleton instance
const tokenManager = new TokenManager();

module.exports = tokenManager; 
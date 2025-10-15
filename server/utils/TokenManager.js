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

            // Refresh both tokens in parallel
            const [newSpApiToken, newAdsToken] = await Promise.all([
                generateAccessToken(userId, spRefreshToken).catch(err => {
                    logger.error(`SP-API token refresh failed: ${err.message}`);
                    throw err;
                }),
                generateAdsAccessToken(adsRefreshToken).catch(err => {
                    logger.error(`Ads token refresh failed: ${err.message}`);
                    throw err;
                })
            ]);

            if (!newSpApiToken || !newAdsToken) {
                throw new Error('Failed to refresh one or both tokens');
            }

            // Update stored tokens
            this.setTokens(userId, newSpApiToken, newAdsToken, spRefreshToken, adsRefreshToken);

            logger.info(`Successfully refreshed both tokens for user ${userId}`);
            return {
                spApiToken: newSpApiToken,
                adsToken: newAdsToken
            };

        } catch (error) {
            logger.error(`Failed to refresh tokens for user ${userId}: ${error.message}`);
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
                directMessage.includes('access to requested resource is denied')) {
                console.log("🔍 TokenManager: Detected unauthorized in direct response", { code: directCode, message: responseData.message });
                return true;
            }
        }
        
        // Check standard error message patterns
        const messageChecks = (
            errorString.includes('unauthorized') ||
            errorString.includes('401') ||
            errorString.includes('invalid_token') ||
            errorString.includes('token expired') ||
            errorString.includes('access denied') ||
            errorString.includes('access to requested resource is denied') ||
            errorString.includes('invalid access token') ||
            errorString.includes('authentication failed')
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
            return await this.executeWithTokenRefresh(
                async (tokens) => {
                    // Replace first argument (token) with fresh token for Ads functions
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
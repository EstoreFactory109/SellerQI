const { getRedisClient } = require('../config/redisConn');
const logger = require('../utils/Logger.js');

/**
 * Page-specific cache middleware
 * Creates separate cache entries for each page type (dashboard, profitability, ppc, etc.)
 * This allows serving cached data for pages that haven't changed while recalculating others
 * 
 * @param {number} cacheDurationInSeconds - Cache TTL in seconds (default: 1 hour)
 * @param {string} pageType - Optional page type for page-specific caching
 */
const analyseDataCache = (cacheDurationInSeconds = 3600, pageType = 'dashboard') => {
    return async (req, res, next) => {
        try {
            const userId = req.userId;
            const country = req.country;
            const region = req.region;
            const adminId = req.adminId;

            if (!userId || !country || !region) {
                logger.warn('Missing required parameters for cache check');
                return next();
            }

            // Create a unique cache key based on userId, country, region, adminId, and page type
            // This allows caching different pages separately
            const cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}`;
            
            const redisClient = getRedisClient();
            
            // Try to get cached data
            const cachedData = await redisClient.get(cacheKey);
            
            if (cachedData) {
                logger.info(`Cache hit for key: ${cacheKey}`);
                const parsedData = JSON.parse(cachedData);
                
                // Return cached data in the same format as the original response
                return res.status(200).json({
                    statusCode: 200,
                    data: parsedData,
                    message: "Data is fetched successfully (from cache)",
                    success: true
                });
            }

            logger.info(`Cache miss for key: ${cacheKey}`);
            
            // Store the original res.json method
            const originalJson = res.json;
            
            // Override res.json to intercept the response
            res.json = function(responseData) {
                // Check if this is a successful response from the analyse controller
                if (responseData && responseData.statusCode === 200 && responseData.data) {
                    // Cache the response data
                    redisClient.setEx(cacheKey, cacheDurationInSeconds, JSON.stringify(responseData.data))
                        .then(() => {
                            logger.info(`Data cached successfully for key: ${cacheKey}`);
                        })
                        .catch((error) => {
                            logger.error(`Failed to cache data for key: ${cacheKey}`, error);
                        });
                }
                
                // Call the original res.json with the response data
                return originalJson.call(this, responseData);
            };
            
            // Continue to the next middleware/controller
            next();
            
        } catch (error) {
            logger.error('Redis cache middleware error:', error);
            // Continue without caching if Redis fails
            next();
        }
    };
};

/**
 * Clear all page-specific caches for a user
 * Called after integration completes to ensure fresh data is calculated
 */
const clearAnalyseCache = async (userId, country, region, adminId = null) => {
    try {
        const redisClient = getRedisClient();
        
        // List of all page types that are cached
        const pageTypes = ['dashboard', 'profitability', 'ppc', 'issues', 'issues-by-product', 'keyword-analysis', 'reimbursement', 'inventory'];
        
        // Clear cache for all page types
        const clearPromises = pageTypes.map(pageType => {
            const cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}`;
            return redisClient.del(cacheKey).then(() => {
                logger.info(`Cache cleared for key: ${cacheKey}`);
            });
        });
        
        // Also clear the legacy cache key format for backward compatibility
        const legacyCacheKey = `analyse_data:${userId}:${country}:${region}:${adminId || 'null'}`;
        clearPromises.push(redisClient.del(legacyCacheKey));
        
        await Promise.all(clearPromises);
        logger.info(`All caches cleared for user: ${userId}, country: ${country}, region: ${region}`);
    } catch (error) {
        logger.error('Failed to clear cache:', error);
    }
};

/**
 * Clear cache for a specific page type only
 */
const clearPageCache = async (userId, country, region, pageType, adminId = null) => {
    try {
        const cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}`;
        const redisClient = getRedisClient();
        
        await redisClient.del(cacheKey);
        logger.info(`Cache cleared for key: ${cacheKey}`);
    } catch (error) {
        logger.error('Failed to clear page cache:', error);
    }
};

module.exports = { analyseDataCache, clearAnalyseCache, clearPageCache }; 
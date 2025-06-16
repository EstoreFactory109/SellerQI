const { getRedisClient } = require('../config/redisConn');
const logger = require('../utils/Logger.js');

const analyseDataCache = (cacheDurationInSeconds = 3600) => {
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

            // Create a unique cache key based on userId, country, region, and adminId
            const cacheKey = `analyse_data:${userId}:${country}:${region}:${adminId || 'null'}`;
            
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

const clearAnalyseCache = async (userId, country, region, adminId = null) => {
    try {
        const cacheKey = `analyse_data:${userId}:${country}:${region}:${adminId || 'null'}`;
        const redisClient = getRedisClient();
        
        await redisClient.del(cacheKey);
        logger.info(`Cache cleared for key: ${cacheKey}`);
    } catch (error) {
        logger.error('Failed to clear cache:', error);
    }
};

module.exports = { analyseDataCache, clearAnalyseCache }; 
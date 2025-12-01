const { clearAnalyseCache } = require('../../middlewares/redisCache');
const { getRedisClient } = require('../../config/redisConn');
const asyncHandler = require('../../utils/AsyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const { ApiError } = require('../../utils/ApiError');
const logger = require('../../utils/Logger.js');

const clearAnalyseCacheEndpoint = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const adminId = req.adminId;

    if (!userId || !country || !region) {
        throw new ApiError(400, "Missing required parameters: userId, country, region");
    }

    await clearAnalyseCache(userId, country, region, adminId);
    
    res.status(200).json(
        new ApiResponse(200, null, "Cache cleared successfully")
    );
});

const clearAllAnalyseCache = asyncHandler(async (req, res) => {
    try {
        const redisClient = getRedisClient();
        
        // Get all keys matching the analyse_data pattern
        const keys = await redisClient.keys('analyse_data:*');
        
        if (keys.length > 0) {
            await redisClient.del(keys);
            logger.info(`Cleared ${keys.length} cache entries`);
        }
        
        res.status(200).json(
            new ApiResponse(200, { keysCleared: keys.length }, "All analyse cache cleared successfully")
        );
    } catch (error) {
        logger.error('Error clearing all cache:', error);
        throw new ApiError(500, "Failed to clear cache");
    }
});

const getCacheStats = asyncHandler(async (req, res) => {
    try {
        const redisClient = getRedisClient();
        
        // Get all keys matching the analyse_data pattern
        const keys = await redisClient.keys('analyse_data:*');
        
        const stats = {
            totalCacheEntries: keys.length,
            cacheKeys: keys
        };
        
        res.status(200).json(
            new ApiResponse(200, stats, "Cache stats retrieved successfully")
        );
    } catch (error) {
        logger.error('Error getting cache stats:', error);
        throw new ApiError(500, "Failed to get cache stats");
    }
});

module.exports = {
    clearAnalyseCacheEndpoint,
    clearAllAnalyseCache,
    getCacheStats
}; 
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
            // For paginated endpoints (like your-products), include page and limit in cache key
            let cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}`;
            
            // For your-products endpoint, include status filter and pagination params
            // IMPORTANT: Only cache page 1 - Load More requests (page > 1) bypass cache for data consistency
            if (pageType === 'your-products') {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 20;
                const status = req.query.status || 'all'; // Include status filter in cache key (differentiates tabs)
                
                // Only cache page 1 - bypass cache for Load More (page > 1)
                if (page === 1) {
                    cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}:status${status}:page${page}:limit${limit}`;
                } else {
                    // Skip caching for page > 1 (Load More requests) - always fetch fresh data
                    logger.info(`Skipping cache for your-products page ${page}, status: ${status} (Load More request)`);
                    return next();
                }
            }
            
            // For issues-by-product endpoint, include comparison param in cache key
            // This ensures WoW and MoM comparisons get separate cache entries
            if (pageType === 'issues-by-product') {
                const comparison = req.query.comparison || 'none';
                cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}:comparison${comparison}`;
            }
            
            const redisClient = getRedisClient();
            
            // Allow client to bypass cache for issues-by-product (e.g. after server deploy with recommendation text changes)
            const skipCacheRead = pageType === 'issues-by-product' && req.query.forceRefresh === 'true';
            if (skipCacheRead) {
                logger.info(`Bypassing cache for ${pageType} (forceRefresh=true)`);
            }
            
            // Try to get cached data (unless bypass requested)
            const cachedData = skipCacheRead ? null : await redisClient.get(cacheKey);
            
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
        const pageTypes = ['navbar', 'dashboard', 'profitability', 'ppc', 'issues', 'issues-by-product', 'keyword-analysis', 'reimbursement', 'inventory', 'your-products'];
        
        // Clear cache for all page types
        const clearPromises = pageTypes.map(pageType => {
            const cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}`;
            return redisClient.del(cacheKey).then(() => {
                logger.info(`Cache cleared for key: ${cacheKey}`);
            });
        });
        
        // Clear your-products paginated cache using pattern matching
        const yourProductsPattern = `analyse_data:your-products:${userId}:${country}:${region}:${adminId || 'null'}:*`;
        try {
            const keys = await redisClient.keys(yourProductsPattern);
            if (keys && keys.length > 0) {
                const deletePromises = keys.map(key => redisClient.del(key));
                await Promise.all(deletePromises);
                logger.info(`Cleared ${keys.length} your-products cache entries for user: ${userId}`);
            }
        } catch (patternError) {
            logger.warn('Could not clear your-products pattern cache:', patternError.message);
        }

        // Clear issues-by-product cache (keys include :comparisonnone, :comparisonwow, :comparisonmom)
        const issuesByProductPattern = `analyse_data:issues-by-product:${userId}:${country}:${region}:${adminId || 'null'}:*`;
        try {
            const issuesKeys = await redisClient.keys(issuesByProductPattern);
            if (issuesKeys && issuesKeys.length > 0) {
                await Promise.all(issuesKeys.map(key => redisClient.del(key)));
                logger.info(`Cleared ${issuesKeys.length} issues-by-product cache entries for user: ${userId}`);
            }
        } catch (patternError) {
            logger.warn('Could not clear issues-by-product pattern cache:', patternError.message);
        }
        
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
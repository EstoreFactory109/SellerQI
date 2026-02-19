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
            
            // For your-products-v2/products endpoint, include status + page + limit in cache key
            if (pageType === 'your-products-v2-products') {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 20;
                const status = req.query.status || 'Active';
                
                // Only cache page 1 - Load More (page > 1) bypasses cache
                if (page === 1) {
                    cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}:status${status}:page${page}:limit${limit}`;
                } else {
                    logger.info(`[v2] Skipping cache for your-products-v2/products page ${page}, status: ${status}`);
                    return next();
                }
            }
            
            // For your-products-v3 paginated endpoints (active, inactive, incomplete, without-aplus, not-targeted-in-ads, optimization)
            // Cache only page 1 - Load More (page > 1) bypasses cache
            const v3PaginatedTypes = ['your-products-v3-active', 'your-products-v3-inactive', 'your-products-v3-incomplete', 'your-products-v3-without-aplus', 'your-products-v3-not-targeted-in-ads', 'your-products-v3-optimization'];
            if (v3PaginatedTypes.includes(pageType)) {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 20;
                
                // Only cache page 1 - Load More (page > 1) bypasses cache
                if (page === 1) {
                    cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}:page${page}:limit${limit}`;
                } else {
                    logger.info(`[v3] Skipping cache for ${pageType} page ${page}`);
                    return next();
                }
            }
            
            // For PPC Campaign Analysis paginated endpoints
            // Cache only page 1 - page > 1 bypasses cache for fresh data
            const ppcPaginatedTypes = ['ppc-high-acos', 'ppc-wasted-spend', 'ppc-no-negatives', 'ppc-top-keywords', 'ppc-zero-sales', 'ppc-auto-insights'];
            if (ppcPaginatedTypes.includes(pageType)) {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                
                // Only cache page 1 - page > 1 bypasses cache
                if (page === 1) {
                    cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}:page${page}:limit${limit}`;
                } else {
                    logger.info(`[PPC] Skipping cache for ${pageType} page ${page}`);
                    return next();
                }
            }
            
            // For Issues paginated endpoints (Category page)
            // Cache only page 1 - page > 1 bypasses cache for Load More functionality
            const issuesPaginatedTypes = ['issues-ranking', 'issues-conversion', 'issues-inventory', 'issues-products'];
            if (issuesPaginatedTypes.includes(pageType)) {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                
                // Only cache page 1 - page > 1 bypasses cache
                if (page === 1) {
                    cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}:page${page}:limit${limit}`;
                } else {
                    logger.info(`[Issues] Skipping cache for ${pageType} page ${page}`);
                    return next();
                }
            }
            
            // For profitability-table paginated endpoint
            // Cache only page 1 - page > 1 bypasses cache for proper pagination
            if (pageType === 'profitability-table') {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                
                // Only cache page 1 - page > 1 bypasses cache
                if (page === 1) {
                    cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}:page${page}:limit${limit}`;
                } else {
                    logger.info(`[Profitability] Skipping cache for ${pageType} page ${page}`);
                    return next();
                }
            }
            
            // For profitability-issues paginated endpoint
            // Cache only page 1 - page > 1 bypasses cache for proper pagination
            if (pageType === 'profitability-issues') {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                
                // Only cache page 1 - page > 1 bypasses cache
                if (page === 1) {
                    cacheKey = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}:page${page}:limit${limit}`;
                } else {
                    logger.info(`[Profitability] Skipping cache for ${pageType} page ${page}`);
                    return next();
                }
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
        const pageTypes = ['navbar', 'dashboard', 'profitability', 'profitability-metrics', 'profitability-chart', 'profitability-issues-summary', 'ppc', 'issues', 'issues-by-product', 'keyword-analysis', 'reimbursement', 'inventory', 'your-products', 'your-products-v2-initial', 'your-products-v2-products', 'your-products-v3-summary', 'your-products-v3-active', 'your-products-v3-inactive', 'your-products-v3-incomplete', 'your-products-v3-without-aplus', 'your-products-v3-not-targeted-in-ads'];
        
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
        
        // Clear your-products-v2 cache entries
        const v2ProductsPattern = `analyse_data:your-products-v2-products:${userId}:${country}:${region}:${adminId || 'null'}:*`;
        try {
            const v2Keys = await redisClient.keys(v2ProductsPattern);
            if (v2Keys && v2Keys.length > 0) {
                await Promise.all(v2Keys.map(key => redisClient.del(key)));
                logger.info(`Cleared ${v2Keys.length} your-products-v2 cache entries for user: ${userId}`);
            }
        } catch (patternError) {
            logger.warn('Could not clear your-products-v2 pattern cache:', patternError.message);
        }
        
        // Clear your-products-v3 paginated cache entries
        const v3PaginatedTypes = ['your-products-v3-active', 'your-products-v3-inactive', 'your-products-v3-incomplete', 'your-products-v3-without-aplus', 'your-products-v3-not-targeted-in-ads'];
        for (const pageType of v3PaginatedTypes) {
            const v3Pattern = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}:*`;
            try {
                const v3Keys = await redisClient.keys(v3Pattern);
                if (v3Keys && v3Keys.length > 0) {
                    await Promise.all(v3Keys.map(key => redisClient.del(key)));
                    logger.info(`Cleared ${v3Keys.length} ${pageType} cache entries for user: ${userId}`);
                }
            } catch (patternError) {
                logger.warn(`Could not clear ${pageType} pattern cache:`, patternError.message);
            }
        }
        
        // Clear PPC Campaign Analysis paginated cache entries
        const ppcPaginatedTypes = ['ppc-high-acos', 'ppc-wasted-spend', 'ppc-no-negatives', 'ppc-top-keywords', 'ppc-zero-sales', 'ppc-auto-insights', 'ppc-summary', 'ppc-tab-counts'];
        for (const pageType of ppcPaginatedTypes) {
            const ppcPattern = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}:*`;
            try {
                const ppcKeys = await redisClient.keys(ppcPattern);
                if (ppcKeys && ppcKeys.length > 0) {
                    await Promise.all(ppcKeys.map(key => redisClient.del(key)));
                    logger.info(`Cleared ${ppcKeys.length} ${pageType} cache entries for user: ${userId}`);
                }
            } catch (patternError) {
                logger.warn(`Could not clear ${pageType} pattern cache:`, patternError.message);
            }
        }
        
        // Clear Issues paginated cache entries (Category page)
        const issuesPaginatedTypes = ['issues-ranking', 'issues-conversion', 'issues-inventory', 'issues-products', 'issues-summary', 'issues-account'];
        for (const pageType of issuesPaginatedTypes) {
            const issuesPattern = `analyse_data:${pageType}:${userId}:${country}:${region}:${adminId || 'null'}:*`;
            try {
                const issuesKeys = await redisClient.keys(issuesPattern);
                if (issuesKeys && issuesKeys.length > 0) {
                    await Promise.all(issuesKeys.map(key => redisClient.del(key)));
                    logger.info(`Cleared ${issuesKeys.length} ${pageType} cache entries for user: ${userId}`);
                }
            } catch (patternError) {
                logger.warn(`Could not clear ${pageType} pattern cache:`, patternError.message);
            }
        }
        
        // Clear profitability-table paginated cache entries
        const profitabilityTablePattern = `analyse_data:profitability-table:${userId}:${country}:${region}:${adminId || 'null'}:*`;
        try {
            const profitKeys = await redisClient.keys(profitabilityTablePattern);
            if (profitKeys && profitKeys.length > 0) {
                await Promise.all(profitKeys.map(key => redisClient.del(key)));
                logger.info(`Cleared ${profitKeys.length} profitability-table cache entries for user: ${userId}`);
            }
        } catch (patternError) {
            logger.warn('Could not clear profitability-table pattern cache:', patternError.message);
        }
        
        // Clear profitability-issues paginated cache entries
        const profitabilityIssuesPattern = `analyse_data:profitability-issues:${userId}:${country}:${region}:${adminId || 'null'}:*`;
        try {
            const issuesKeys = await redisClient.keys(profitabilityIssuesPattern);
            if (issuesKeys && issuesKeys.length > 0) {
                await Promise.all(issuesKeys.map(key => redisClient.del(key)));
                logger.info(`Cleared ${issuesKeys.length} profitability-issues cache entries for user: ${userId}`);
            }
        } catch (patternError) {
            logger.warn('Could not clear profitability-issues pattern cache:', patternError.message);
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
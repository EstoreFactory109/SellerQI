/**
 * ProductWiseSponsoredAdsService.js
 * 
 * Service for managing Product-wise Sponsored Ads data in the database.
 * 
 * This service handles both old format (embedded sponsoredAds[] in a single document)
 * and new format (separate collection with one document per ad entry).
 * 
 * The migration is transparent - callers always receive data in the same format.
 */

const mongoose = require('mongoose');
const ProductWiseSponsoredAdsData = require('../../models/amazon-ads/ProductWiseSponseredAdsModel');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel');
const logger = require('../../utils/Logger');
const { getRedisClient } = require('../../config/redisConn');

/**
 * Save Product-wise Sponsored Ads data to database
 * Always uses new format (separate collection) to prevent 16MB limit
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Array} sponsoredAdsArray - Array of sponsored ads items
 * @returns {Promise<Object>} Result with saved document info
 */
async function saveProductWiseSponsoredAdsData(userId, country, region, sponsoredAdsArray) {
    try {
        if (!userId) {
            throw new Error('User ID is required');
        }
        if (!country || !region) {
            throw new Error('Country and region are required');
        }

        // Convert userId to ObjectId if it's a string
        let userObjectId;
        try {
            userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
        } catch (err) {
            throw new Error(`Invalid User ID format: ${userId}`);
        }

        const itemCount = sponsoredAdsArray?.length || 0;

        logger.info('Saving Product-wise Sponsored Ads data using separate collection', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount
        });

        // Generate a batch ID to group all items from this save operation
        const batchId = new mongoose.Types.ObjectId();

        // If no data, just return success with 0 count
        if (itemCount === 0) {
            logger.info('No Sponsored Ads data to save');
            return {
                success: true,
                message: 'No data to save',
                itemCount: 0,
                batchId: batchId.toString()
            };
        }

        // Save items to separate collection
        const itemsToInsert = sponsoredAdsArray.map(item => ({
            userId: userObjectId,
            country,
            region,
            batchId,
            date: item.date || '',
            asin: item.asin || '',
            spend: item.spend || 0,
            salesIn7Days: item.salesIn7Days || 0,
            salesIn14Days: item.salesIn14Days || 0,
            salesIn30Days: item.salesIn30Days || 0,
            campaignId: item.campaignId || '',
            campaignName: item.campaignName || '',
            impressions: item.impressions || 0,
            adGroupId: item.adGroupId || '',
            clicks: item.clicks || 0,
            purchasedIn7Days: item.purchasedIn7Days || 0,
            purchasedIn14Days: item.purchasedIn14Days || 0,
            purchasedIn30Days: item.purchasedIn30Days || 0
        }));

        // Use insertMany with ordered:false for better performance
        await ProductWiseSponsoredAdsItem.insertMany(itemsToInsert, { ordered: false });

        logger.info('Product-wise Sponsored Ads data saved successfully', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount,
            batchId: batchId.toString()
        });

        // Clean up old batches (keep only last 3)
        try {
            const deleteResult = await ProductWiseSponsoredAdsItem.deleteOldBatches(userObjectId, country, region, 3);
            if (deleteResult.deletedCount > 0) {
                logger.info('Cleaned up old Sponsored Ads batches', {
                    userId: userObjectId.toString(),
                    deletedCount: deleteResult.deletedCount
                });
            }
        } catch (cleanupError) {
            // Don't fail the save operation if cleanup fails
            logger.warn('Failed to cleanup old Sponsored Ads batches', {
                userId: userObjectId.toString(),
                error: cleanupError.message
            });
        }

        // Invalidate the ads spend cache since we have new data
        try {
            const cacheKey = `ads_spend_by_asin:${userObjectId.toString()}:${country}:${region}`;
            const redis = getRedisClient();
            await redis.del(cacheKey);
            logger.debug('Invalidated ads spend cache after save', {
                userId: userObjectId.toString(),
                country,
                region
            });
        } catch (cacheError) {
            // Don't fail the save operation if cache invalidation fails
            logger.warn('Failed to invalidate ads spend cache', {
                userId: userObjectId.toString(),
                error: cacheError.message
            });
        }

        return {
            success: true,
            message: 'Data saved successfully',
            itemCount,
            batchId: batchId.toString(),
            userId: userObjectId.toString(),
            country,
            region
        };

    } catch (error) {
        logger.error('Error saving Product-wise Sponsored Ads data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get Product-wise Sponsored Ads data by user/country/region
 * Handles both old format (embedded array) and new format (separate collection)
 * Returns data in a consistent format regardless of storage method
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object|null>} Sponsored Ads data object with sponsoredAds array, or null if not found
 */
async function getProductWiseSponsoredAdsData(userId, country, region) {
    try {
        if (!userId) {
            throw new Error('User ID is required');
        }

        // Convert userId to ObjectId if it's a string
        let userObjectId;
        try {
            userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
        } catch (err) {
            throw new Error(`Invalid User ID format: ${userId}`);
        }

        // First, try to get data from the new format (separate collection)
        const { items: newFormatItems, createdAt, batchId } = await ProductWiseSponsoredAdsItem.findLatestByUserCountryRegion(
            userObjectId,
            country,
            region
        );

        if (newFormatItems && newFormatItems.length > 0) {
            logger.debug('Found Sponsored Ads data in new format (separate collection)', {
                userId: userObjectId.toString(),
                country,
                region,
                itemCount: newFormatItems.length
            });

            // Transform to match the old format structure
            const sponsoredAds = newFormatItems.map(item => ({
                date: item.date,
                asin: item.asin,
                spend: item.spend,
                salesIn7Days: item.salesIn7Days,
                salesIn14Days: item.salesIn14Days,
                salesIn30Days: item.salesIn30Days,
                campaignId: item.campaignId,
                campaignName: item.campaignName,
                impressions: item.impressions,
                adGroupId: item.adGroupId,
                clicks: item.clicks,
                purchasedIn7Days: item.purchasedIn7Days,
                purchasedIn14Days: item.purchasedIn14Days,
                purchasedIn30Days: item.purchasedIn30Days
            }));

            // Return in the same format as old format
            return {
                _id: batchId,
                userId: userObjectId,
                country,
                region,
                sponsoredAds,
                createdAt,
                updatedAt: createdAt
            };
        }

        // Fallback: Try to get data from old format (embedded array in single document)
        const oldFormatDoc = await ProductWiseSponsoredAdsData.findOne({
            userId: userObjectId,
            country,
            region
        }).sort({ createdAt: -1 }).lean();

        if (oldFormatDoc && oldFormatDoc.sponsoredAds && oldFormatDoc.sponsoredAds.length > 0) {
            logger.debug('Found Sponsored Ads data in old format (embedded array)', {
                userId: userObjectId.toString(),
                country,
                region,
                itemCount: oldFormatDoc.sponsoredAds.length
            });

            return oldFormatDoc;
        }

        logger.debug('No Sponsored Ads data found', {
            userId: userObjectId.toString(),
            country,
            region
        });

        return null;

    } catch (error) {
        logger.error('Error fetching Product-wise Sponsored Ads data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Delete Product-wise Sponsored Ads data by user/country/region
 * Deletes from both old and new format collections
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Delete result
 */
async function deleteProductWiseSponsoredAdsData(userId, country, region) {
    try {
        if (!userId) {
            throw new Error('User ID is required');
        }

        // Convert userId to ObjectId if it's a string
        let userObjectId;
        try {
            userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
        } catch (err) {
            throw new Error(`Invalid User ID format: ${userId}`);
        }

        // Delete from both collections
        const [oldFormatResult, newFormatResult] = await Promise.all([
            ProductWiseSponsoredAdsData.deleteMany({ userId: userObjectId, country, region }),
            ProductWiseSponsoredAdsItem.deleteMany({ userId: userObjectId, country, region })
        ]);

        logger.info('Product-wise Sponsored Ads data deleted', {
            userId: userObjectId.toString(),
            country,
            region,
            oldFormatDeleted: oldFormatResult.deletedCount,
            newFormatDeleted: newFormatResult.deletedCount
        });

        return {
            deletedCount: oldFormatResult.deletedCount + newFormatResult.deletedCount,
            oldFormatDeleted: oldFormatResult.deletedCount,
            newFormatDeleted: newFormatResult.deletedCount
        };

    } catch (error) {
        logger.error('Error deleting Product-wise Sponsored Ads data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get aggregated ad spend by ASIN (optimized for profitability table)
 * Uses MongoDB aggregation instead of loading all items, with Redis caching.
 * 
 * This is significantly faster than getProductWiseSponsoredAdsData for large datasets
 * because it aggregates spend per ASIN in MongoDB and only returns the aggregated map.
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Map<string, number>>} Map of ASIN to total spend
 */
async function getAdsSpendByAsin(userId, country, region) {
    try {
        if (!userId) {
            throw new Error('User ID is required');
        }

        // Convert userId to ObjectId if it's a string
        let userObjectId;
        try {
            userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
        } catch (err) {
            throw new Error(`Invalid User ID format: ${userId}`);
        }

        const userIdStr = userObjectId.toString();
        const cacheKey = `ads_spend_by_asin:${userIdStr}:${country}:${region}`;
        const CACHE_TTL = 3600; // 1 hour cache

        // Try to get from Redis cache first
        try {
            const redis = getRedisClient();
            const cachedData = await redis.get(cacheKey);
            
            if (cachedData) {
                logger.debug('Found ads spend by ASIN in Redis cache', {
                    userId: userIdStr,
                    country,
                    region
                });
                
                // Convert cached JSON back to Map
                const parsed = JSON.parse(cachedData);
                return new Map(Object.entries(parsed));
            }
        } catch (redisError) {
            logger.warn('Redis cache read failed for ads spend, continuing without cache', {
                userId: userIdStr,
                error: redisError.message
            });
        }

        // Not in cache - use the new aggregation method
        const { adsSpendByAsin, batchId, createdAt } = await ProductWiseSponsoredAdsItem.aggregateSpendByAsin(
            userObjectId,
            country,
            region
        );

        if (adsSpendByAsin.size > 0) {
            logger.debug('Aggregated ads spend by ASIN from new format', {
                userId: userIdStr,
                country,
                region,
                asinCount: adsSpendByAsin.size,
                batchId: batchId?.toString()
            });

            // Cache the result in Redis
            try {
                const redis = getRedisClient();
                const cacheData = Object.fromEntries(adsSpendByAsin);
                await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(cacheData));
                
                logger.debug('Cached ads spend by ASIN in Redis', {
                    userId: userIdStr,
                    country,
                    region,
                    asinCount: adsSpendByAsin.size
                });
            } catch (redisError) {
                logger.warn('Redis cache write failed for ads spend', {
                    userId: userIdStr,
                    error: redisError.message
                });
            }

            return adsSpendByAsin;
        }

        // No data found in new format - return empty Map
        // NOTE: Old-format fallback removed after migration script ensures all data is in new format
        // This eliminates heap memory risk from loading large embedded arrays
        logger.debug('No ads data found for spend aggregation', {
            userId: userIdStr,
            country,
            region
        });

        return new Map();

    } catch (error) {
        logger.error('Error getting ads spend by ASIN', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Invalidate the cached ads spend by ASIN for a user/country/region
 * Call this when new sponsored ads data is saved
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 */
async function invalidateAdsSpendCache(userId, country, region) {
    try {
        const userIdStr = typeof userId === 'string' ? userId : userId.toString();
        const cacheKey = `ads_spend_by_asin:${userIdStr}:${country}:${region}`;
        
        const redis = getRedisClient();
        await redis.del(cacheKey);
        
        logger.debug('Invalidated ads spend cache', {
            userId: userIdStr,
            country,
            region
        });
    } catch (error) {
        logger.warn('Failed to invalidate ads spend cache', {
            userId,
            country,
            region,
            error: error.message
        });
    }
}

module.exports = {
    saveProductWiseSponsoredAdsData,
    getProductWiseSponsoredAdsData,
    deleteProductWiseSponsoredAdsData,
    getAdsSpendByAsin,
    invalidateAdsSpendCache
};

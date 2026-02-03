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

module.exports = {
    saveProductWiseSponsoredAdsData,
    getProductWiseSponsoredAdsData,
    deleteProductWiseSponsoredAdsData
};

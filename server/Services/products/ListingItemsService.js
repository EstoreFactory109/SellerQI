/**
 * ListingItemsService.js
 * 
 * Service for managing ListingItems (GenericKeyword) data in the database.
 * 
 * This service handles both old format (embedded GenericKeyword[] in a single document)
 * and new format (separate collection with one document per keyword).
 * 
 * The migration is transparent - callers always receive data in the same format.
 */

const mongoose = require('mongoose');
const ListingItems = require('../../models/products/GetListingItemsModel');
const ListingItemsKeyword = require('../../models/products/ListingItemsKeywordModel');
const logger = require('../../utils/Logger');

// Chunk size for insertMany operations to reduce memory usage
const INSERT_CHUNK_SIZE = 500;

/**
 * Save ListingItems (GenericKeyword) data to database
 * Always uses new format (separate collection) to prevent 16MB limit
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Array} genericKeywordArray - Array of keyword items (asin, value, marketplace_id)
 * @returns {Promise<Object>} Result with saved document info
 */
async function saveListingItemsData(userId, country, region, genericKeywordArray) {
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

        const itemCount = genericKeywordArray?.length || 0;

        logger.info('Saving ListingItems data using separate collection', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount
        });

        // Generate a batch ID to group all items from this save operation
        const batchId = new mongoose.Types.ObjectId();

        // If no data, just return success with 0 count
        if (itemCount === 0) {
            logger.info('No GenericKeyword data to save');
            return {
                success: true,
                message: 'No data to save',
                itemCount: 0,
                batchId: batchId.toString()
            };
        }

        // Filter out invalid items (null, false, or missing required fields)
        const validItems = genericKeywordArray.filter(item => 
            item && item.asin && item.value && item.marketplace_id
        );

        if (validItems.length === 0) {
            logger.info('No valid GenericKeyword items to save after filtering');
            return {
                success: true,
                message: 'No valid data to save',
                itemCount: 0,
                batchId: batchId.toString()
            };
        }

        // Save items to separate collection in chunks to reduce memory usage
        // Process in chunks of INSERT_CHUNK_SIZE to avoid building one huge array
        let insertedCount = 0;
        const totalChunks = Math.ceil(validItems.length / INSERT_CHUNK_SIZE);

        for (let i = 0; i < validItems.length; i += INSERT_CHUNK_SIZE) {
            const chunkItems = validItems.slice(i, i + INSERT_CHUNK_SIZE);
            const chunkNumber = Math.floor(i / INSERT_CHUNK_SIZE) + 1;

            // Map chunk to insert format
            const itemsToInsert = chunkItems.map(item => ({
                User: userObjectId,
                country,
                region,
                batchId,
                asin: item.asin || '',
                value: item.value || '',
                marketplace_id: item.marketplace_id || ''
            }));

            // Use insertMany with ordered:false for better performance
            await ListingItemsKeyword.insertMany(itemsToInsert, { ordered: false });
            insertedCount += chunkItems.length;

            // Log progress for large datasets
            if (totalChunks > 1 && chunkNumber % 5 === 0) {
                logger.info('ListingItems save progress', {
                    userId: userObjectId.toString(),
                    chunk: `${chunkNumber}/${totalChunks}`,
                    insertedSoFar: insertedCount,
                    total: validItems.length
                });
            }
        }

        logger.info('ListingItems data saved successfully', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount: validItems.length,
            batchId: batchId.toString(),
            chunks: totalChunks
        });

        // Clean up old batches (keep only last 3)
        try {
            const deleteResult = await ListingItemsKeyword.deleteOldBatches(userObjectId, country, region, 3);
            if (deleteResult.deletedCount > 0) {
                logger.info('Cleaned up old ListingItems batches', {
                    userId: userObjectId.toString(),
                    deletedCount: deleteResult.deletedCount
                });
            }
        } catch (cleanupError) {
            // Don't fail the save operation if cleanup fails
            logger.warn('Failed to cleanup old ListingItems batches', {
                userId: userObjectId.toString(),
                error: cleanupError.message
            });
        }

        return {
            success: true,
            message: 'Data saved successfully',
            itemCount: validItems.length,
            batchId: batchId.toString(),
            userId: userObjectId.toString(),
            country,
            region
        };

    } catch (error) {
        logger.error('Error saving ListingItems data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get ListingItems (GenericKeyword) data by user/country/region
 * Handles both old format (embedded array) and new format (separate collection)
 * Returns data in a consistent format regardless of storage method
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object|null>} ListingItems object with GenericKeyword array, or null if not found
 */
async function getListingItemsData(userId, country, region) {
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
        const { items: newFormatItems, createdAt, batchId } = await ListingItemsKeyword.findLatestByUserCountryRegion(
            userObjectId,
            country,
            region
        );

        if (newFormatItems && newFormatItems.length > 0) {
            logger.debug('Found ListingItems data in new format (separate collection)', {
                userId: userObjectId.toString(),
                country,
                region,
                itemCount: newFormatItems.length
            });

            // Transform to match the old format structure
            const GenericKeyword = newFormatItems.map(item => ({
                asin: item.asin,
                value: item.value,
                marketplace_id: item.marketplace_id
            }));

            // Return in the same format as old format
            return {
                _id: batchId,
                User: userObjectId,
                country,
                region,
                GenericKeyword,
                createdAt,
                updatedAt: createdAt
            };
        }

        // Fallback: Try to get data from old format (embedded array in single document)
        const oldFormatDoc = await ListingItems.findOne({
            User: userObjectId,
            country,
            region
        }).sort({ createdAt: -1 }).lean();

        if (oldFormatDoc && oldFormatDoc.GenericKeyword && oldFormatDoc.GenericKeyword.length > 0) {
            logger.debug('Found ListingItems data in old format (embedded array)', {
                userId: userObjectId.toString(),
                country,
                region,
                itemCount: oldFormatDoc.GenericKeyword.length
            });

            return oldFormatDoc;
        }

        logger.debug('No ListingItems data found', {
            userId: userObjectId.toString(),
            country,
            region
        });

        return null;

    } catch (error) {
        logger.error('Error fetching ListingItems data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Delete ListingItems (GenericKeyword) data by user/country/region
 * Deletes from both old and new format collections
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Delete result
 */
async function deleteListingItemsData(userId, country, region) {
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
            ListingItems.deleteMany({ User: userObjectId, country, region }),
            ListingItemsKeyword.deleteMany({ User: userObjectId, country, region })
        ]);

        logger.info('ListingItems data deleted', {
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
        logger.error('Error deleting ListingItems data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

module.exports = {
    saveListingItemsData,
    getListingItemsData,
    deleteListingItemsData
};

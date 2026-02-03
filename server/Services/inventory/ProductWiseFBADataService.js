/**
 * ProductWiseFBADataService.js
 * 
 * Service for managing Product-wise FBA data in the database.
 * 
 * This service handles both old format (embedded fbaData[] in a single document)
 * and new format (separate collection with one document per product).
 * 
 * The migration is transparent - callers always receive data in the same format.
 * 
 * OLD FORMAT (legacy): Single document with fbaData[] array (can hit 16MB limit)
 * NEW FORMAT: Items stored in ProductWiseFBADataItem collection (no 16MB limit)
 */

const mongoose = require('mongoose');
const ProductWiseFBAData = require('../../models/inventory/ProductWiseFBADataModel');
const ProductWiseFBADataItem = require('../../models/inventory/ProductWiseFBADataItemModel');
const logger = require('../../utils/Logger');

/**
 * Save Product-wise FBA data to database
 * Always uses new format (separate collection) to prevent 16MB limit
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Array} fbaDataArray - Array of FBA data items
 * @returns {Promise<Object>} Result with saved document info
 */
async function saveProductWiseFBAData(userId, country, region, fbaDataArray) {
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

        const itemCount = fbaDataArray?.length || 0;

        logger.info('Saving Product-wise FBA data using separate collection', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount
        });

        // Generate a batch ID to group all items from this save operation
        const batchId = new mongoose.Types.ObjectId();

        // If no data, just create a header document for tracking
        if (itemCount === 0) {
            logger.info('No FBA data to save');
            return {
                success: true,
                message: 'No data to save',
                itemCount: 0,
                batchId: batchId.toString()
            };
        }

        // Save items to separate collection
        const itemsToInsert = fbaDataArray.map(item => ({
            userId: userObjectId,
            country,
            region,
            batchId,
            ...item
        }));

        // Use insertMany with ordered:false for better performance
        await ProductWiseFBADataItem.insertMany(itemsToInsert, { ordered: false });

        logger.info('Product-wise FBA data saved successfully', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount,
            batchId: batchId.toString()
        });

        // Clean up old batches (keep only last 3)
        try {
            const deleteResult = await ProductWiseFBADataItem.deleteOldBatches(userObjectId, country, region, 3);
            if (deleteResult.deletedCount > 0) {
                logger.info('Cleaned up old FBA data batches', {
                    userId: userObjectId.toString(),
                    deletedCount: deleteResult.deletedCount
                });
            }
        } catch (cleanupError) {
            // Don't fail the save operation if cleanup fails
            logger.warn('Failed to cleanup old FBA data batches', {
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
        logger.error('Error saving Product-wise FBA data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get Product-wise FBA data by user/country/region
 * Handles both old format (embedded array) and new format (separate collection)
 * Returns data in a consistent format regardless of storage method
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object|null>} FBA data object with fbaData array, or null if not found
 */
async function getProductWiseFBAData(userId, country, region) {
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
        const newFormatItems = await ProductWiseFBADataItem.findLatestByUserCountryRegion(
            userObjectId,
            country,
            region
        );

        if (newFormatItems && newFormatItems.length > 0) {
            logger.debug('Found FBA data in new format (separate collection)', {
                userId: userObjectId.toString(),
                country,
                region,
                itemCount: newFormatItems.length
            });

            // Transform to match the old format structure
            // Remove internal fields (userId, country, region, batchId, _id, __v, createdAt, updatedAt)
            const fbaData = newFormatItems.map(item => {
                const { userId, country, region, batchId, _id, __v, createdAt, updatedAt, ...fbaItem } = item;
                return fbaItem;
            });

            // Return in the same format as old format
            return {
                _id: newFormatItems[0].batchId, // Use batchId as _id for consistency
                userId: userObjectId,
                country,
                region,
                fbaData,
                createdAt: newFormatItems[0].createdAt,
                updatedAt: newFormatItems[0].updatedAt
            };
        }

        // Fallback: Try to get data from old format (embedded array in single document)
        const oldFormatDoc = await ProductWiseFBAData.findOne({
            userId: userObjectId,
            country,
            region
        }).sort({ createdAt: -1 }).lean();

        if (oldFormatDoc && oldFormatDoc.fbaData && oldFormatDoc.fbaData.length > 0) {
            logger.debug('Found FBA data in old format (embedded array)', {
                userId: userObjectId.toString(),
                country,
                region,
                itemCount: oldFormatDoc.fbaData.length
            });

            return oldFormatDoc;
        }

        logger.debug('No FBA data found', {
            userId: userObjectId.toString(),
            country,
            region
        });

        return null;

    } catch (error) {
        logger.error('Error fetching Product-wise FBA data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Delete Product-wise FBA data by user/country/region
 * Deletes from both old and new format collections
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Delete result
 */
async function deleteProductWiseFBAData(userId, country, region) {
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
            ProductWiseFBAData.deleteMany({ userId: userObjectId, country, region }),
            ProductWiseFBADataItem.deleteMany({ userId: userObjectId, country, region })
        ]);

        logger.info('Product-wise FBA data deleted', {
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
        logger.error('Error deleting Product-wise FBA data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

module.exports = {
    saveProductWiseFBAData,
    getProductWiseFBAData,
    deleteProductWiseFBAData
};

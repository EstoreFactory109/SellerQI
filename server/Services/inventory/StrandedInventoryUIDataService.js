/**
 * StrandedInventoryUIDataService.js
 * 
 * Service for managing Stranded Inventory UI data in the database.
 * 
 * This service handles both old format (embedded strandedUIData[] in a single document)
 * and new format (separate collection with one document per product).
 * 
 * The migration is transparent - callers always receive data in the same format.
 */

const mongoose = require('mongoose');
const StrandedInventoryUIData = require('../../models/inventory/GET_STRANDED_INVENTORY_UI_DATA_MODEL');
const StrandedInventoryUIDataItem = require('../../models/inventory/StrandedInventoryUIDataItemModel');
const logger = require('../../utils/Logger');

/**
 * Save Stranded Inventory UI data to database
 * Always uses new format (separate collection) to prevent 16MB limit
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Array} strandedUIDataArray - Array of stranded items (asin, status_primary, stranded_reason)
 * @returns {Promise<Object>} Result with saved document info
 */
async function saveStrandedInventoryUIData(userId, country, region, strandedUIDataArray) {
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

        const itemCount = strandedUIDataArray?.length || 0;

        logger.info('Saving Stranded Inventory UI data using separate collection', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount
        });

        // Generate a batch ID to group all items from this save operation
        const batchId = new mongoose.Types.ObjectId();

        // If no data, just return success with 0 count
        if (itemCount === 0) {
            logger.info('No stranded inventory data to save');
            return {
                success: true,
                message: 'No data to save',
                itemCount: 0,
                batchId: batchId.toString()
            };
        }

        // Save items to separate collection
        const itemsToInsert = strandedUIDataArray.map(item => ({
            User: userObjectId,
            country,
            region,
            batchId,
            asin: item.asin || '',
            status_primary: item.status_primary || '',
            stranded_reason: item.stranded_reason || ''
        }));

        // Use insertMany with ordered:false for better performance
        await StrandedInventoryUIDataItem.insertMany(itemsToInsert, { ordered: false });

        logger.info('Stranded Inventory UI data saved successfully', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount,
            batchId: batchId.toString()
        });

        // Clean up old batches (keep only last 3)
        try {
            const deleteResult = await StrandedInventoryUIDataItem.deleteOldBatches(userObjectId, country, region, 3);
            if (deleteResult.deletedCount > 0) {
                logger.info('Cleaned up old Stranded Inventory batches', {
                    userId: userObjectId.toString(),
                    deletedCount: deleteResult.deletedCount
                });
            }
        } catch (cleanupError) {
            // Don't fail the save operation if cleanup fails
            logger.warn('Failed to cleanup old Stranded Inventory batches', {
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
        logger.error('Error saving Stranded Inventory UI data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get Stranded Inventory UI data by user/country/region
 * Handles both old format (embedded array) and new format (separate collection)
 * Returns data in a consistent format regardless of storage method
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object|null>} Stranded data object with strandedUIData array, or null if not found
 */
async function getStrandedInventoryUIData(userId, country, region) {
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
        const { items: newFormatItems, createdAt, batchId } = await StrandedInventoryUIDataItem.findLatestByUserCountryRegion(
            userObjectId,
            country,
            region
        );

        if (newFormatItems && newFormatItems.length > 0) {
            logger.debug('Found Stranded Inventory data in new format (separate collection)', {
                userId: userObjectId.toString(),
                country,
                region,
                itemCount: newFormatItems.length
            });

            // Transform to match the old format structure
            // The old format has strandedUIData as an array of arrays, but we'll flatten it
            const strandedUIData = newFormatItems.map(item => ({
                asin: item.asin,
                status_primary: item.status_primary,
                stranded_reason: item.stranded_reason
            }));

            // Return in the same format as old format (wrap in array to maintain compatibility)
            // Old format had strandedUIData: [[item1, item2, ...]] (array of arrays)
            return {
                _id: batchId,
                User: userObjectId,
                country,
                region,
                strandedUIData: [strandedUIData], // Wrap in array to match old nested structure
                createdAt,
                updatedAt: createdAt
            };
        }

        // Fallback: Try to get data from old format (embedded array in single document)
        const oldFormatDoc = await StrandedInventoryUIData.findOne({
            User: userObjectId,
            country,
            region
        }).sort({ createdAt: -1 }).lean();

        if (oldFormatDoc && oldFormatDoc.strandedUIData && oldFormatDoc.strandedUIData.length > 0) {
            logger.debug('Found Stranded Inventory data in old format (embedded array)', {
                userId: userObjectId.toString(),
                country,
                region,
                itemCount: oldFormatDoc.strandedUIData.length
            });

            return oldFormatDoc;
        }

        logger.debug('No Stranded Inventory data found', {
            userId: userObjectId.toString(),
            country,
            region
        });

        return null;

    } catch (error) {
        logger.error('Error fetching Stranded Inventory UI data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Delete Stranded Inventory UI data by user/country/region
 * Deletes from both old and new format collections
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Delete result
 */
async function deleteStrandedInventoryUIData(userId, country, region) {
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
            StrandedInventoryUIData.deleteMany({ User: userObjectId, country, region }),
            StrandedInventoryUIDataItem.deleteMany({ User: userObjectId, country, region })
        ]);

        logger.info('Stranded Inventory UI data deleted', {
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
        logger.error('Error deleting Stranded Inventory UI data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

module.exports = {
    saveStrandedInventoryUIData,
    getStrandedInventoryUIData,
    deleteStrandedInventoryUIData
};

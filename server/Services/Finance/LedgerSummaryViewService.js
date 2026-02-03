/**
 * LedgerSummaryViewService.js
 * 
 * Service for managing Ledger Summary View data in the database.
 * 
 * This service handles both old format (embedded data[] in a single document)
 * and new format (separate collection with one document per ledger entry).
 * 
 * The migration is transparent - callers always receive data in the same format.
 */

const mongoose = require('mongoose');
const LedgerSummaryView = require('../../models/finance/LedgerSummaryViewModel');
const LedgerSummaryViewItem = require('../../models/finance/LedgerSummaryViewItemModel');
const logger = require('../../utils/Logger');

/**
 * Save Ledger Summary View data to database
 * Always uses new format (separate collection) to prevent 16MB limit
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Array} dataArray - Array of ledger summary items
 * @returns {Promise<Object>} Result with saved document info
 */
async function saveLedgerSummaryViewData(userId, country, region, dataArray) {
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

        const itemCount = dataArray?.length || 0;

        logger.info('Saving Ledger Summary View data using separate collection', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount
        });

        // Generate a batch ID to group all items from this save operation
        const batchId = new mongoose.Types.ObjectId();

        // If no data, just return success with 0 count
        if (itemCount === 0) {
            logger.info('No Ledger Summary View data to save');
            return {
                success: true,
                message: 'No data to save',
                itemCount: 0,
                batchId: batchId.toString()
            };
        }

        // Save items to separate collection
        const itemsToInsert = dataArray.map(item => ({
            User: userObjectId,
            country,
            region,
            batchId,
            date: item.date || '',
            fnsku: item.fnsku || '',
            asin: item.asin || '',
            msku: item.msku || '',
            title: item.title || '',
            disposition: item.disposition || '',
            starting_warehouse_balance: item.starting_warehouse_balance || '0',
            in_transit_between_warehouses: item.in_transit_between_warehouses || '0',
            receipts: item.receipts || '0',
            customer_shipments: item.customer_shipments || '0',
            customer_returns: item.customer_returns || '0',
            vendor_returns: item.vendor_returns || '0',
            warehouse_transfer_in_out: item.warehouse_transfer_in_out || '0',
            found: item.found || '0',
            lost: item.lost || '0',
            damaged: item.damaged || '0',
            disposed: item.disposed || '0',
            other_events: item.other_events || '0',
            ending_warehouse_balance: item.ending_warehouse_balance || '0',
            unknown_events: item.unknown_events || '0',
            location: item.location || '',
            store: item.store || ''
        }));

        // Use insertMany with ordered:false for better performance
        await LedgerSummaryViewItem.insertMany(itemsToInsert, { ordered: false });

        logger.info('Ledger Summary View data saved successfully', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount,
            batchId: batchId.toString()
        });

        // Clean up old batches (keep only last 3)
        try {
            const deleteResult = await LedgerSummaryViewItem.deleteOldBatches(userObjectId, country, region, 3);
            if (deleteResult.deletedCount > 0) {
                logger.info('Cleaned up old Ledger Summary View batches', {
                    userId: userObjectId.toString(),
                    deletedCount: deleteResult.deletedCount
                });
            }
        } catch (cleanupError) {
            // Don't fail the save operation if cleanup fails
            logger.warn('Failed to cleanup old Ledger Summary View batches', {
                userId: userObjectId.toString(),
                error: cleanupError.message
            });
        }

        return {
            success: true,
            message: 'Data saved successfully',
            itemCount,
            batchId: batchId.toString(),
            recordId: batchId.toString(),
            userId: userObjectId.toString(),
            country,
            region
        };

    } catch (error) {
        logger.error('Error saving Ledger Summary View data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get Ledger Summary View data by user/country/region
 * Handles both old format (embedded array) and new format (separate collection)
 * Returns data in a consistent format regardless of storage method
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object|null>} Ledger data object with data array, or null if not found
 */
async function getLedgerSummaryViewData(userId, country, region) {
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
        const { items: newFormatItems, createdAt, batchId } = await LedgerSummaryViewItem.findLatestByUserCountryRegion(
            userObjectId,
            country,
            region
        );

        if (newFormatItems && newFormatItems.length > 0) {
            logger.debug('Found Ledger Summary View data in new format (separate collection)', {
                userId: userObjectId.toString(),
                country,
                region,
                itemCount: newFormatItems.length
            });

            // Transform to match the old format structure
            const data = newFormatItems.map(item => ({
                date: item.date,
                fnsku: item.fnsku,
                asin: item.asin,
                msku: item.msku,
                title: item.title,
                disposition: item.disposition,
                starting_warehouse_balance: item.starting_warehouse_balance,
                in_transit_between_warehouses: item.in_transit_between_warehouses,
                receipts: item.receipts,
                customer_shipments: item.customer_shipments,
                customer_returns: item.customer_returns,
                vendor_returns: item.vendor_returns,
                warehouse_transfer_in_out: item.warehouse_transfer_in_out,
                found: item.found,
                lost: item.lost,
                damaged: item.damaged,
                disposed: item.disposed,
                other_events: item.other_events,
                ending_warehouse_balance: item.ending_warehouse_balance,
                unknown_events: item.unknown_events,
                location: item.location,
                store: item.store
            }));

            // Return in the same format as old format
            return {
                _id: batchId,
                User: userObjectId,
                country,
                region,
                data,
                createdAt,
                updatedAt: createdAt
            };
        }

        // Fallback: Try to get data from old format (embedded array in single document)
        const oldFormatDoc = await LedgerSummaryView.findOne({
            User: userObjectId,
            country,
            region
        }).sort({ createdAt: -1 }).lean();

        if (oldFormatDoc && oldFormatDoc.data && oldFormatDoc.data.length > 0) {
            logger.debug('Found Ledger Summary View data in old format (embedded array)', {
                userId: userObjectId.toString(),
                country,
                region,
                itemCount: oldFormatDoc.data.length
            });

            return oldFormatDoc;
        }

        logger.debug('No Ledger Summary View data found', {
            userId: userObjectId.toString(),
            country,
            region
        });

        return null;

    } catch (error) {
        logger.error('Error fetching Ledger Summary View data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Delete Ledger Summary View data by user/country/region
 * Deletes from both old and new format collections
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Delete result
 */
async function deleteLedgerSummaryViewData(userId, country, region) {
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
            LedgerSummaryView.deleteMany({ User: userObjectId, country, region }),
            LedgerSummaryViewItem.deleteMany({ User: userObjectId, country, region })
        ]);

        logger.info('Ledger Summary View data deleted', {
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
        logger.error('Error deleting Ledger Summary View data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

module.exports = {
    saveLedgerSummaryViewData,
    getLedgerSummaryViewData,
    deleteLedgerSummaryViewData
};

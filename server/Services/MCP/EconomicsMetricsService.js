/**
 * EconomicsMetricsService.js
 * 
 * Service for managing economics metrics data in the database
 * 
 * ASIN-wise data is ALWAYS stored in a separate collection (AsinWiseSalesForBigAccounts)
 * to prevent 16MB document size limit issues. This applies to ALL accounts regardless of size.
 */

const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel');
const logger = require('../../utils/Logger');
const { ApiError } = require('../../utils/ApiError');

/**
 * Save economics metrics to database
 * ASIN-wise data is ALWAYS stored in a separate collection to prevent 16MB limit
 * @param {string} userId - User ID
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} country - Country code
 * @param {Object} metrics - Calculated metrics object
 * @param {string} queryId - Optional query ID
 * @param {string} documentId - Optional document ID
 * @returns {Promise<Object>} Saved document
 */
async function saveEconomicsMetrics(userId, region, country, metrics, queryId = null, documentId = null) {
    try {
        if (!userId) {
            throw new ApiError(400, 'User ID is required');
        }
        if (!region) {
            throw new ApiError(400, 'Region is required');
        }
        if (!metrics) {
            throw new ApiError(400, 'Metrics data is required');
        }

        // Convert userId to ObjectId if it's a string
        const mongoose = require('mongoose');
        let userObjectId;
        try {
            userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
        } catch (err) {
            throw new ApiError(400, `Invalid User ID format: ${userId}`);
        }

        const totalSalesAmount = metrics.totalSales?.amount || 0;
        const asinCount = metrics.asinWiseSales?.length || 0;

        logger.info('Saving economics metrics to database', {
            userId: userObjectId.toString(),
            region,
            country,
            dateRange: metrics.dateRange,
            totalSales: totalSalesAmount,
            asinCount
        });

        // ALWAYS store ASIN-wise data in separate collection to prevent 16MB limit
        return await saveMetricsWithSeparateAsinData(userObjectId, region, country, metrics, queryId, documentId);
    } catch (error) {
        logger.error('Error saving economics metrics to database', {
            userId,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Save metrics with ASIN-wise data in separate collection
 * This is now used for ALL accounts to prevent 16MB document size limit
 * ASIN-wise data is stored in a separate collection, grouped by date
 */
async function saveMetricsWithSeparateAsinData(userObjectId, region, country, metrics, queryId, documentId) {
    // Step 1: Save main document WITHOUT asinWiseSales (to avoid 16MB limit)
    const economicsMetrics = new EconomicsMetrics({
        User: userObjectId,
        region: region,
        country: country,
        dateRange: {
            startDate: metrics.dateRange.startDate,
            endDate: metrics.dateRange.endDate
        },
        totalSales: metrics.totalSales,
        grossProfit: metrics.grossProfit,
        ppcSpent: metrics.ppcSpent,
        fbaFees: metrics.fbaFees,
        storageFees: metrics.storageFees,
        totalFees: metrics.totalFees,
        amazonFees: metrics.amazonFees || { amount: 0, currencyCode: 'USD' },
        amazonFeesBreakdown: metrics.amazonFeesBreakdown || [],
        refunds: metrics.refunds,
        datewiseSales: metrics.datewiseSales || [],
        datewiseGrossProfit: metrics.datewiseGrossProfit || [],
        datewiseFeesAndRefunds: metrics.datewiseFeesAndRefunds || [],
        datewiseAmazonFees: metrics.datewiseAmazonFees || [],
        asinWiseSales: [], // Empty - data stored in separate collection
        queryId: queryId,
        documentId: documentId,
        dataSource: 'DataKiosk',
        isBig: true // Always true now - ASIN data always in separate collection
    });

    const savedMetrics = await economicsMetrics.save();

    logger.info('Main economics metrics saved (ASIN data in separate collection)', {
        metricsId: savedMetrics._id,
        userId: userObjectId.toString(),
        region,
        country
    });

    // Step 2: Save ASIN-wise data in separate collection, grouped by date
    const asinWiseSales = metrics.asinWiseSales || [];
    
    if (asinWiseSales.length > 0) {
        // Group ASIN sales by date
        const salesByDate = {};
        
        asinWiseSales.forEach(asinSale => {
            const date = asinSale.date || 'no_date';
            
            if (!salesByDate[date]) {
                salesByDate[date] = [];
            }
            
            // Create ASIN sales item without the date field (it's stored at document level)
            salesByDate[date].push({
                asin: asinSale.asin,
                parentAsin: asinSale.parentAsin || null,
                sales: asinSale.sales,
                grossProfit: asinSale.grossProfit,
                unitsSold: asinSale.unitsSold,
                refunds: asinSale.refunds,
                ppcSpent: asinSale.ppcSpent,
                fbaFees: asinSale.fbaFees,
                storageFees: asinSale.storageFees,
                totalFees: asinSale.totalFees,
                amazonFees: asinSale.amazonFees,
                feeBreakdown: asinSale.feeBreakdown || []
            });
        });

        // Save each date's ASIN sales as a separate document
        const dateDocuments = Object.entries(salesByDate).map(([date, asinSales]) => ({
            metricsId: savedMetrics._id,
            User: userObjectId,
            region: region,
            country: country,
            date: date,
            asinSales: asinSales
        }));

        // Insert all date documents
        if (dateDocuments.length > 0) {
            await AsinWiseSalesForBigAccounts.insertMany(dateDocuments);

            logger.info('ASIN-wise sales saved in separate collection', {
                metricsId: savedMetrics._id,
                userId: userObjectId.toString(),
                region,
                country,
                totalDates: dateDocuments.length,
                totalAsinRecords: asinWiseSales.length
            });
        }
    }

    return savedMetrics;
}

/**
 * Get economics metrics by date range
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @returns {Promise<Array>} Array of metrics documents
 */
async function getEconomicsMetricsByDateRange(userId, region, startDate, endDate) {
    try {
        const metricsList = await EconomicsMetrics.findByDateRange(userId, region, startDate, endDate);
        
        // Combine ASIN data for big accounts
        const result = await Promise.all(metricsList.map(async (metrics) => {
            return await combineAsinDataIfBigAccount(metrics);
        }));
        
        return result;
    } catch (error) {
        logger.error('Error fetching economics metrics by date range', {
            userId,
            region,
            startDate,
            endDate,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get latest economics metrics
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} country - Country/marketplace code (default: 'US')
 * @returns {Promise<Object|null>} Latest metrics document or null
 */
async function getLatestEconomicsMetrics(userId, region, country = 'US') {
    try {
        const metrics = await EconomicsMetrics.findLatest(userId, region, country);
        
        if (!metrics) {
            return null;
        }
        
        // Combine ASIN data for big accounts
        return await combineAsinDataIfBigAccount(metrics);
    } catch (error) {
        logger.error('Error fetching latest economics metrics', {
            userId,
            region,
            country,
            error: error.message
        });
        throw error;
    }
}

/**
 * Combine ASIN data from separate collection
 * All accounts now store ASIN data in the separate collection, so this always fetches from there.
 * For backward compatibility, also handles legacy documents where isBig=false and data is embedded.
 * Returns the metrics object with asinWiseSales populated
 * @param {Object} metrics - Economics metrics document
 * @returns {Promise<Object>} Metrics with combined ASIN data
 */
async function combineAsinDataIfBigAccount(metrics) {
    if (!metrics) return metrics;
    
    const metricsObj = metrics.toObject ? metrics.toObject() : metrics;
    
    // For backward compatibility: if isBig=false and asinWiseSales has data, return as-is (legacy data)
    if (!metricsObj.isBig && metricsObj.asinWiseSales && metricsObj.asinWiseSales.length > 0) {
        return metricsObj;
    }
    
    // Fetch ASIN data from separate collection (for isBig=true or when asinWiseSales is empty)
    try {
        const asinSalesDocs = await AsinWiseSalesForBigAccounts.findByMetricsId(metricsObj._id);
        
        if (!asinSalesDocs || asinSalesDocs.length === 0) {
            logger.debug('No ASIN sales found in separate collection', {
                metricsId: metricsObj._id
            });
            return metricsObj;
        }
        
        // Flatten all ASIN sales from all date documents back into asinWiseSales format
        const asinWiseSales = [];
        
        asinSalesDocs.forEach(doc => {
            const date = doc.date;
            
            if (doc.asinSales && Array.isArray(doc.asinSales)) {
                doc.asinSales.forEach(asinSale => {
                    // Add date back to each ASIN sale (matches original format)
                    asinWiseSales.push({
                        date: date === 'no_date' ? null : date,
                        asin: asinSale.asin,
                        parentAsin: asinSale.parentAsin,
                        sales: asinSale.sales,
                        grossProfit: asinSale.grossProfit,
                        unitsSold: asinSale.unitsSold,
                        refunds: asinSale.refunds,
                        ppcSpent: asinSale.ppcSpent,
                        fbaFees: asinSale.fbaFees,
                        storageFees: asinSale.storageFees,
                        totalFees: asinSale.totalFees,
                        amazonFees: asinSale.amazonFees,
                        feeBreakdown: asinSale.feeBreakdown
                    });
                });
            }
        });
        
        logger.debug('Combined ASIN sales from separate collection', {
            metricsId: metricsObj._id,
            totalDates: asinSalesDocs.length,
            totalAsinRecords: asinWiseSales.length
        });
        
        // Return metrics with combined asinWiseSales
        return {
            ...metricsObj,
            asinWiseSales: asinWiseSales
        };
        
    } catch (error) {
        logger.error('Error combining ASIN data from separate collection', {
            metricsId: metricsObj._id,
            error: error.message
        });
        // Return original metrics if combining fails
        return metricsObj;
    }
}

/**
 * Delete economics metrics by ID
 * Also deletes ASIN data from separate collection (always, since all accounts now use it)
 * @param {string} metricsId - Metrics document ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Deleted document
 */
async function deleteEconomicsMetrics(metricsId, userId) {
    try {
        const metrics = await EconomicsMetrics.findOneAndDelete({
            _id: metricsId,
            User: userId
        });

        if (!metrics) {
            throw new ApiError(404, 'Economics metrics not found or unauthorized');
        }

        // Always delete ASIN data from separate collection (all accounts now use it)
        // This also handles legacy isBig=true documents
        const deleteResult = await AsinWiseSalesForBigAccounts.deleteByMetricsId(metricsId);
        if (deleteResult.deletedCount > 0) {
            logger.info('ASIN sales deleted from separate collection', {
                metricsId,
                userId,
                deletedCount: deleteResult.deletedCount
            });
        }

        logger.info('Economics metrics deleted successfully', {
            metricsId,
            userId
        });

        return metrics;
    } catch (error) {
        logger.error('Error deleting economics metrics', {
            metricsId,
            userId,
            error: error.message
        });
        throw error;
    }
}

module.exports = {
    saveEconomicsMetrics,
    getEconomicsMetricsByDateRange,
    getLatestEconomicsMetrics,
    deleteEconomicsMetrics,
    combineAsinDataIfBigAccount // Export for use by other services that access EconomicsMetrics directly
};

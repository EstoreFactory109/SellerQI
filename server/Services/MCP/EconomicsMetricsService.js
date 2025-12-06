/**
 * EconomicsMetricsService.js
 * 
 * Service for managing economics metrics data in the database
 */

const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel');
const logger = require('../../utils/Logger');
const { ApiError } = require('../../utils/ApiError');

/**
 * Save economics metrics to database
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

        logger.info('Saving economics metrics to database', {
            userId: userObjectId.toString(),
            region,
            country, // country = marketplace (US, UK, DE, JP, etc.)
            dateRange: metrics.dateRange
        });

        // Create new economics metrics document
        // Note: country field stores the marketplace value (US, UK, DE, JP, etc.)
        const economicsMetrics = new EconomicsMetrics({
            User: userObjectId,
            region: region,
            country: country, // marketplace value stored as country
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
            amazonFees: metrics.amazonFees || { amount: 0, currencyCode: 'USD' }, // Amazon-specific fees (FBA, storage, referral, etc.)
            refunds: metrics.refunds,
            datewiseSales: metrics.datewiseSales || [],
            datewiseGrossProfit: metrics.datewiseGrossProfit || [],
            asinWiseSales: metrics.asinWiseSales || [],
            queryId: queryId,
            documentId: documentId,
            dataSource: 'DataKiosk'
        });

        const savedMetrics = await economicsMetrics.save();

        logger.info('Economics metrics saved successfully', {
            metricsId: savedMetrics._id,
            userId,
            region
        });

        return savedMetrics;
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
 * Get economics metrics by date range
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @returns {Promise<Array>} Array of metrics documents
 */
async function getEconomicsMetricsByDateRange(userId, region, startDate, endDate) {
    try {
        return await EconomicsMetrics.findByDateRange(userId, region, startDate, endDate);
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
        return await EconomicsMetrics.findLatest(userId, region, country);
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
 * Delete economics metrics by ID
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
    deleteEconomicsMetrics
};


/**
 * BuyBoxService.js
 * 
 * Service for managing buybox data in the database
 */

const BuyBoxData = require('../../models/MCP/BuyBoxDataModel');
const logger = require('../../utils/Logger');
const { ApiError } = require('../../utils/ApiError');

/**
 * Save buybox data to database
 * @param {string} userId - User ID
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} country - Country code
 * @param {Object} buyBoxMetrics - Calculated buybox metrics object
 * @param {string} queryId - Optional query ID
 * @param {string} documentId - Optional document ID
 * @returns {Promise<Object>} Saved document
 */
async function saveBuyBoxData(userId, region, country, buyBoxMetrics, queryId = null, documentId = null) {
    try {
        if (!userId) {
            throw new ApiError(400, 'User ID is required');
        }
        if (!region) {
            throw new ApiError(400, 'Region is required');
        }
        if (!buyBoxMetrics) {
            throw new ApiError(400, 'BuyBox metrics data is required');
        }

        // Convert userId to ObjectId if it's a string
        const mongoose = require('mongoose');
        let userObjectId;
        try {
            userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
        } catch (err) {
            throw new ApiError(400, `Invalid User ID format: ${userId}`);
        }

        logger.info('Saving buybox data to database', {
            userId: userObjectId.toString(),
            region,
            country,
            dateRange: buyBoxMetrics.dateRange,
            totalProducts: buyBoxMetrics.totalProducts,
            productsWithoutBuyBox: buyBoxMetrics.productsWithoutBuyBox
        });

        // Create new buybox data document
        const buyBoxData = new BuyBoxData({
            User: userObjectId,
            region: region,
            country: country,
            dateRange: {
                startDate: buyBoxMetrics.dateRange.startDate,
                endDate: buyBoxMetrics.dateRange.endDate
            },
            totalProducts: buyBoxMetrics.totalProducts,
            productsWithBuyBox: buyBoxMetrics.productsWithBuyBox,
            productsWithoutBuyBox: buyBoxMetrics.productsWithoutBuyBox,
            productsWithLowBuyBox: buyBoxMetrics.productsWithLowBuyBox,
            asinBuyBoxData: buyBoxMetrics.asinBuyBoxData || [],
            queryId: queryId,
            documentId: documentId,
            dataSource: 'DataKiosk'
        });

        const savedData = await buyBoxData.save();

        logger.info('Buybox data saved successfully', {
            buyBoxDataId: savedData._id,
            userId,
            region,
            productsWithoutBuyBox: savedData.productsWithoutBuyBox
        });

        return savedData;
    } catch (error) {
        logger.error('Error saving buybox data to database', {
            userId,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get buybox data by date range
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @returns {Promise<Array>} Array of buybox data documents
 */
async function getBuyBoxDataByDateRange(userId, region, startDate, endDate) {
    try {
        return await BuyBoxData.findByDateRange(userId, region, startDate, endDate);
    } catch (error) {
        logger.error('Error fetching buybox data by date range', {
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
 * Get latest buybox data
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} country - Country/marketplace code (default: 'US')
 * @returns {Promise<Object|null>} Latest buybox data document or null
 */
async function getLatestBuyBoxData(userId, region, country = 'US') {
    try {
        return await BuyBoxData.findLatest(userId, region, country);
    } catch (error) {
        logger.error('Error fetching latest buybox data', {
            userId,
            region,
            country,
            error: error.message
        });
        throw error;
    }
}

/**
 * Delete buybox data by ID
 * @param {string} buyBoxDataId - BuyBox data document ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Deleted document
 */
async function deleteBuyBoxData(buyBoxDataId, userId) {
    try {
        const buyBoxData = await BuyBoxData.findOneAndDelete({
            _id: buyBoxDataId,
            User: userId
        });

        if (!buyBoxData) {
            throw new ApiError(404, 'Buybox data not found or unauthorized');
        }

        logger.info('Buybox data deleted successfully', {
            buyBoxDataId,
            userId
        });

        return buyBoxData;
    } catch (error) {
        logger.error('Error deleting buybox data', {
            buyBoxDataId,
            userId,
            error: error.message
        });
        throw error;
    }
}

module.exports = {
    saveBuyBoxData,
    getBuyBoxDataByDateRange,
    getLatestBuyBoxData,
    deleteBuyBoxData
};


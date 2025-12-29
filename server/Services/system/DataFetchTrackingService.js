/**
 * DataFetchTrackingService.js
 * 
 * Service for tracking when calendar-affecting services run.
 * This helps debug calendar date range issues by knowing exactly when data was fetched.
 */

const DataFetchTracking = require('../../models/system/DataFetchTrackingModel');
const logger = require('../../utils/Logger');

/**
 * Start tracking a data fetch session
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Object} dataRange - The data date range being fetched { startDate, endDate }
 * @param {string} sessionId - Optional session ID for correlation
 * @returns {Promise<Object>} The created tracking entry
 * 
 * Note: No servicesRan parameter - all calendar-affecting services run together on Mon/Wed/Fri
 */
async function startTracking(userId, country, region, dataRange, sessionId = null) {
    try {
        const trackingEntry = await DataFetchTracking.createTrackingEntry(
            userId,
            country,
            region,
            dataRange,
            sessionId
        );
        
        logger.info('[DataFetchTracking] Started tracking data fetch', {
            trackingId: trackingEntry._id,
            userId,
            country,
            region,
            dayName: trackingEntry.dayName,
            dateString: trackingEntry.dateString,
            timeString: trackingEntry.timeString,
            dataRange
        });
        
        return trackingEntry;
    } catch (error) {
        logger.error('[DataFetchTracking] Error starting tracking', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Mark a tracking entry as completed
 * @param {string} trackingId - The tracking entry ID
 * @returns {Promise<Object>} Updated tracking entry
 */
async function completeTracking(trackingId) {
    try {
        const trackingEntry = await DataFetchTracking.findById(trackingId);
        if (!trackingEntry) {
            throw new Error(`Tracking entry not found: ${trackingId}`);
        }
        
        await trackingEntry.markCompleted();
        
        logger.info('[DataFetchTracking] Completed tracking data fetch', {
            trackingId,
            userId: trackingEntry.User,
            country: trackingEntry.country,
            region: trackingEntry.region,
            dayName: trackingEntry.dayName,
            dataRange: trackingEntry.dataRange
        });
        
        return trackingEntry;
    } catch (error) {
        logger.error('[DataFetchTracking] Error completing tracking', {
            trackingId,
            error: error.message
        });
        throw error;
    }
}

/**
 * Mark a tracking entry as failed
 * @param {string} trackingId - The tracking entry ID
 * @param {string} errorMessage - The error message
 * @returns {Promise<Object>} Updated tracking entry
 */
async function failTracking(trackingId, errorMessage) {
    try {
        const trackingEntry = await DataFetchTracking.findById(trackingId);
        if (!trackingEntry) {
            throw new Error(`Tracking entry not found: ${trackingId}`);
        }
        
        await trackingEntry.markFailed(errorMessage);
        
        logger.info('[DataFetchTracking] Failed tracking data fetch', {
            trackingId,
            userId: trackingEntry.User,
            country: trackingEntry.country,
            region: trackingEntry.region,
            errorMessage
        });
        
        return trackingEntry;
    } catch (error) {
        logger.error('[DataFetchTracking] Error marking tracking as failed', {
            trackingId,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get the latest completed fetch for a user/country/region
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object|null>} Latest tracking entry or null
 */
async function getLatestFetch(userId, country, region) {
    try {
        return await DataFetchTracking.findLatest(userId, country, region);
    } catch (error) {
        logger.error('[DataFetchTracking] Error getting latest fetch', {
            userId,
            country,
            region,
            error: error.message
        });
        return null;
    }
}

/**
 * Get fetch history for a user
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {number} limit - Number of entries to return
 * @returns {Promise<Array>} Array of tracking entries
 */
async function getFetchHistory(userId, country, region, limit = 10) {
    try {
        return await DataFetchTracking.getFetchHistory(userId, country, region, limit);
    } catch (error) {
        logger.error('[DataFetchTracking] Error getting fetch history', {
            userId,
            country,
            region,
            error: error.message
        });
        return [];
    }
}

module.exports = {
    startTracking,
    completeTracking,
    failTracking,
    getLatestFetch,
    getFetchHistory
};


const { Analyse } = require('../../controllers/AnalysingController.js');
const { getRedisClient } = require('../../config/redisConn.js');
const { UserSchedulingService } = require('./UserSchedulingService.js');
const Seller = require('../../models/sellerCentralModel.js');
const logger = require('../../utils/Logger.js');

// Import all the data fetching controllers that need to be updated
const SpApiDataController = require('../../controllers/SpApiDataController.js');

class DataUpdateService {

    /**
     * Update daily data (profitability and sponsored ads) for a specific user
     */
    static async updateDailyDataForUser(userId, country, region) {
        try {
            logger.info(`Starting daily data update for user ${userId}, ${country}-${region}`);

            // First, fetch fresh data from APIs (this would typically involve calling the API controllers)
            // For now, we'll just trigger the analysis with existing data
            // In a production system, you would call the appropriate API fetching methods here

            // Run the analysis to get processed data
            const analysisResult = await Analyse(userId, country, region);
            
            if (analysisResult.status !== 200) {
                logger.error(`Analysis failed for user ${userId}: ${analysisResult.message}`);
                return false;
            }

            // Store the processed data in Redis cache
            await this.updateRedisCache(userId, country, region, analysisResult.message);

            // Mark the update as complete
            await UserSchedulingService.markDailyUpdateComplete(userId, country, region);

            logger.info(`Daily data update completed for user ${userId}, ${country}-${region}`);
            return true;

        } catch (error) {
            logger.error(`Error updating daily data for user ${userId}, ${country}-${region}:`, error);
            return false;
        }
    }

    /**
     * Update weekly data (all other data) for a specific user
     */
    static async updateWeeklyDataForUser(userId, country, region) {
        try {
            logger.info(`Starting weekly data update for user ${userId}, ${country}-${region}`);

            // Fetch fresh data from all APIs
            // In a real implementation, you would call methods to fetch:
            // - V2 and V1 performance reports
            // - Financial events
            // - Inventory recommendations  
            // - Product reviews
            // - Listing items
            // - Competitive pricing
            // - A+ content
            // - Sales data
            // - Shipment data
            // - Keywords, search terms, campaigns

            // For now, we'll trigger analysis with existing data
            const analysisResult = await Analyse(userId, country, region);
            
            if (analysisResult.status !== 200) {
                logger.error(`Analysis failed for user ${userId}: ${analysisResult.message}`);
                return false;
            }

            // Store the processed data in Redis cache
            await this.updateRedisCache(userId, country, region, analysisResult.message);

            // Mark the update as complete
            await UserSchedulingService.markWeeklyUpdateComplete(userId, country, region);

            logger.info(`Weekly data update completed for user ${userId}, ${country}-${region}`);
            return true;

        } catch (error) {
            logger.error(`Error updating weekly data for user ${userId}, ${country}-${region}:`, error);
            return false;
        }
    }

    /**
     * Update Redis cache with processed analysis data
     */
    static async updateRedisCache(userId, country, region, analysisData, adminId = null) {
        try {
            const redisClient = getRedisClient();
            
            // Create the same cache key format as used in the middleware
            const cacheKey = `analyse_data:${userId}:${country}:${region}:${adminId || 'null'}`;
            
            // Cache the data for 1 hour (same as current middleware)
            await redisClient.setEx(cacheKey, 3600, JSON.stringify(analysisData));
            
            logger.info(`Updated Redis cache for key: ${cacheKey}`);
            return true;

        } catch (error) {
            logger.error(`Error updating Redis cache for user ${userId}, ${country}-${region}:`, error);
            return false;
        }
    }

    /**
     * Process daily updates for all eligible users
     */
    static async processDailyUpdates() {
        try {
            logger.info('Starting daily updates process');
            
            const usersNeedingUpdate = await UserSchedulingService.getUsersNeedingDailyUpdate();
            logger.info(`Found ${usersNeedingUpdate.length} users needing daily updates`);

            let successCount = 0;
            let failureCount = 0;

            // Process users in batches to avoid overwhelming the system
            const batchSize = 5;
            for (let i = 0; i < usersNeedingUpdate.length; i += batchSize) {
                const batch = usersNeedingUpdate.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async (userSchedule) => {
                    const userId = userSchedule.userId._id;
                    
                    // Get user's seller accounts
                    const seller = await Seller.findOne({ User: userId });
                    if (!seller || !seller.sellerAccount) {
                        logger.warn(`No seller accounts found for user ${userId}`);
                        return;
                    }

                    // Update data for each seller account
                    for (const account of seller.sellerAccount) {
                        if (account.country && account.region) {
                            const success = await this.updateDailyDataForUser(userId, account.country, account.region);
                            if (success) {
                                successCount++;
                            } else {
                                failureCount++;
                            }
                        }
                    }
                }));

                // Add small delay between batches to reduce load
                if (i + batchSize < usersNeedingUpdate.length) {
                    await this.delay(2000); // 2 second delay
                }
            }

            logger.info(`Daily updates completed: ${successCount} successful, ${failureCount} failed`);
            return { successCount, failureCount };

        } catch (error) {
            logger.error('Error in daily updates process:', error);
            return { successCount: 0, failureCount: 0 };
        }
    }

    /**
     * Process weekly updates for all eligible users
     */
    static async processWeeklyUpdates() {
        try {
            logger.info('Starting weekly updates process');
            
            const usersNeedingUpdate = await UserSchedulingService.getUsersNeedingWeeklyUpdate();
            logger.info(`Found ${usersNeedingUpdate.length} users needing weekly updates`);

            let successCount = 0;
            let failureCount = 0;

            // Process users in batches
            const batchSize = 3; // Smaller batch for weekly updates as they're more intensive
            for (let i = 0; i < usersNeedingUpdate.length; i += batchSize) {
                const batch = usersNeedingUpdate.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async (userSchedule) => {
                    const userId = userSchedule.userId._id;
                    
                    // Get user's seller accounts
                    const seller = await Seller.findOne({ User: userId });
                    if (!seller || !seller.sellerAccount) {
                        logger.warn(`No seller accounts found for user ${userId}`);
                        return;
                    }

                    // Update data for each seller account
                    for (const account of seller.sellerAccount) {
                        if (account.country && account.region) {
                            const success = await this.updateWeeklyDataForUser(userId, account.country, account.region);
                            if (success) {
                                successCount++;
                            } else {
                                failureCount++;
                            }
                        }
                    }
                }));

                // Add longer delay between batches for weekly updates
                if (i + batchSize < usersNeedingUpdate.length) {
                    await this.delay(5000); // 5 second delay
                }
            }

            logger.info(`Weekly updates completed: ${successCount} successful, ${failureCount} failed`);
            return { successCount, failureCount };

        } catch (error) {
            logger.error('Error in weekly updates process:', error);
            return { successCount: 0, failureCount: 0 };
        }
    }

    /**
     * Manually trigger update for a specific user (for testing or immediate needs)
     */
    static async manualUpdateUser(userId, country, region, updateType = 'both') {
        try {
            logger.info(`Manual update triggered for user ${userId}, ${country}-${region}, type: ${updateType}`);

            let results = {};

            if (updateType === 'daily' || updateType === 'both') {
                results.daily = await this.updateDailyDataForUser(userId, country, region);
            }

            if (updateType === 'weekly' || updateType === 'both') {
                results.weekly = await this.updateWeeklyDataForUser(userId, country, region);
            }

            return results;
        } catch (error) {
            logger.error(`Error in manual update for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Clear old cache entries (cleanup job)
     */
    static async cleanupOldCache() {
        try {
            const redisClient = getRedisClient();
            
            // Get all analyse_data keys
            const keys = await redisClient.keys('analyse_data:*');
            
            // Remove keys that are older than 25 hours to ensure fresh data
            let deletedCount = 0;
            const twentyFiveHoursAgo = Date.now() - (25 * 60 * 60 * 1000);
            
            for (const key of keys) {
                const ttl = await redisClient.ttl(key);
                // If TTL is very low or expired, delete it
                if (ttl < 1800) { // Less than 30 minutes remaining
                    await redisClient.del(key);
                    deletedCount++;
                }
            }

            logger.info(`Cleaned up ${deletedCount} old cache entries`);
            return deletedCount;
        } catch (error) {
            logger.error('Error cleaning up old cache:', error);
            return 0;
        }
    }

    /**
     * Get statistics about background job performance
     */
    static async getUpdateStats() {
        try {
            const UserUpdateSchedule = require('../../models/UserUpdateScheduleModel.js');
            const totalUsers = await UserUpdateSchedule.countDocuments();
            const usersNeedingDaily = await UserSchedulingService.getUsersNeedingDailyUpdate();
            const usersNeedingWeekly = await UserSchedulingService.getUsersNeedingWeeklyUpdate();
            
            const redisClient = getRedisClient();
            const cacheKeys = await redisClient.keys('analyse_data:*');

            return {
                totalUsers,
                usersNeedingDailyUpdate: usersNeedingDaily.length,
                usersNeedingWeeklyUpdate: usersNeedingWeekly.length,
                totalCacheEntries: cacheKeys.length,
                currentHour: new Date().getUTCHours(),  // Use UTC for consistency
                currentDay: new Date().getUTCDay()      // Use UTC for consistency
            };
        } catch (error) {
            logger.error('Error getting update stats:', error);
            return {};
        }
    }

    /**
     * Utility function to add delays
     */
    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { DataUpdateService }; 
const { Analyse } = require('../../controllers/AnalysingController.js');
const { getRedisClient } = require('../../config/redisConn.js');
const { UserSchedulingService } = require('./UserSchedulingService.js');
const Seller = require('../../models/sellerCentralModel.js');
const logger = require('../../utils/Logger.js');

// Import all the data fetching controllers that need to be updated
const SpApiDataController = require('../../controllers/SpApiDataController.js');

// Import LoggingHelper for database logging
const LoggingHelper = require('../../utils/LoggingHelper.js');

class DataUpdateService {

    /**
     * Update daily data (all comprehensive data including profitability, sponsored ads, and all API data) for a specific user
     */
    static async updateDailyDataForUser(userId, country, region) {
        // Initialize logging session for database tracking
        let loggingHelper = null;
        try {
            loggingHelper = new LoggingHelper(userId, region, country);
            await loggingHelper.initSession();
            loggingHelper.logFunctionStart('updateDailyDataForUser', {
                userId: userId,
                region: region,
                country: country,
                requestOrigin: 'background_job'
            });
        } catch (loggingError) {
            logger.warn('Failed to initialize logging session for background job', { 
                error: loggingError.message, 
                userId,
                region,
                country
            });
            // Continue without logging rather than failing the entire request
        }

        try {
            logger.info(`Starting daily data update for user ${userId}, ${country}-${region}`);

            // Create mock request object for SpApiDataController
            const mockReq = {
                userId: userId,
                country: country,
                region: region
            };

            // Create mock response object
            let spApiResult = null;
            const mockRes = {
                status: (code) => ({
                    json: (data) => {
                        spApiResult = { statusCode: code, data };
                        return mockRes;
                    }
                })
            };

            try {
                // Log the start of main SpApiDataController call
                if (loggingHelper) {
                    loggingHelper.logFunctionStart('SpApiDataController.getSpApiData', {
                        userId: userId,
                        region: region,
                        country: country
                    });
                }

                // Fetch fresh data from all APIs including:
                // - Merchant listings data (GET_MERCHANT_LISTINGS_ALL_DATA)
                // - V1/V2 seller performance reports
                // - Financial data (listFinancialEventsMethod)
                // - Competitive pricing data (getCompetitivePricing)
                // - Restock inventory recommendations
                // - Product reviews data
                // - Sponsored ads data (getPPCSpendsBySKU)
                // - Campaign and ad group keywords
                // - Negative keywords processing
                // - Search keywords data
                // - FBA inventory planning data
                // - Stranded inventory data
                // - Inbound non-compliance data
                // - Weekly sales data
                // - Shipment data
                // - Brand data
                // - Amazon fees calculation
                // - Listing items with generic keyword processing
                // - All other comprehensive API data
                logger.info(`Fetching fresh comprehensive API data for user ${userId}, ${country}-${region}`);
                await SpApiDataController.getSpApiData(mockReq, mockRes);
                
                if (spApiResult && spApiResult.statusCode === 200) {
                    logger.info(`Fresh comprehensive API data fetched successfully for user ${userId}, ${country}-${region}`);
                    if (loggingHelper) {
                        loggingHelper.logFunctionSuccess('SpApiDataController.getSpApiData', spApiResult.data, {
                            recordsProcessed: 1,
                            recordsSuccessful: 1
                        });
                    }
                } else {
                    logger.warn(`API data fetch returned non-200 status for user ${userId}, ${country}-${region}`);
                    if (loggingHelper) {
                        loggingHelper.logFunctionError('SpApiDataController.getSpApiData', new Error(`Non-200 status: ${spApiResult?.statusCode}`));
                    }
                }
            } catch (apiError) {
                logger.error(`Error fetching fresh API data for user ${userId}, ${country}-${region}:`, apiError);
                if (loggingHelper) {
                    loggingHelper.logFunctionError('SpApiDataController.getSpApiData', apiError);
                }
                // Continue with analysis using existing data if API fetch fails
            }

            // Run the analysis to get processed data (this will use the fresh comprehensive data we just fetched)
            if (loggingHelper) {
                loggingHelper.logFunctionStart('Analyse', {
                    userId: userId,
                    region: region,
                    country: country
                });
            }
            
            const analysisResult = await Analyse(userId, country, region);
            
            if (analysisResult.status !== 200) {
                logger.error(`Analysis failed for user ${userId}: ${analysisResult.message}`);
                if (loggingHelper) {
                    loggingHelper.logFunctionError('Analyse', new Error(analysisResult.message));
                }
                return false;
            }

            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('Analyse', analysisResult.message, {
                    recordsProcessed: 1,
                    recordsSuccessful: 1
                });
            }

            // Store the processed data in Redis cache
            if (loggingHelper) {
                loggingHelper.logFunctionStart('updateRedisCache', {
                    userId: userId,
                    region: region,
                    country: country
                });
            }
            
            await this.updateRedisCache(userId, country, region, analysisResult.message);

            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('updateRedisCache', null, {
                    recordsProcessed: 1,
                    recordsSuccessful: 1
                });
            }

            // Mark the update as complete
            if (loggingHelper) {
                loggingHelper.logFunctionStart('markDailyUpdateComplete', {
                    userId: userId,
                    region: region,
                    country: country
                });
            }
            
            await UserSchedulingService.markDailyUpdateComplete(userId, country, region);

            if (loggingHelper) {
                loggingHelper.logFunctionSuccess('markDailyUpdateComplete', null, {
                    recordsProcessed: 1,
                    recordsSuccessful: 1
                });
            }

            logger.info(`Daily comprehensive data update completed for user ${userId}, ${country}-${region}`);
            
            // End the logging session successfully
            if (loggingHelper) {
                loggingHelper.endSession('completed');
            }
            
            return true;

        } catch (error) {
            logger.error(`Error updating daily data for user ${userId}, ${country}-${region}:`, error);
            
            // Log the error and end session
            if (loggingHelper) {
                loggingHelper.logFunctionError('updateDailyDataForUser', error);
                loggingHelper.endSession('failed');
            }
            
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
     * Process daily updates for all eligible users (now includes all comprehensive data)
     */
    static async processDailyUpdates() {
        try {
            logger.info('Starting daily comprehensive updates process');
            
            const usersNeedingUpdate = await UserSchedulingService.getUsersNeedingDailyUpdate();
            logger.info(`Found ${usersNeedingUpdate.length} users needing daily comprehensive updates`);

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

                    // Update comprehensive data for each seller account
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

            logger.info(`Daily comprehensive updates completed: ${successCount} successful, ${failureCount} failed`);
            return { successCount, failureCount };

        } catch (error) {
            logger.error('Error in daily comprehensive updates process:', error);
            return { successCount: 0, failureCount: 0 };
        }
    }

    /**
     * Manually trigger update for a specific user (now only daily comprehensive updates)
     */
    static async manualUpdateUser(userId, country, region) {
        try {
            logger.info(`Manual comprehensive update triggered for user ${userId}, ${country}-${region}`);

            const result = await this.updateDailyDataForUser(userId, country, region);
            return { success: result };
            
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
            
            const redisClient = getRedisClient();
            const cacheKeys = await redisClient.keys('analyse_data:*');

            return {
                totalUsers,
                usersNeedingDailyUpdate: usersNeedingDaily.length,
                totalCacheEntries: cacheKeys.length,
                currentHour: new Date().getUTCHours(),  // Use UTC for consistency
                systemType: 'daily_comprehensive_updates'
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
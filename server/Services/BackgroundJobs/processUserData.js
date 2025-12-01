/**
 * processUserData.js
 * 
 * Core business logic wrapper for processing a single user's data.
 * This function processes ALL seller accounts (country/region combinations) for a given user.
 * 
 * This is the ONLY function that workers should call - it encapsulates all business logic.
 * 
 * @param {string} userId - MongoDB ObjectId of the user
 * @returns {Object} Result object with success status and details
 */

const { Integration } = require('../main/Integration.js');
const { AnalyseService } = require('../main/Analyse.js');
const { getRedisClient } = require('../../config/redisConn.js');
const { UserSchedulingService } = require('./UserSchedulingService.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const logger = require('../../utils/Logger.js');
const LoggingHelper = require('../../utils/LoggingHelper.js');

/**
 * Process all seller accounts for a single user
 * 
 * This function:
 * 1. Fetches user's seller accounts
 * 2. For each account (country/region), calls Integration.getSpApiData()
 * 3. Then calls AnalyseService.Analyse()
 * 4. Updates Redis cache
 * 5. Marks update as complete
 * 
 * @param {string} userId - User ID to process
 * @returns {Promise<Object>} Result object
 */
async function processUserData(userId) {
    const startTime = Date.now();
    const results = {
        userId,
        success: false,
        accountsProcessed: 0,
        accountsSucceeded: 0,
        accountsFailed: 0,
        errors: [],
        duration: 0
    };

    try {
        logger.info(`[processUserData] Starting data processing for user ${userId}`);

        // Get user's seller accounts
        const seller = await Seller.findOne({ User: userId });
        
        if (!seller || !seller.sellerAccount || seller.sellerAccount.length === 0) {
            logger.warn(`[processUserData] No seller accounts found for user ${userId}`);
            results.success = true; // Not an error, just no accounts
            results.duration = Date.now() - startTime;
            return results;
        }

        // Process each seller account (country/region combination)
        for (const account of seller.sellerAccount) {
            if (!account.country || !account.region) {
                logger.warn(`[processUserData] Skipping account with missing country/region for user ${userId}`);
                continue;
            }

            const { country, region } = account;
            results.accountsProcessed++;

            try {
                logger.info(`[processUserData] Processing account ${country}-${region} for user ${userId}`);

                // Initialize logging session for this account
                let loggingHelper = null;
                try {
                    loggingHelper = new LoggingHelper(userId, region, country);
                    await loggingHelper.initSession();
                    loggingHelper.logFunctionStart('processUserData', {
                        userId,
                        region,
                        country,
                        requestOrigin: 'queue_worker'
                    });
                } catch (loggingError) {
                    logger.warn(`[processUserData] Failed to initialize logging session for ${userId}-${country}-${region}`, {
                        error: loggingError.message
                    });
                }

                // Step 1: Fetch fresh data from all APIs using Integration service
                try {
                    if (loggingHelper) {
                        loggingHelper.logFunctionStart('Integration.getSpApiData', {
                            userId,
                            region,
                            country
                        });
                    }

                    logger.info(`[processUserData] Fetching API data for user ${userId}, ${country}-${region}`);
                    const integrationResult = await Integration.getSpApiData(userId, region, country);

                    if (integrationResult.success) {
                        logger.info(`[processUserData] API data fetched successfully for user ${userId}, ${country}-${region}`);
                        if (loggingHelper) {
                            loggingHelper.logFunctionSuccess('Integration.getSpApiData', integrationResult.data, {
                                recordsProcessed: 1,
                                recordsSuccessful: 1
                            });
                        }
                    } else {
                        logger.warn(`[processUserData] API data fetch failed for user ${userId}, ${country}-${region}. Error: ${integrationResult.error}`);
                        if (loggingHelper) {
                            loggingHelper.logFunctionError('Integration.getSpApiData', new Error(integrationResult.error || 'Unknown error'));
                        }
                        // Continue with analysis using existing data if API fetch fails
                    }
                } catch (apiError) {
                    logger.error(`[processUserData] Error fetching API data for user ${userId}, ${country}-${region}:`, apiError);
                    if (loggingHelper) {
                        loggingHelper.logFunctionError('Integration.getSpApiData', apiError);
                    }
                    // Continue with analysis using existing data if API fetch fails
                }

                // Step 2: Run analysis to get processed data
                if (loggingHelper) {
                    loggingHelper.logFunctionStart('Analyse', {
                        userId,
                        region,
                        country
                    });
                }

                const analysisResult = await AnalyseService.Analyse(userId, country, region);

                if (analysisResult.status !== 200) {
                    throw new Error(`Analysis failed: ${analysisResult.message}`);
                }

                if (loggingHelper) {
                    loggingHelper.logFunctionSuccess('Analyse', analysisResult.message, {
                        recordsProcessed: 1,
                        recordsSuccessful: 1
                    });
                }

                // Step 3: Update Redis cache
                if (loggingHelper) {
                    loggingHelper.logFunctionStart('updateRedisCache', {
                        userId,
                        region,
                        country
                    });
                }

                await updateRedisCache(userId, country, region, analysisResult.message);

                if (loggingHelper) {
                    loggingHelper.logFunctionSuccess('updateRedisCache', null, {
                        recordsProcessed: 1,
                        recordsSuccessful: 1
                    });
                }

                // Step 4: Mark update as complete
                if (loggingHelper) {
                    loggingHelper.logFunctionStart('markDailyUpdateComplete', {
                        userId,
                        region,
                        country
                    });
                }

                await UserSchedulingService.markDailyUpdateComplete(userId, country, region);

                if (loggingHelper) {
                    loggingHelper.logFunctionSuccess('markDailyUpdateComplete', null, {
                        recordsProcessed: 1,
                        recordsSuccessful: 1
                    });
                    loggingHelper.endSession('completed');
                }

                results.accountsSucceeded++;
                logger.info(`[processUserData] Successfully processed account ${country}-${region} for user ${userId}`);

            } catch (accountError) {
                results.accountsFailed++;
                const errorMessage = `Failed to process account ${country}-${region}: ${accountError.message}`;
                results.errors.push({
                    account: `${country}-${region}`,
                    error: accountError.message,
                    stack: accountError.stack
                });
                logger.error(`[processUserData] ${errorMessage}`, accountError);

                // End logging session with error if it exists
                if (loggingHelper) {
                    loggingHelper.logFunctionError('processUserData', accountError);
                    loggingHelper.endSession('failed');
                }
            }
        }

        // Determine overall success
        results.success = results.accountsFailed === 0 && results.accountsProcessed > 0;
        results.duration = Date.now() - startTime;

        if (results.success) {
            logger.info(`[processUserData] Successfully completed processing for user ${userId}. Processed ${results.accountsSucceeded} account(s) in ${results.duration}ms`);
        } else {
            logger.warn(`[processUserData] Completed processing for user ${userId} with errors. ${results.accountsSucceeded} succeeded, ${results.accountsFailed} failed in ${results.duration}ms`);
        }

        return results;

    } catch (error) {
        results.success = false;
        results.duration = Date.now() - startTime;
        results.errors.push({
            account: 'general',
            error: error.message,
            stack: error.stack
        });

        logger.error(`[processUserData] Fatal error processing user ${userId}:`, error);
        throw error; // Re-throw to trigger job retry
    }
}

/**
 * Update Redis cache with processed analysis data
 * @private
 */
async function updateRedisCache(userId, country, region, analysisData, adminId = null) {
    try {
        const redisClient = getRedisClient();
        
        // Create the same cache key format as used in the middleware
        const cacheKey = `analyse_data:${userId}:${country}:${region}:${adminId || 'null'}`;
        
        // Cache the data for 1 hour (same as current middleware)
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(analysisData));
        
        logger.info(`[processUserData] Updated Redis cache for key: ${cacheKey}`);
        return true;

    } catch (error) {
        logger.error(`[processUserData] Error updating Redis cache for user ${userId}, ${country}-${region}:`, error);
        return false;
    }
}

module.exports = { processUserData };


/**
 * weeklyHistoryWorker.js
 * 
 * Weekly Account History Worker
 * 
 * This worker runs every Sunday at 11:59 PM UTC to record weekly account history
 * snapshots for all users. It runs after all scheduled jobs have completed
 * to ensure we have complete data for the week.
 * 
 * Purpose:
 * - Record weekly account history snapshots
 * - Ensures history is recorded with complete data (after all Sunday jobs complete)
 * - Expiry dates are set to next Sunday, so the worker naturally adds new entries each week
 * 
 * Schedule: Every Sunday at 23:59 UTC (11:59 PM)
 * This timing ensures:
 * - All scheduled integration jobs have completed
 * - We have the most up-to-date data for the week
 * - The previous week's expiry has passed, so new entries are added
 * 
 * Usage:
 *   node server/Services/BackgroundJobs/weeklyHistoryWorker.js
 *   OR via PM2:
 *   pm2 start server/Services/BackgroundJobs/weeklyHistoryWorker.js --name weekly-history
 */

require('dotenv').config();

const cron = require('node-cron');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { AnalyseService } = require('../main/Analyse.js');
const { analyseData } = require('../Calculations/DashboardCalculation.js');
const { addAccountHistory } = require('../History/addAccountHistory.js');
const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');

// Configuration
const BATCH_SIZE = 10; // Process 10 users concurrently
const DELAY_BETWEEN_BATCHES_MS = 2000; // 2 second delay between batches

/**
 * Process a single user's account history
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Result of processing
 */
async function processUserHistory(userId, country, region) {
    try {
        logger.info(`[WeeklyHistory] Processing history for user ${userId}, country: ${country}, region: ${region}`);

        // Get analysis data
        const analyseResult = await AnalyseService.Analyse(userId, country, region);

        if (!analyseResult || analyseResult.status !== 200) {
            logger.error(`[WeeklyHistory] Failed to get analyse data for user ${userId}`, {
                status: analyseResult?.status,
                message: analyseResult?.message
            });
            return { success: false, error: 'Analysis failed' };
        }

        // Calculate dashboard data
        const calculationResult = await analyseData(analyseResult.message, userId);

        if (!calculationResult?.dashboardData) {
            logger.error(`[WeeklyHistory] Failed to calculate dashboard data for user ${userId}`);
            return { success: false, error: 'Calculation failed' };
        }

        const dashboardData = calculationResult.dashboardData;

        // Extract history data
        const rankingErrors = dashboardData.TotalRankingerrors || 0;
        const conversionErrors = dashboardData.totalErrorInConversion || 0;
        const accountErrors = dashboardData.totalErrorInAccount || 0;
        const profitabilityErrors = dashboardData.totalProfitabilityErrors || 0;
        const sponsoredAdsErrors = dashboardData.totalSponsoredAdsErrors || 0;
        const inventoryErrors = dashboardData.totalInventoryErrors || 0;

        const totalIssues = rankingErrors + conversionErrors + accountErrors + profitabilityErrors + sponsoredAdsErrors + inventoryErrors;
        const healthScore = analyseResult.message.AccountData?.getAccountHealthPercentge?.Percentage || 0;
        const numberOfProductsWithIssues = dashboardData.productWiseError?.length || 0;
        const totalProducts = dashboardData.TotalProduct?.length || 0;

        // Add history entry (expiry is set to next Sunday, so this will add new entry)
        await addAccountHistory(
            userId,
            country,
            region,
            healthScore,
            totalProducts,
            numberOfProductsWithIssues,
            totalIssues
        );

        logger.info(`[WeeklyHistory] Successfully recorded history for user ${userId}`, {
            country,
            region,
            healthScore,
            totalProducts,
            totalIssues
        });

        return { success: true };

    } catch (error) {
        logger.error(`[WeeklyHistory] Error processing user ${userId}:`, {
            error: error.message,
            stack: error.stack
        });
        return { success: false, error: error.message };
    }
}

/**
 * Process all users in batches
 * 
 * @returns {Object} Summary of processing results
 */
async function processAllUsersHistory() {
    const startTime = Date.now();
    logger.info('[WeeklyHistory] Starting weekly history recording for all users');

    try {
        await dbConnect();

        // Get all sellers with their accounts
        const sellers = await Seller.find({}).select('User sellerAccount');

        if (!sellers || sellers.length === 0) {
            logger.warn('[WeeklyHistory] No sellers found');
            return { success: true, processed: 0, failed: 0, duration: 0 };
        }

        logger.info(`[WeeklyHistory] Found ${sellers.length} sellers to process`);

        // Build list of all user-country-region combinations
        const processingList = [];
        for (const seller of sellers) {
            if (!seller.User || !seller.sellerAccount || !Array.isArray(seller.sellerAccount)) {
                continue;
            }

            for (const account of seller.sellerAccount) {
                if (!account.country || !account.region) {
                    continue;
                }

                // Only process accounts with refresh tokens (connected accounts)
                if (!account.spiRefreshToken && !account.adsRefreshToken) {
                    continue;
                }

                processingList.push({
                    userId: seller.User.toString(),
                    country: account.country,
                    region: account.region
                });
            }
        }

        logger.info(`[WeeklyHistory] Total accounts to process: ${processingList.length}`);

        let processed = 0;
        let failed = 0;

        // Process in batches
        for (let i = 0; i < processingList.length; i += BATCH_SIZE) {
            const batch = processingList.slice(i, i + BATCH_SIZE);
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(processingList.length / BATCH_SIZE);

            logger.info(`[WeeklyHistory] Processing batch ${batchNumber}/${totalBatches} (${batch.length} accounts)`);

            // Process batch concurrently
            const results = await Promise.allSettled(
                batch.map(item => processUserHistory(item.userId, item.country, item.region))
            );

            // Count results
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value?.success) {
                    processed++;
                } else {
                    failed++;
                }
            }

            // Delay between batches to avoid overwhelming the system
            if (i + BATCH_SIZE < processingList.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
            }
        }

        const duration = Math.round((Date.now() - startTime) / 1000);

        logger.info(`[WeeklyHistory] Weekly history recording completed`, {
            totalAccounts: processingList.length,
            processed,
            failed,
            durationSeconds: duration
        });

        return {
            success: true,
            totalAccounts: processingList.length,
            processed,
            failed,
            durationSeconds: duration
        };

    } catch (error) {
        logger.error('[WeeklyHistory] Error in processAllUsersHistory:', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * Setup the weekly cron job
 * Runs every Sunday at 23:59 UTC
 */
function setupWeeklyHistoryCron() {
    // Cron expression: 59 23 * * 0
    // Minute: 59
    // Hour: 23 (11 PM)
    // Day of month: * (every)
    // Month: * (every)
    // Day of week: 0 (Sunday)
    const cronJob = cron.schedule('59 23 * * 0', async () => {
        try {
            logger.info('[WeeklyHistory] Weekly history cron job triggered');
            const result = await processAllUsersHistory();
            logger.info(`[WeeklyHistory] Weekly cron completed: ${result.processed} accounts processed, ${result.failed} failed`);
        } catch (error) {
            logger.error('[WeeklyHistory] Error in weekly cron job:', error);
        }
    }, {
        scheduled: false,
        timezone: process.env.TIMEZONE || "UTC"
    });

    cronJob.start();
    logger.info('[WeeklyHistory] Weekly history cron job scheduled (runs every Sunday at 23:59 UTC)');

    return cronJob;
}

/**
 * Manual trigger for testing or one-off runs
 */
async function manualRun() {
    try {
        logger.info('[WeeklyHistory] Manual run triggered');
        const result = await processAllUsersHistory();
        return result;
    } catch (error) {
        logger.error('[WeeklyHistory] Manual run failed:', error);
        throw error;
    }
}

// If running as standalone script, start the cron job
if (require.main === module) {
    (async () => {
        try {
            logger.info('[WeeklyHistory] Starting weekly history worker...');
            
            // Connect to database
            await dbConnect();
            logger.info('[WeeklyHistory] Connected to database');

            // Setup cron job
            const cronJob = setupWeeklyHistoryCron();

            logger.info('[WeeklyHistory] Weekly history worker is running');
            logger.info('[WeeklyHistory] Next run: Sunday at 23:59 UTC');

            // Graceful shutdown with timeout
            const SHUTDOWN_GRACE_MS = 30 * 1000; // 30 seconds for cron-based worker
            let isShuttingDown = false;

            const gracefulShutdown = (signal) => {
                if (isShuttingDown) {
                    logger.warn(`[WeeklyHistory] Already shutting down, ignoring ${signal}`);
                    return;
                }
                isShuttingDown = true;

                logger.info(`[WeeklyHistory] Received ${signal}, shutting down gracefully (max ${SHUTDOWN_GRACE_MS / 1000}s)...`);

                // Stop the cron job from scheduling new runs
                if (cronJob) {
                    cronJob.stop();
                    logger.info('[WeeklyHistory] Cron job stopped');
                }

                let hasExited = false;
                const forceExit = () => {
                    if (!hasExited) {
                        hasExited = true;
                        logger.warn('[WeeklyHistory] Shutdown timeout reached - forcing exit');
                        process.exit(1);
                    }
                };

                // Set timeout for force exit
                const shutdownTimeout = setTimeout(forceExit, SHUTDOWN_GRACE_MS);

                // Give a moment for any in-flight operations to complete
                setTimeout(() => {
                    clearTimeout(shutdownTimeout);
                    if (!hasExited) {
                        hasExited = true;
                        logger.info('[WeeklyHistory] Worker shut down gracefully');
                        process.exit(0);
                    }
                }, 1000);
            };

            process.on('SIGINT', () => gracefulShutdown('SIGINT'));
            process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

        } catch (error) {
            logger.error('[WeeklyHistory] Failed to start weekly history worker:', error);
            process.exit(1);
        }
    })();
}

module.exports = {
    setupWeeklyHistoryCron,
    processAllUsersHistory,
    processUserHistory,
    manualRun
};


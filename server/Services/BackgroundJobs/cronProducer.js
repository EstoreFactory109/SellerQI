/**
 * cronProducer.js
 * 
 * CRON Job Producer - Enqueues users for processing
 * 
 * This replaces the old hourly batch processing system.
 * 
 * IMPORTANT: This CRON job ONLY enqueues user IDs - it NEVER processes them.
 * Processing is done by separate worker processes.
 * 
 * Migration from old system:
 * - Old: processDailyUpdates() processed users directly
 * - New: enqueueUsersForDailyUpdate() only enqueues user IDs
 * 
 * This runs every hour and enqueues users whose scheduled hour matches
 * the current hour and haven't been updated in 24 hours.
 */

const cron = require('node-cron');
const { enqueueScheduledAccountJob, getQueueStats } = require('./producer.js');
const { UserSchedulingService } = require('./UserSchedulingService.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Enqueue per-account phased scheduled jobs for users that need daily updates.
 *
 * New architecture: one INIT phase job per seller account (country/region).
 * Each INIT job chains through phases independently, so different accounts
 * for the same user can run concurrently and a crash only affects one account.
 *
 * @returns {Promise<Object>} Summary of enqueued jobs
 */
async function enqueueUsersForDailyUpdate() {
    try {
        logger.info('[CronProducer] Starting daily update enqueue process (phased, per-account)');

        const usersNeedingUpdate = await UserSchedulingService.getUsersNeedingDailyUpdate();
        logger.info(`[CronProducer] Found ${usersNeedingUpdate.length} users needing daily updates`);

        if (usersNeedingUpdate.length === 0) {
            logger.info('[CronProducer] No users need updates at this time');
            return { success: true, usersFound: 0, accountsEnqueued: 0, accountsSkipped: 0, accountsFailed: 0 };
        }

        let accountsEnqueued = 0;
        let accountsSkipped = 0;
        let accountsFailed = 0;
        let accountsCapped = 0;
        let accountsAlreadyDone = 0;

        for (const schedule of usersNeedingUpdate) {
            const userId = schedule.userId?._id?.toString();
            if (!userId) continue;

            try {
                const seller = await Seller.findOne({ User: userId });
                if (!seller || !seller.sellerAccount || seller.sellerAccount.length === 0) {
                    logger.warn(`[CronProducer] No seller accounts found for user ${userId}`);
                    continue;
                }

                for (const account of seller.sellerAccount) {
                    if (!account.country || !account.region) continue;

                    // Per-account gating (A.4): skip if already succeeded today,
                    // or if the per-account retry cap is reached. Prevents dead-
                    // token accounts from burning API quota all day. The user-
                    // level `getUsersNeedingDailyUpdate` filter only checks the
                    // user-level lastDailyUpdate, so we re-check at the account
                    // level here.
                    try {
                        const gate = await UserSchedulingService.shouldAttemptAccountUpdate(
                            userId, account.country, account.region
                        );
                        if (!gate.eligible) {
                            if (gate.reason === 'done') accountsAlreadyDone++;
                            else if (gate.reason === 'capped') {
                                accountsCapped++;
                                logger.warn(
                                    `[CronProducer] Skipping ${userId} ${account.country}-${account.region} — retry cap reached (${gate.attempts} attempts today)`
                                );
                            } else {
                                accountsSkipped++;
                            }
                            continue;
                        }
                    } catch (gateError) {
                        // Gate is best-effort. If the gate check fails, fall back
                        // to the previous behaviour (always attempt) rather than
                        // accidentally pausing a healthy account.
                        logger.warn(
                            `[CronProducer] Eligibility gate failed for ${userId} ${account.country}-${account.region}, attempting anyway: ${gateError.message}`
                        );
                    }

                    try {
                        const result = await enqueueScheduledAccountJob(userId, account.country, account.region);
                        if (result.success) {
                            accountsEnqueued++;
                            // Count this attempt so the cap applies. Best-effort —
                            // failures here are logged but don't unwind the enqueue.
                            try {
                                await UserSchedulingService.recordAccountAttempt(
                                    userId, account.country, account.region
                                );
                            } catch (counterError) {
                                logger.warn(
                                    `[CronProducer] Failed to record attempt for ${userId} ${account.country}-${account.region}: ${counterError.message}`
                                );
                            }
                        } else {
                            accountsSkipped++;
                        }
                    } catch (accountError) {
                        accountsFailed++;
                        logger.error(`[CronProducer] Failed to enqueue ${userId} ${account.country}-${account.region}:`, accountError.message);
                    }
                }
            } catch (userError) {
                logger.error(`[CronProducer] Error processing user ${userId}:`, userError.message);
            }
        }

        const queueStats = await getQueueStats();

        logger.info('[CronProducer] Daily update enqueue completed (phased)', {
            usersFound: usersNeedingUpdate.length,
            accountsEnqueued,
            accountsSkipped,
            accountsFailed,
            accountsCapped,
            accountsAlreadyDone,
            queueStats
        });

        return {
            success: true,
            usersFound: usersNeedingUpdate.length,
            accountsEnqueued,
            accountsSkipped,
            accountsFailed,
            accountsCapped,
            accountsAlreadyDone,
            queueStats
        };

    } catch (error) {
        logger.error('[CronProducer] Error in daily update enqueue process:', error);
        throw error;
    }
}

/**
 * Setup the hourly CRON job
 * 
 * This replaces the old setupDailyUpdateJob() in JobScheduler.js
 * 
 * @param {Object} options - Cron options
 * @param {boolean} options.enabled - Whether to enable the cron (default: true)
 * @returns {Object} Cron job instance
 */
function setupDailyUpdateCron(options = {}) {
    const enabled = options.enabled !== false;

    if (!enabled) {
        logger.warn('[CronProducer] Daily update cron is disabled');
        return null;
    }

    // Run every hour at minute 0 (e.g., 1:00, 2:00, 3:00...)
    // Same schedule as the old system
    const cronJob = cron.schedule('0 * * * *', async () => {
        try {
            logger.info('[CronProducer] Running hourly enqueue job');
            const result = await enqueueUsersForDailyUpdate();
            logger.info(`[CronProducer] Hourly enqueue completed: ${result.accountsEnqueued} accounts enqueued`);
        } catch (error) {
            logger.error('[CronProducer] Error in hourly enqueue job:', error);
        }
    }, {
        scheduled: false, // Don't start immediately
        timezone: process.env.TIMEZONE || "UTC"
    });

    cronJob.start();
    logger.info('[CronProducer] Daily update cron job scheduled (runs every hour, enqueues users only)');

    return cronJob;
}

/**
 * Manually trigger enqueue (for testing or manual runs)
 */
async function manualEnqueue() {
    try {
        logger.info('[CronProducer] Manual enqueue triggered');
        const result = await enqueueUsersForDailyUpdate();
        return result;
    } catch (error) {
        logger.error('[CronProducer] Manual enqueue failed:', error);
        throw error;
    }
}

module.exports = {
    setupDailyUpdateCron,
    enqueueUsersForDailyUpdate,
    manualEnqueue
};


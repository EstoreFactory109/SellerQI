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
const { enqueueUser, enqueueUsers, getQueueStats } = require('./producer.js');
const { UserSchedulingService } = require('./UserSchedulingService.js');
const logger = require('../../utils/Logger.js');

/**
 * Enqueue users that need daily updates
 * 
 * This function:
 * 1. Gets users whose scheduled hour matches current hour
 * 2. Filters users who haven't been updated today (ensures daily processing since different services run on different days)
 * 3. Enqueues each user ID (one job per user)
 * 4. Returns summary statistics
 * 
 * @returns {Promise<Object>} Summary of enqueued jobs
 */
async function enqueueUsersForDailyUpdate() {
    try {
        logger.info('[CronProducer] Starting daily update enqueue process');

        // Get users that need updates (same logic as before)
        const usersNeedingUpdate = await UserSchedulingService.getUsersNeedingDailyUpdate();
        logger.info(`[CronProducer] Found ${usersNeedingUpdate.length} users needing daily updates`);

        if (usersNeedingUpdate.length === 0) {
            logger.info('[CronProducer] No users need updates at this time');
            return {
                success: true,
                usersFound: 0,
                enqueued: 0,
                skipped: 0,
                failed: 0
            };
        }

        // Extract user IDs
        const userIds = usersNeedingUpdate
            .map(schedule => schedule.userId?._id?.toString())
            .filter(id => id); // Remove null/undefined

        if (userIds.length === 0) {
            logger.warn('[CronProducer] No valid user IDs found');
            return {
                success: true,
                usersFound: usersNeedingUpdate.length,
                enqueued: 0,
                skipped: 0,
                failed: 0
            };
        }

        logger.info(`[CronProducer] Enqueuing ${userIds.length} users for processing`);

        // Enqueue all users (producer handles duplicate detection)
        const enqueueResult = await enqueueUsers(userIds, {
            batchSize: 50, // Process in batches of 50
            enqueuedBy: 'cron-daily-update'
        });

        // Get queue statistics
        const queueStats = await getQueueStats();

        logger.info(`[CronProducer] Daily update enqueue completed:`, {
            usersFound: usersNeedingUpdate.length,
            enqueued: enqueueResult.enqueued,
            skipped: enqueueResult.skipped,
            failed: enqueueResult.failed,
            queueStats
        });

        return {
            success: true,
            usersFound: usersNeedingUpdate.length,
            ...enqueueResult,
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
            logger.info(`[CronProducer] Hourly enqueue completed: ${result.enqueued} users enqueued`);
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


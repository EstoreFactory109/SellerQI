/**
 * producer.js
 * 
 * Queue Producer - Enqueues user IDs for processing
 * 
 * This module handles adding jobs to the queue. It should ONLY enqueue jobs,
 * never process them. Processing is done by workers.
 * 
 * Usage:
 * - Cron jobs call enqueueUser() to add users to the queue
 * - Manual triggers can also use enqueueUser()
 * - Supports bulk enqueuing for migration scenarios
 */

const { getQueue } = require('./queue.js');
const logger = require('../../utils/Logger.js');
const scheduledPhasesModule = require('./scheduledPhases.js');
const { PHASES } = scheduledPhasesModule;

const MAX_SCHEDULED_JOB_AGE = 8 * 60 * 60 * 1000; // 8 hours - safety net for orphaned phase jobs

/**
 * Enqueue a single user for data processing
 * 
 * @param {string} userId - MongoDB ObjectId of the user to process
 * @param {Object} options - Optional job options
 * @param {number} options.priority - Job priority (higher = more important, default: 0)
 * @param {number} options.delay - Delay before processing (milliseconds, default: 0)
 * @param {string} options.jobId - Custom job ID (default: auto-generated)
 * @returns {Promise<Object>} Job object with id and other details
 */
async function enqueueUser(userId, options = {}) {
    try {
        const queue = getQueue();
        
        // Validate userId
        if (!userId || typeof userId !== 'string') {
            throw new Error('Invalid userId: must be a non-empty string');
        }

        // Check if user already has a pending or active job
        const existingJobs = await queue.getJobs(['waiting', 'active'], 0, -1);
        const duplicateJob = existingJobs.find(job => job.data.userId === userId.toString());

        if (duplicateJob) {
            logger.warn(`[Producer] User ${userId} already has a job in queue (jobId: ${duplicateJob.id}, state: ${duplicateJob.state})`);
            return {
                success: false,
                message: 'User already has a job in queue',
                jobId: duplicateJob.id,
                existingJob: duplicateJob
            };
        }

        // Create job data
        const jobData = {
            userId: userId.toString(),
            enqueuedAt: new Date().toISOString(),
            enqueuedBy: options.enqueuedBy || 'system'
        };

        // Job options
        const jobOptions = {
            priority: options.priority || 0,
            delay: options.delay || 0,
            jobId: options.jobId || `user-${userId}-${Date.now()}`,
            // Add metadata for tracking
            attempts: options.attempts || 3,
            backoff: options.backoff || {
                type: 'exponential',
                delay: 60000 // 1 minute initial delay
            }
        };

        // Add job to queue
        const job = await queue.add('process-user-data', jobData, jobOptions);

        logger.info(`[Producer] Enqueued user ${userId} for processing (jobId: ${job.id})`);

        return {
            success: true,
            jobId: job.id,
            userId: userId.toString(),
            state: 'waiting',
            enqueuedAt: jobData.enqueuedAt
        };

    } catch (error) {
        logger.error(`[Producer] Failed to enqueue user ${userId}:`, error);
        throw error;
    }
}

/**
 * Enqueue multiple users in bulk
 * 
 * Useful for:
 * - Initial migration
 * - Batch processing
 * - Recovery scenarios
 * 
 * @param {string[]} userIds - Array of user IDs to enqueue
 * @param {Object} options - Options for all jobs
 * @returns {Promise<Object>} Summary of enqueued jobs
 */
async function enqueueUsers(userIds, options = {}) {
    const results = {
        total: userIds.length,
        enqueued: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };

    logger.info(`[Producer] Starting bulk enqueue for ${userIds.length} users`);

    // Process in batches to avoid overwhelming Redis
    const batchSize = options.batchSize || 50;
    
    for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);
        
        await Promise.allSettled(
            batch.map(async (userId) => {
                try {
                    const result = await enqueueUser(userId, options);
                    if (result.success) {
                        results.enqueued++;
                    } else {
                        results.skipped++;
                    }
                } catch (error) {
                    results.failed++;
                    results.errors.push({
                        userId,
                        error: error.message
                    });
                    logger.error(`[Producer] Failed to enqueue user ${userId}:`, error);
                }
            })
        );

        // Small delay between batches to avoid overwhelming Redis
        if (i + batchSize < userIds.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    logger.info(`[Producer] Bulk enqueue completed: ${results.enqueued} enqueued, ${results.skipped} skipped, ${results.failed} failed`);

    return results;
}

/**
 * Get queue statistics
 * 
 * @returns {Promise<Object>} Queue statistics
 */
async function getQueueStats() {
    try {
        const queue = getQueue();
        
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount()
        ]);

        return {
            waiting,
            active,
            completed,
            failed,
            delayed,
            total: waiting + active + completed + failed + delayed
        };
    } catch (error) {
        logger.error('[Producer] Failed to get queue stats:', error);
        throw error;
    }
}

/**
 * Remove a job from the queue (for cancellation)
 * 
 * @param {string} jobId - Job ID to remove
 * @returns {Promise<boolean>} Success status
 */
async function removeJob(jobId) {
    try {
        const queue = getQueue();
        const job = await queue.getJob(jobId);
        
        if (!job) {
            logger.warn(`[Producer] Job ${jobId} not found`);
            return false;
        }

        await job.remove();
        logger.info(`[Producer] Removed job ${jobId} from queue`);
        return true;
    } catch (error) {
        logger.error(`[Producer] Failed to remove job ${jobId}:`, error);
        throw error;
    }
}

/**
 * Enqueue a per-account scheduled INIT phase job (new phased architecture).
 *
 * Uses a deterministic job ID so we can check for duplicates by exact ID
 * instead of scanning all jobs. Also applies a max-age safety net: if the
 * existing job is older than MAX_SCHEDULED_JOB_AGE, it is removed and a
 * fresh one is created (prevents jobs orphaned by worker crashes from
 * blocking the user forever).
 *
 * @param {string} userId
 * @param {string} country
 * @param {string} region
 * @returns {Promise<Object>}
 */
async function enqueueScheduledAccountJob(userId, country, region) {
    try {
        const queue = getQueue();

        if (!userId || !country || !region) {
            throw new Error('userId, country, and region are all required');
        }

        const parentJobId = `scheduled-${userId}-${country}-${region}`;
        const initJobId = `${parentJobId}-${PHASES.INIT}`;

        const allPhaseIds = scheduledPhasesModule.getAllPhaseJobIds(parentJobId);
        // Also check the parent ID itself (safety)
        const idsToCheck = [parentJobId, ...allPhaseIds];

        for (const jid of idsToCheck) {
            const existingJob = await queue.getJob(jid);
            if (!existingJob) continue;

            const state = await existingJob.getState();

            if (state === 'waiting' || state === 'active' || state === 'delayed') {
                const jobAge = Date.now() - existingJob.timestamp;

                if (jobAge > MAX_SCHEDULED_JOB_AGE) {
                    logger.warn(`[Producer] Removing stale scheduled job ${jid} for user ${userId} ${country}-${region} (age: ${Math.round(jobAge / 3600000)}h, state: ${state})`);
                    try { await existingJob.remove(); } catch (re) { logger.warn(`[Producer] Could not remove stale job ${jid}: ${re.message}`); }
                } else {
                    logger.info(`[Producer] Scheduled job already in progress for ${userId} ${country}-${region} (jobId: ${jid}, state: ${state}, age: ${Math.round(jobAge / 60000)}min)`);
                    return { success: false, message: 'Account already has a scheduled job in progress', jobId: jid, state };
                }
            } else if (state === 'completed' || state === 'failed') {
                try { await existingJob.remove(); } catch (re) { logger.warn(`[Producer] Could not remove old job ${jid}: ${re.message}`); }
            } else {
                logger.warn(`[Producer] Removing job ${jid} with unexpected state: ${state}`);
                try { await existingJob.remove(); } catch (re) { logger.warn(`[Producer] Could not remove job ${jid}: ${re.message}`); }
            }
        }

        // Create the INIT phase job
        const jobData = {
            userId: userId.toString(),
            country,
            region,
            phase: PHASES.INIT,
            parentJobId,
            enqueuedAt: new Date().toISOString(),
            enqueuedBy: 'cron-scheduled',
            phaseData: {}
        };

        const job = await queue.add('process-user-data', jobData, {
            jobId: initJobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60000 },
            timeout: 2 * 60 * 60 * 1000
        });

        logger.info(`[Producer] Enqueued scheduled INIT for ${userId} ${country}-${region} (jobId: ${job.id})`);
        return { success: true, jobId: job.id, userId, country, region, state: 'waiting' };

    } catch (error) {
        logger.error(`[Producer] Failed to enqueue scheduled job for ${userId} ${country}-${region}:`, error);
        throw error;
    }
}

module.exports = {
    enqueueUser,
    enqueueUsers,
    enqueueScheduledAccountJob,
    getQueueStats,
    removeJob
};


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

module.exports = {
    enqueueUser,
    enqueueUsers,
    getQueueStats,
    removeJob
};


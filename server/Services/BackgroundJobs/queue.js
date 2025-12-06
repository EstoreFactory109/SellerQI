/**
 * queue.js
 * 
 * BullMQ Queue Setup
 * 
 * Creates and configures the BullMQ queue for user data processing jobs.
 * Uses the existing Redis Cloud connection to avoid duplicate clients.
 * 
 * Queue Configuration:
 * - Queue name: 'user-data-processing'
 * - Jobs persist across restarts
 * - Automatic retries with exponential backoff
 * - Progress tracking enabled
 * - Proper key namespacing to avoid conflicts with cache keys
 * - Optimized job retention to minimize memory usage (reduces eviction risk)
 * 
 * Note: Job retention is optimized for Redis Cloud with volatile-lru policy.
 * Completed jobs: 2 hours / 100 jobs max
 * Failed jobs: 1 day / 500 jobs max
 * Job history is stored in MongoDB (JobStatusModel) for long-term tracking.
 */

const { Queue } = require('bullmq');
const { getQueueRedisConnection } = require('../../config/queueRedisConn.js');
const logger = require('../../utils/Logger.js');

// Queue name - namespaced to avoid conflicts
const QUEUE_NAME = 'user-data-processing';

// Redis connection options for BullMQ
const connection = getQueueRedisConnection();

/**
 * Queue configuration
 * 
 * Key settings:
 * - defaultJobOptions: Default settings for all jobs
 * - connection: Redis connection (reuses existing Redis Cloud)
 * - prefix: Namespace prefix to separate queue keys from cache keys
 */
const queueConfig = {
    connection,
    // Prefix all queue keys with 'bullmq:' to avoid conflicts with cache keys
    // Cache keys use format: 'analyse_data:userId:country:region:adminId'
    // Queue keys will use format: 'bullmq:user-data-processing:...'
    prefix: 'bullmq',
    defaultJobOptions: {
        // Remove job after completion (optimized for memory efficiency)
        // Reduced retention to minimize memory usage and eviction risk
        removeOnComplete: {
            age: 2 * 3600, // 2 hours (reduced from 24 hours) - enough for monitoring
            count: 100 // Keep last 100 completed jobs (reduced from 1000)
        },
        // Remove failed jobs after shorter period
        removeOnFail: {
            age: 24 * 3600, // 1 day (reduced from 7 days) - enough for debugging
            count: 500 // Keep last 500 failed jobs (reduced from 5000)
        },
        // Retry configuration
        attempts: 3, // Retry up to 3 times
        backoff: {
            type: 'exponential', // Exponential backoff
            delay: 60000 // Start with 1 minute delay, then 2, 4, etc.
        },
        // Job timeout (6 hours for slow users)
        timeout: 6 * 60 * 60 * 1000, // 6 hours in milliseconds
        // Enable job progress tracking
        jobId: undefined // Let BullMQ generate unique IDs
    }
};

// Create the queue instance
let userDataQueue = null;

/**
 * Get or create the queue instance
 * @returns {Queue} BullMQ queue instance
 */
function getQueue() {
    if (!userDataQueue) {
        try {
            userDataQueue = new Queue(QUEUE_NAME, queueConfig);
            
            // Event listeners for monitoring
            userDataQueue.on('error', (error) => {
                logger.error('[Queue] Queue error:', error);
            });

            userDataQueue.on('waiting', (job) => {
                logger.info(`[Queue] Job ${job.id} (userId: ${job.data.userId}) is waiting`);
            });

            userDataQueue.on('active', (job) => {
                logger.info(`[Queue] Job ${job.id} (userId: ${job.data.userId}) started processing`);
            });

            userDataQueue.on('completed', (job, result) => {
                logger.info(`[Queue] Job ${job.id} (userId: ${job.data.userId}) completed successfully`, {
                    duration: result?.duration,
                    accountsProcessed: result?.accountsProcessed,
                    accountsSucceeded: result?.accountsSucceeded
                });
            });

            userDataQueue.on('failed', (job, err) => {
                logger.error(`[Queue] Job ${job.id} (userId: ${job.data?.userId}) failed:`, err);
            });

            userDataQueue.on('stalled', (jobId) => {
                logger.warn(`[Queue] Job ${jobId} stalled - worker may have crashed`);
            });

            logger.info('[Queue] User data processing queue initialized successfully');
        } catch (error) {
            logger.error('[Queue] Failed to initialize queue:', error);
            throw error;
        }
    }
    return userDataQueue;
}

/**
 * Close the queue connection gracefully
 */
async function closeQueue() {
    if (userDataQueue) {
        await userDataQueue.close();
        userDataQueue = null;
        logger.info('[Queue] Queue connection closed');
    }
}

module.exports = {
    getQueue,
    QUEUE_NAME,
    closeQueue
};


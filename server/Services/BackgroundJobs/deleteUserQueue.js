/**
 * deleteUserQueue.js
 *
 * Dedicated BullMQ queue for full user data purge jobs.
 * This queue is completely independent from user-data-processing and user-integration.
 * Used only after User + Seller are deleted (hybrid approach); worker purges all remaining collections.
 *
 * Queue name: 'full-user-data-deletion'
 * Do not modify existing queue.js or worker.js - this is a separate flow.
 */

const { Queue } = require('bullmq');
const { getQueueRedisConnection } = require('../../config/queueRedisConn.js');
const logger = require('../../utils/Logger.js');

const DELETE_USER_QUEUE_NAME = 'full-user-data-deletion';
const connection = getQueueRedisConnection();

const queueConfig = {
    connection,
    prefix: 'bullmq',
    defaultJobOptions: {
        removeOnComplete: { age: 24 * 3600, count: 200 },
        removeOnFail: { age: 7 * 24 * 3600, count: 500 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        timeout: 60 * 60 * 1000, // 1 hour
    },
};

let deleteUserQueueInstance = null;

function getDeleteUserQueue() {
    if (!deleteUserQueueInstance) {
        try {
            deleteUserQueueInstance = new Queue(DELETE_USER_QUEUE_NAME, queueConfig);
            deleteUserQueueInstance.on('error', (err) => logger.error('[DeleteUserQueue] Queue error:', err));
            logger.info('[DeleteUserQueue] Full user data deletion queue initialized');
        } catch (error) {
            logger.error('[DeleteUserQueue] Failed to initialize queue:', error);
            throw error;
        }
    }
    return deleteUserQueueInstance;
}

/**
 * Enqueue a full user data purge job (call after User + Seller are already deleted).
 * @param {string} userId - MongoDB ObjectId of the user (already deleted)
 * @returns {Promise<Job>}
 */
async function enqueueFullUserDataPurge(userId, options = {}) {
    const { includeBillingHistory = false } = options;
    const queue = getDeleteUserQueue();
    // No explicit jobId: BullMQ silently drops an add() whose jobId matches an
    // existing job, and completed jobs are retained for 24h. The old fixed
    // `purge-${userId}` therefore meant a second purge for the same user within a
    // day -- six-month cleanup first, admin delete after -- never ran at all.
    // Letting BullMQ assign the id guarantees uniqueness (a timestamp does not:
    // two enqueues in the same millisecond collide). Re-running a purge is safe,
    // since it is deleteMany over rows that are already gone.
    const job = await queue.add('purge-user-data', { userId, includeBillingHistory });
    logger.info('[DeleteUserQueue] Enqueued full user data purge job', { jobId: job.id, userId, includeBillingHistory });
    return job;
}

async function closeDeleteUserQueue() {
    if (deleteUserQueueInstance) {
        await deleteUserQueueInstance.close();
        deleteUserQueueInstance = null;
        logger.info('[DeleteUserQueue] Queue connection closed');
    }
}

module.exports = {
    getDeleteUserQueue,
    DELETE_USER_QUEUE_NAME,
    enqueueFullUserDataPurge,
    closeDeleteUserQueue,
};

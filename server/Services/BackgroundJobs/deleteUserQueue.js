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
async function enqueueFullUserDataPurge(userId) {
    const queue = getDeleteUserQueue();
    const job = await queue.add('purge-user-data', { userId }, { jobId: `purge-${userId}` });
    logger.info('[DeleteUserQueue] Enqueued full user data purge job', { jobId: job.id, userId });
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

/**
 * queue.js
 *
 * BullMQ Queue for scheduled user-data-processing jobs.
 *
 * This queue is consumed by `worker.js` (PM2 app `worker`).
 *
 * Producers:
 * - cronProducer / cronProducerStandalone   → enqueues `sched_init` phase jobs
 * - producer.js (enqueueScheduledAccountJob) → idempotent INIT enqueue
 * - worker.js (processScheduledPhase)        → chains the next phase
 *
 * Notes:
 * - Uses the shared IORedis connection (same instance shared with producer
 *   and worker code paths) to guarantee Queue↔Worker key visibility.
 * - Idempotency at the job level is enforced by deterministic job IDs upstream
 *   (e.g. `${parentJobId}-${phase}`); BullMQ rejects duplicates with the same
 *   `jobId`, so re-enqueue attempts are safe.
 */

const { Queue } = require('bullmq');
const { getSharedConnection } = require('./sharedQueueConnection.js');
const logger = require('../../utils/Logger.js');

const QUEUE_NAME = 'user-data-processing';

let queueInstance = null;

function getQueueConfig() {
    return {
        connection: getSharedConnection(),
        prefix: 'bullmq',
        defaultJobOptions: {
            removeOnComplete: { age: 2 * 3600, count: 100 },
            removeOnFail: { age: 24 * 3600, count: 500 },
            attempts: 3,
            backoff: { type: 'exponential', delay: 60000 },
            timeout: 2 * 60 * 60 * 1000
        }
    };
}

function getQueue() {
    if (queueInstance) return queueInstance;

    try {
        queueInstance = new Queue(QUEUE_NAME, getQueueConfig());

        queueInstance.on('error', (error) => {
            logger.error('[Queue] Queue error:', error?.message || error);
        });

        logger.info(`[Queue] BullMQ queue "${QUEUE_NAME}" initialized`);
    } catch (error) {
        logger.error('[Queue] Failed to initialize BullMQ queue:', error);
        throw error;
    }

    return queueInstance;
}

async function closeQueue() {
    if (queueInstance) {
        try {
            await queueInstance.close();
            logger.info('[Queue] BullMQ queue closed gracefully');
        } catch (error) {
            logger.error('[Queue] Error during queue close:', error?.message || error);
        } finally {
            queueInstance = null;
        }
    }
}

module.exports = {
    getQueue,
    QUEUE_NAME,
    closeQueue
};

/**
 * deleteUserWorker.js
 *
 * Dedicated BullMQ worker for full user data purge jobs only.
 * Listens to the 'full-user-data-deletion' queue; does not touch user-data-processing
 * or user-integration queues or workers.
 *
 * Run as a separate process (e.g. PM2):
 *   node server/Services/BackgroundJobs/deleteUserWorker.js
 *   pm2 start server/Services/BackgroundJobs/deleteUserWorker.js --name delete-user-worker
 */

require('dotenv').config();

const { Worker } = require('bullmq');
const { getQueueRedisConnection } = require('../../config/queueRedisConn.js');
const { purgeAllUserData } = require('../User/fullUserDataPurgeService.js');
const { DELETE_USER_QUEUE_NAME } = require('./deleteUserQueue.js');
const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');

const connection = getQueueRedisConnection();
const WORKER_CONCURRENCY = parseInt(process.env.DELETE_USER_WORKER_CONCURRENCY || '1', 10);
const WORKER_NAME = process.env.DELETE_USER_WORKER_NAME || `delete-user-worker-${process.pid}`;

let isInitialized = false;

async function initializeConnections() {
    if (isInitialized) return;
    await dbConnect();
    logger.info('[DeleteUserWorker] Connected to MongoDB');
    isInitialized = true;
}

async function startDeleteUserWorker() {
    await initializeConnections();

    const worker = new Worker(
        DELETE_USER_QUEUE_NAME,
        async (job) => {
            const { userId } = job.data;
            const start = Date.now();

            logger.info(`[DeleteUserWorker:${WORKER_NAME}] Starting purge job ${job.id} for user ${userId}`);

            try {
                const result = await purgeAllUserData(userId);
                const duration = Date.now() - start;
                logger.info(`[DeleteUserWorker:${WORKER_NAME}] Purge job ${job.id} completed for user ${userId}`, {
                    duration,
                    totalDeleted: result.totalDeleted,
                    success: result.success,
                });
                return {
                    success: result.success,
                    totalDeleted: result.totalDeleted,
                    deletedByCollection: result.deletedByCollection,
                    duration,
                    errors: result.errors,
                };
            } catch (err) {
                logger.error(`[DeleteUserWorker:${WORKER_NAME}] Purge job ${job.id} failed for user ${userId}:`, err);
                throw err;
            }
        },
        {
            connection,
            prefix: 'bullmq',
            concurrency: WORKER_CONCURRENCY,
            lockDuration: 45 * 60 * 1000,
            stallInterval: 2 * 60 * 1000,
            removeOnComplete: { age: 24 * 3600, count: 200 },
            removeOnFail: { age: 7 * 24 * 3600, count: 500 },
        }
    );

    worker.on('completed', (job, result) => {
        logger.info(`[DeleteUserWorker:${WORKER_NAME}] Job ${job.id} completed`, {
            userId: job.data.userId,
            totalDeleted: result?.totalDeleted,
        });
    });

    worker.on('failed', (job, err) => {
        logger.error(`[DeleteUserWorker:${WORKER_NAME}] Job ${job?.id} failed`, {
            userId: job?.data?.userId,
            error: err?.message,
        });
    });

    worker.on('error', (err) => {
        logger.error(`[DeleteUserWorker:${WORKER_NAME}] Worker error:`, err);
    });

    const gracefulShutdown = (signal) => {
        logger.info(`[DeleteUserWorker:${WORKER_NAME}] ${signal} received, closing worker...`);
        worker.close().then(() => process.exit(0)).catch(() => process.exit(1));
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    logger.info(`[DeleteUserWorker:${WORKER_NAME}] Worker started (concurrency: ${WORKER_CONCURRENCY})`);
    return worker;
}

startDeleteUserWorker().catch((err) => {
    logger.error('[DeleteUserWorker] Failed to start:', err);
    process.exit(1);
});

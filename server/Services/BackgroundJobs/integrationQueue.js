/**
 * integrationQueue.js
 * 
 * BullMQ Queue for First-Time User Integration
 * 
 * This is a SEPARATE queue specifically for first-time data fetching.
 * It does NOT affect the existing user-data-processing queue or workers.
 * 
 * Queue Configuration:
 * - Queue name: 'user-integration' (separate from 'user-data-processing')
 * - Jobs persist across restarts
 * - Automatic retries with exponential backoff
 * - Progress tracking enabled
 * - Higher priority than scheduled updates (user-initiated)
 * 
 * Purpose:
 * - Handle first-time Integration.getSpApiData() calls
 * - Non-blocking: API returns immediately with job ID
 * - User polls for status until completion
 */

const { Queue } = require('bullmq');
const { getQueueRedisConnection } = require('../../config/queueRedisConn.js');
const logger = require('../../utils/Logger.js');

// Queue name - separate from existing 'user-data-processing' queue
const INTEGRATION_QUEUE_NAME = 'user-integration';

// Redis connection options for BullMQ
const connection = getQueueRedisConnection();

/**
 * Queue configuration for integration jobs
 * 
 * Key settings:
 * - Longer timeout (integration can take 30-90 minutes)
 * - Higher priority (user-initiated)
 * - Separate namespace to avoid conflicts
 */
const integrationQueueConfig = {
    connection,
    // Prefix all queue keys with 'bullmq:' to match existing setup
    prefix: 'bullmq',
    defaultJobOptions: {
        // Remove job after completion
        removeOnComplete: {
            age: 4 * 3600, // 4 hours (longer for integration jobs)
            count: 100 // Keep last 100 completed jobs
        },
        // Remove failed jobs after period
        removeOnFail: {
            age: 24 * 3600, // 1 day
            count: 500 // Keep last 500 failed jobs
        },
        // Retry configuration
        attempts: 2, // Retry up to 2 times (API calls are expensive)
        backoff: {
            type: 'exponential',
            delay: 120000 // Start with 2 minute delay (API rate limits)
        },
        // Job timeout (2 hours for comprehensive integration)
        timeout: 2 * 60 * 60 * 1000, // 2 hours in milliseconds
        // Enable job progress tracking
        jobId: undefined // Let BullMQ generate unique IDs
    }
};

// Create the queue instance
let integrationQueue = null;

/**
 * Get or create the integration queue instance
 * @returns {Queue} BullMQ queue instance for integration jobs
 */
function getIntegrationQueue() {
    if (!integrationQueue) {
        try {
            integrationQueue = new Queue(INTEGRATION_QUEUE_NAME, integrationQueueConfig);
            
            // Event listeners for monitoring
            integrationQueue.on('error', (error) => {
                logger.error('[IntegrationQueue] Queue error:', error);
            });

            integrationQueue.on('waiting', (job) => {
                logger.info(`[IntegrationQueue] Job ${job.id} (userId: ${job.data.userId}) is waiting`);
            });

            integrationQueue.on('active', (job) => {
                logger.info(`[IntegrationQueue] Job ${job.id} (userId: ${job.data.userId}) started processing`);
            });

            integrationQueue.on('completed', (job, result) => {
                logger.info(`[IntegrationQueue] Job ${job.id} (userId: ${job.data.userId}) completed successfully`, {
                    duration: result?.duration,
                    success: result?.success
                });
            });

            integrationQueue.on('failed', (job, err) => {
                logger.error(`[IntegrationQueue] Job ${job.id} (userId: ${job.data?.userId}) failed:`, err);
            });

            integrationQueue.on('stalled', (jobId) => {
                logger.warn(`[IntegrationQueue] Job ${jobId} stalled - worker may have crashed`);
            });

            logger.info('[IntegrationQueue] User integration queue initialized successfully');
        } catch (error) {
            logger.error('[IntegrationQueue] Failed to initialize queue:', error);
            throw error;
        }
    }
    return integrationQueue;
}

/**
 * Add an integration job to the queue
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Job info with jobId
 */
async function addIntegrationJob(userId, country, region) {
    const queue = getIntegrationQueue();
    
    // Create a unique job ID based on userId, country, region
    const customJobId = `integration-${userId}-${country}-${region}`;
    
    // Check if a job with this ID already exists
    const existingJob = await queue.getJob(customJobId);
    if (existingJob) {
        const state = await existingJob.getState();
        
        // If job is waiting, active, or delayed - return it (don't create new)
        if (state === 'waiting' || state === 'active' || state === 'delayed') {
            logger.info(`[IntegrationQueue] Job already in progress for user ${userId}, ${country}-${region}. State: ${state}`);
            return {
                jobId: customJobId,
                isExisting: true,
                state: state
            };
        }
        
        // If job is completed in queue, check if it's recent (within 2 hours)
        // If older than 2 hours, allow creating a new job
        if (state === 'completed') {
            const finishedOn = existingJob.finishedTimestamp;
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
            
            if (finishedOn && finishedOn >= twoHoursAgo) {
                logger.info(`[IntegrationQueue] Job completed recently for user ${userId}, ${country}-${region}. Wait before re-analysing.`);
            return {
                jobId: customJobId,
                isExisting: true,
                state: 'completed'
            };
            }
            
            // Job is older than 2 hours, remove it and allow new job
            logger.info(`[IntegrationQueue] Removing old completed job for user ${userId}, ${country}-${region}`);
            await existingJob.remove();
        }
    }
    
    // Also check database for recently completed jobs (within last 2 hours)
    // This handles cases where the job was removed from queue but exists in DB
    const JobStatus = require('../../models/system/JobStatusModel.js');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const recentCompletedJob = await JobStatus.findOne({
        jobId: customJobId,
        status: 'completed',
        completedAt: { $gte: twoHoursAgo }
    }).lean();
    
    if (recentCompletedJob) {
        logger.info(`[IntegrationQueue] Recently completed job found in DB for user ${userId}, ${country}-${region}`);
        return {
            jobId: customJobId,
            isExisting: true,
            state: 'completed'
        };
    }
    
    // Add new job
    const job = await queue.add(
        'integration',
        {
            userId,
            country,
            region,
            triggeredAt: new Date().toISOString()
        },
        {
            jobId: customJobId,
            priority: 1 // Higher priority than scheduled jobs
        }
    );
    
    logger.info(`[IntegrationQueue] Added integration job ${job.id} for user ${userId}, ${country}-${region}`);
    
    // Verify job is actually in queue
    const verifyJob = await queue.getJob(job.id);
    const verifyState = verifyJob ? await verifyJob.getState() : 'NOT_FOUND';
    const waitingCount = await queue.getWaitingCount();
    logger.info(`[IntegrationQueue] Verification - Job ${job.id} state: ${verifyState}, Total waiting: ${waitingCount}`);
    
    return {
        jobId: job.id,
        isExisting: false,
        state: 'waiting'
    };
}

/**
 * Get job status by job ID
 * @param {string} jobId - Job ID
 * @returns {Object} Job status
 */
async function getIntegrationJobStatus(jobId) {
    const queue = getIntegrationQueue();
    const job = await queue.getJob(jobId);
    
    if (!job) {
        return {
            found: false,
            status: 'not_found',
            message: 'Job not found'
        };
    }
    
    const state = await job.getState();
    const progress = job.progress || 0;
    
    return {
        found: true,
        jobId: job.id,
        status: state,
        progress: progress,
        data: job.data,
        returnvalue: state === 'completed' ? job.returnvalue : null,
        failedReason: state === 'failed' ? job.failedReason : null,
        attemptsMade: job.attemptsMade,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn
    };
}

/**
 * Close the queue connection gracefully
 */
async function closeIntegrationQueue() {
    if (integrationQueue) {
        await integrationQueue.close();
        integrationQueue = null;
        logger.info('[IntegrationQueue] Queue connection closed');
    }
}

module.exports = {
    getIntegrationQueue,
    addIntegrationJob,
    getIntegrationJobStatus,
    closeIntegrationQueue,
    INTEGRATION_QUEUE_NAME
};


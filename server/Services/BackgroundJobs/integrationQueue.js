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
 * 
 * Cooldown Bypass Logic:
 * - Normal cooldown: 2 hours between integrations
 * - Bypass cooldown if account connection status has changed:
 *   - New token added (SP-API or Ads)
 *   - Token removed
 *   - Token reconnected (deleted and re-added)
 * - First registration is never affected (no previous job exists)
 */

const { Queue } = require('bullmq');
const { getQueueRedisConnection } = require('../../config/queueRedisConn.js');
const logger = require('../../utils/Logger.js');
const mongoose = require('mongoose');

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
 * Get current account connection status for user from database
 * This checks the REAL-TIME status of tokens in the database
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Account connection status with timestamps
 */
async function getCurrentAccountStatus(userId, country, region) {
    try {
        const Seller = require('../../models/user-auth/sellerCentralModel.js');
        
        const sellerCentral = await Seller.findOne({ User: mongoose.Types.ObjectId(userId) });
        if (!sellerCentral || !sellerCentral.sellerAccount) {
            return { 
                hasSpApiAccount: false, 
                hasAdsAccount: false,
                tokenUpdatedAt: null
            };
        }
        
        const sellerAccount = sellerCentral.sellerAccount.find(
            acc => acc.country === country && acc.region === region
        );
        
        if (!sellerAccount) {
            return { 
                hasSpApiAccount: false, 
                hasAdsAccount: false,
                tokenUpdatedAt: null
            };
        }
        
        const hasSpApiAccount = sellerAccount.spiRefreshToken && sellerAccount.spiRefreshToken.trim() !== '';
        const hasAdsAccount = sellerAccount.adsRefreshToken && sellerAccount.adsRefreshToken.trim() !== '';
        
        // Get when the sellerAccount was last updated (MongoDB auto-managed timestamp)
        const tokenUpdatedAt = sellerAccount.updatedAt ? new Date(sellerAccount.updatedAt) : null;
        
        return { 
            hasSpApiAccount, 
            hasAdsAccount,
            tokenUpdatedAt
        };
    } catch (error) {
        logger.error(`[IntegrationQueue] Error getting current account status:`, error);
        // On error, return false values (fail-safe - won't bypass cooldown)
        return { 
            hasSpApiAccount: false, 
            hasAdsAccount: false,
            tokenUpdatedAt: null
        };
    }
}

/**
 * Check if account connection status has changed since previous job
 * This determines whether to bypass the 2-hour cooldown
 * 
 * IMPORTANT: This function is designed to be FAIL-SAFE:
 * - If metadata is missing, cooldown is enforced (not bypassed)
 * - If there's an error, cooldown is enforced (not bypassed)
 * - Cooldown is only bypassed when we can DEFINITIVELY determine a change
 * 
 * Scenarios that bypass cooldown:
 * 1. Token added (false → true)
 * 2. Token removed (true → false)
 * 3. Token reconnected (tokens were recently updated and exist now)
 * 
 * Scenarios that DO NOT bypass cooldown:
 * 1. No status change (same tokens as before)
 * 2. Missing metadata (old jobs without account tracking)
 * 3. Errors during status check
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @param {Object} previousJobMetadata - Metadata from previous completed job
 * @param {Date} previousJobCompletedAt - When the previous job completed
 * @returns {boolean} True if account connection status has changed (and we're certain)
 */
async function hasAccountStatusChanged(userId, country, region, previousJobMetadata, previousJobCompletedAt) {
    try {
        // Get current account status from database (real-time check)
        const currentStatus = await getCurrentAccountStatus(userId, country, region);
        
        // Check if previous job metadata has account status info
        // If metadata is missing or doesn't have these fields, it's an old job
        const hasPreviousMetadata = previousJobMetadata && 
            (previousJobMetadata.hasSpApiAccount !== undefined || 
             previousJobMetadata.hasAdsAccount !== undefined);
        
        if (!hasPreviousMetadata) {
            // Old job without metadata - check if tokens were recently updated (within 30 min)
            // This handles the case where an old job exists but user just connected/reconnected
            if (currentStatus.tokenUpdatedAt) {
                const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
                if (currentStatus.tokenUpdatedAt >= thirtyMinutesAgo && 
                    (currentStatus.hasSpApiAccount || currentStatus.hasAdsAccount)) {
                    logger.info(`[IntegrationQueue] Tokens recently updated (within 30 min) for user ${userId}, ${country}-${region}. Bypassing cooldown.`);
                    return true;
                }
            }
            // Old job without metadata and no recent token update - enforce cooldown
            logger.info(`[IntegrationQueue] Previous job metadata missing account status info. Enforcing cooldown for user ${userId}, ${country}-${region}`);
            return false;
        }
        
        // Get previous account status from metadata
        const previousStatus = {
            hasSpApiAccount: previousJobMetadata.hasSpApiAccount === true,
            hasAdsAccount: previousJobMetadata.hasAdsAccount === true,
            tokenUpdatedAt: previousJobMetadata.tokenUpdatedAt ? new Date(previousJobMetadata.tokenUpdatedAt) : null
        };
        
        // Check if boolean status has changed (token added or removed)
        const spApiChanged = currentStatus.hasSpApiAccount !== previousStatus.hasSpApiAccount;
        const adsChanged = currentStatus.hasAdsAccount !== previousStatus.hasAdsAccount;
        
        // Check for reconnection scenario:
        // - Boolean status is the same (both had tokens before and now)
        // - But tokens were updated AFTER the previous job completed
        // - This detects delete + reconnect scenario
        let reconnectionDetected = false;
        if (!spApiChanged && !adsChanged && 
            (currentStatus.hasSpApiAccount || currentStatus.hasAdsAccount) &&
            currentStatus.tokenUpdatedAt && previousJobCompletedAt) {
            // Token was updated after the previous job completed
            if (currentStatus.tokenUpdatedAt > new Date(previousJobCompletedAt)) {
                reconnectionDetected = true;
            }
        }
        
        if (spApiChanged || adsChanged || reconnectionDetected) {
            logger.info(`[IntegrationQueue] Account connection status changed for user ${userId}, ${country}-${region}. ` +
                `Previous: SP-API=${previousStatus.hasSpApiAccount}, Ads=${previousStatus.hasAdsAccount}. ` +
                `Current: SP-API=${currentStatus.hasSpApiAccount}, Ads=${currentStatus.hasAdsAccount}. ` +
                `Reconnection: ${reconnectionDetected}. ` +
                `Bypassing cooldown.`);
            return true;
        }
        
        // Status hasn't changed - enforce cooldown
        return false;
    } catch (error) {
        logger.error(`[IntegrationQueue] Error checking account status change:`, error);
        // On error, don't bypass cooldown (fail-safe)
        return false;
    }
}

/**
 * Add an integration job to the queue
 * 
 * FLOW:
 * 1. First registration (no previous job): Creates new job immediately
 * 2. Job in progress: Returns existing job (no duplicate)
 * 3. Job completed within 2 hours:
 *    a. If account status changed (token added/removed/reconnected): Bypass cooldown, create new job
 *    b. If account status unchanged: Enforce cooldown, return existing job
 * 4. Job completed more than 2 hours ago: Create new job
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Job info with jobId
 */
async function addIntegrationJob(userId, country, region) {
    const queue = getIntegrationQueue();
    
    // Create a unique job ID based on userId, country, region
    const customJobId = `integration-${userId}-${country}-${region}`;
    
    // Check if a job with this ID already exists in the queue
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
        if (state === 'completed') {
            const finishedOn = existingJob.finishedTimestamp;
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
            
            if (finishedOn && finishedOn >= twoHoursAgo) {
                // Job completed recently - check if account status has changed
                const previousMetadata = existingJob.returnvalue?.metadata || existingJob.data?.metadata || {};
                const accountStatusChanged = await hasAccountStatusChanged(
                    userId, 
                    country, 
                    region, 
                    previousMetadata,
                    finishedOn ? new Date(finishedOn) : null
                );
                
                if (accountStatusChanged) {
                    // Account status changed - bypass cooldown
                    logger.info(`[IntegrationQueue] Account status changed - bypassing cooldown for user ${userId}, ${country}-${region}`);
                    await existingJob.remove();
                    // Continue to create new job below
                } else {
                    // Account status unchanged - enforce cooldown
                    logger.info(`[IntegrationQueue] Job completed recently for user ${userId}, ${country}-${region}. Account status unchanged. Enforcing cooldown.`);
                    return {
                        jobId: customJobId,
                        isExisting: true,
                        state: 'completed'
                    };
                }
            } else {
                // Job is older than 2 hours, remove it and allow new job
                logger.info(`[IntegrationQueue] Removing old completed job for user ${userId}, ${country}-${region}`);
                await existingJob.remove();
            }
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
        // Job found in DB - check if account status has changed
        const accountStatusChanged = await hasAccountStatusChanged(
            userId, 
            country, 
            region, 
            recentCompletedJob.metadata || {},
            recentCompletedJob.completedAt
        );
        
        if (accountStatusChanged) {
            // Account status changed - bypass cooldown
            logger.info(`[IntegrationQueue] Account status changed (DB check) - bypassing cooldown for user ${userId}, ${country}-${region}`);
            // Continue to create new job below
        } else {
            // Account status unchanged - enforce cooldown
            logger.info(`[IntegrationQueue] Recently completed job found in DB for user ${userId}, ${country}-${region}. Account status unchanged. Enforcing cooldown.`);
            return {
                jobId: customJobId,
                isExisting: true,
                state: 'completed'
            };
        }
    }
    
    // Add new job (one of these scenarios):
    // 1. No previous job exists (first registration)
    // 2. Account status changed (cooldown bypassed)
    // 3. Previous job is older than 2 hours
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
    getCurrentAccountStatus,
    INTEGRATION_QUEUE_NAME
};


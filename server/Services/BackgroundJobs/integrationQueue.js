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
 * Job Triggering Logic:
 * - Frontend triggers integration -> Always creates a new job
 * - If a job is already running (waiting/active/delayed) -> Return that job (prevent duplicates)
 * - If a job was previously completed/failed -> Remove it and create a new job
 * - Jobs don't restart automatically after completion (only via frontend trigger)
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
 * NOTE: This function is still used by integrationWorker.js for metadata tracking
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Account connection status with timestamps
 */
async function getCurrentAccountStatus(userId, country, region) {
    try {
        // Validate userId before converting to ObjectId
        if (!userId || typeof userId !== 'string') {
            logger.warn(`[IntegrationQueue] Invalid userId type: ${typeof userId}, value: ${userId}`);
            return { 
                hasSpApiAccount: false, 
                hasAdsAccount: false,
                tokenUpdatedAt: null
            };
        }

        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            logger.warn(`[IntegrationQueue] Invalid userId format: ${userId}`);
            return { 
                hasSpApiAccount: false, 
                hasAdsAccount: false,
                tokenUpdatedAt: null
            };
        }

        const Seller = require('../../models/user-auth/sellerCentralModel.js');
        
        // Use 'new' for ObjectId conversion (safer, works with all mongoose versions)
        const sellerCentral = await Seller.findOne({ User: new mongoose.Types.ObjectId(userId) }).lean();
        
        if (!sellerCentral || !sellerCentral.sellerAccount || !Array.isArray(sellerCentral.sellerAccount)) {
            return { 
                hasSpApiAccount: false, 
                hasAdsAccount: false,
                tokenUpdatedAt: null
            };
        }
        
        const sellerAccount = sellerCentral.sellerAccount.find(
            acc => acc && acc.country === country && acc.region === region
        );
        
        if (!sellerAccount) {
            return { 
                hasSpApiAccount: false, 
                hasAdsAccount: false,
                tokenUpdatedAt: null
            };
        }
        
        const hasSpApiAccount = sellerAccount.spiRefreshToken && typeof sellerAccount.spiRefreshToken === 'string' && sellerAccount.spiRefreshToken.trim() !== '';
        const hasAdsAccount = sellerAccount.adsRefreshToken && typeof sellerAccount.adsRefreshToken === 'string' && sellerAccount.adsRefreshToken.trim() !== '';
        
        // Get when the sellerAccount was last updated (MongoDB auto-managed timestamp)
        const tokenUpdatedAt = sellerAccount.updatedAt ? new Date(sellerAccount.updatedAt) : null;
        
        return { 
            hasSpApiAccount, 
            hasAdsAccount,
            tokenUpdatedAt
        };
    } catch (error) {
        logger.error(`[IntegrationQueue] Error getting current account status for userId ${userId}:`, error.message || error);
        return { 
            hasSpApiAccount: false, 
            hasAdsAccount: false,
            tokenUpdatedAt: null
        };
    }
}

/**
 * Add an integration job to the queue
 * 
 * SIMPLIFIED FLOW (no cooldown, no duplicate checks for completed jobs):
 * 1. If a job is currently in progress (waiting/active/delayed): Return that job
 * 2. If a job is completed/failed: Remove it and create a new one
 * 3. If no job exists: Create a new one
 * 
 * Jobs only start when triggered from frontend - they don't restart automatically
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
        
        // If job is waiting, active, or delayed - return it (don't create duplicate while it's running)
        if (state === 'waiting' || state === 'active' || state === 'delayed') {
            logger.info(`[IntegrationQueue] Job already in progress for user ${userId}, ${country}-${region}. State: ${state}`);
            return {
                jobId: customJobId,
                isExisting: true,
                state: state
            };
        }
        
        // Job is completed or failed - remove it to allow creating a new one
        logger.info(`[IntegrationQueue] Removing existing ${state} job for user ${userId}, ${country}-${region} to create new one`);
        try {
            await existingJob.remove();
        } catch (removeError) {
            logger.warn(`[IntegrationQueue] Could not remove existing job: ${removeError.message}`);
            // Continue anyway - BullMQ might replace it
        }
    }
    
    // Create new job
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
 * Add a phase job to the queue (used for chained job execution)
 * 
 * @param {Object} jobData - Phase job data
 * @param {string} jobData.userId - User ID
 * @param {string} jobData.country - Country code
 * @param {string} jobData.region - Region code
 * @param {string} jobData.phase - Phase name (init, batch_1_2, batch_3_4, listing_items, finalize)
 * @param {string} jobData.parentJobId - Parent job ID for tracking
 * @param {Object} jobData.phaseData - Data passed from previous phase
 * @returns {Object} Job info
 */
async function addPhaseJob(jobData) {
    const queue = getIntegrationQueue();
    const { userId, country, region, phase, parentJobId, phaseData, triggeredAt } = jobData;
    
    // Generate phase-specific job ID
    const phaseJobId = `${parentJobId}-${phase}`;
    
    // Check if this phase job already exists
    const existingJob = await queue.getJob(phaseJobId);
    if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'waiting' || state === 'active' || state === 'delayed') {
            logger.info(`[IntegrationQueue] Phase job ${phaseJobId} already in progress. State: ${state}`);
            return {
                jobId: phaseJobId,
                isExisting: true,
                state
            };
        }
        
        // Remove completed/failed phase job to create new one
        try {
            await existingJob.remove();
        } catch (removeError) {
            logger.warn(`[IntegrationQueue] Could not remove existing phase job: ${removeError.message}`);
        }
    }
    
    // Create the phase job with extended timeout for long-running phases
    // Phases can run 6+ hours for large catalogs (5k+ products with reviews, listings)
    const job = await queue.add(
        'integration-phase',
        {
            userId,
            country,
            region,
            phase,
            parentJobId,
            phaseData: phaseData || {},
            triggeredAt: triggeredAt || new Date().toISOString()
        },
        {
            jobId: phaseJobId,
            priority: 1,
            // Phase-specific settings
            attempts: 2,
            backoff: {
                type: 'exponential',
                delay: 60000 // 1 minute delay between retries
            },
            // Extended timeout for phases (6 hours) - handles large catalogs
            timeout: 6 * 60 * 60 * 1000 // 6 hours
        }
    );
    
    logger.info(`[IntegrationQueue] Added phase job ${job.id} (phase: ${phase}) for user ${userId}`);
    
    return {
        jobId: job.id,
        isExisting: false,
        state: 'waiting',
        phase
    };
}

/**
 * Get aggregated job status for an integration (considering all phases)
 * 
 * @param {string} parentJobId - Parent job ID
 * @returns {Object} Aggregated job status
 */
async function getAggregatedJobStatus(parentJobId) {
    const { PHASES, PHASE_ORDER, getPhaseDescription } = require('./integrationPhases.js');
    const queue = getIntegrationQueue();
    const JobStatus = require('../../models/system/JobStatusModel.js');
    
    // Try to get status from database first (more reliable for phased jobs)
    try {
        const dbStatus = await JobStatus.findOne({ jobId: parentJobId }).lean();
        
        if (dbStatus) {
            return {
                found: true,
                jobId: parentJobId,
                status: dbStatus.status,
                progress: dbStatus.progress || 0,
                currentPhase: dbStatus.currentPhase,
                currentPhaseDescription: dbStatus.currentPhase ? getPhaseDescription(dbStatus.currentPhase) : null,
                metadata: dbStatus.metadata,
                error: dbStatus.error,
                startedAt: dbStatus.startedAt,
                completedAt: dbStatus.completedAt,
                failedAt: dbStatus.failedAt,
                summary: dbStatus.metadata?.summary
            };
        }
    } catch (dbError) {
        logger.warn(`[IntegrationQueue] Error fetching job status from DB:`, dbError.message);
    }
    
    // Fall back to checking the queue directly
    const job = await queue.getJob(parentJobId);
    
    if (!job) {
        // Check for any phase jobs
        for (const phase of PHASE_ORDER) {
            const phaseJobId = `${parentJobId}-${phase}`;
            const phaseJob = await queue.getJob(phaseJobId);
            if (phaseJob) {
                const state = await phaseJob.getState();
                return {
                    found: true,
                    jobId: parentJobId,
                    status: state,
                    currentPhase: phase,
                    currentPhaseDescription: getPhaseDescription(phase),
                    progress: PHASE_ORDER.indexOf(phase) * (100 / PHASE_ORDER.length)
                };
            }
        }
        
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
        progress,
        data: job.data,
        returnvalue: state === 'completed' ? job.returnvalue : null,
        failedReason: state === 'failed' ? job.failedReason : null,
        attemptsMade: job.attemptsMade,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn
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
    addPhaseJob,
    getIntegrationJobStatus,
    getAggregatedJobStatus,
    closeIntegrationQueue,
    getCurrentAccountStatus,
    INTEGRATION_QUEUE_NAME
};


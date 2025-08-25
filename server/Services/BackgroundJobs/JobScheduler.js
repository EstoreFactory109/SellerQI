const cron = require('node-cron');
const { DataUpdateService } = require('./DataUpdateService.js');
const { UserSchedulingService } = require('./UserSchedulingService.js');
const { sendMail } = require('./sendEmailWeekly.js');
const { sendTrialReminderEmails } = require('./ReminderEmailToUpgrade.js');
const logger = require('../../utils/Logger.js');

class JobScheduler {
    constructor() {
        this.jobs = new Map();
        this.isInitialized = false;
    }

    /**
     * Initialize all background jobs
     */
    async initialize() {
        try {
            if (this.isInitialized) {
                logger.warn('Job scheduler already initialized');
                return;
            }

            logger.info('Initializing background job scheduler...');

            // Initialize user schedules for all existing users (with error boundary)
            try {
                await UserSchedulingService.initializeAllUserSchedules();
            } catch (scheduleError) {
                logger.error('Failed to initialize user schedules, but continuing with job setup:', scheduleError);
                // Don't fail entire initialization if schedule setup fails
            }

            // Setup scheduled jobs
            this.setupDailyUpdateJob();
            this.setupCacheCleanupJob();
            this.setupHealthCheckJob();
            this.setupWeeklyEmailJob();
            this.setupTrialReminderJob();

            this.isInitialized = true;
            logger.info('Background job scheduler initialized successfully');

        } catch (error) {
            logger.error('Error initializing job scheduler:', error);
            throw error;
        }
    }

    /**
     * Setup daily update job - runs every hour to check for users needing comprehensive updates
     */
    setupDailyUpdateJob() {
        // Run every hour at minute 0 (e.g., 1:00, 2:00, 3:00...)
        const dailyJob = cron.schedule('0 * * * *', async () => {
            try {
                logger.info('Running daily comprehensive update job');
                const results = await DataUpdateService.processDailyUpdates();
                logger.info(`Daily comprehensive update job completed: ${results.successCount} successful, ${results.failureCount} failed`);
            } catch (error) {
                logger.error('Error in daily comprehensive update job:', error);
            }
        }, {
            scheduled: false, // Don't start immediately
            timezone: process.env.TIMEZONE || "UTC"
        });

        this.jobs.set('dailyUpdates', dailyJob);
        dailyJob.start();
        logger.info('Daily comprehensive update job scheduled (runs every hour)');
    }

    /**
     * Setup cache cleanup job - runs every 6 hours
     */
    setupCacheCleanupJob() {
        // Run every 6 hours at minute 30 (e.g., 00:30, 06:30, 12:30, 18:30)
        const cleanupJob = cron.schedule('30 */6 * * *', async () => {
            try {
                logger.info('Running cache cleanup job');
                const deletedCount = await DataUpdateService.cleanupOldCache();
                logger.info(`Cache cleanup completed: ${deletedCount} entries deleted`);
            } catch (error) {
                logger.error('Error in cache cleanup job:', error);
            }
        }, {
            scheduled: false,
            timezone: process.env.TIMEZONE || "UTC"
        });

        this.jobs.set('cacheCleanup', cleanupJob);
        cleanupJob.start();
        logger.info('Cache cleanup job scheduled (runs every 6 hours)');
    }

    /**
     * Setup health check job - runs every 30 minutes for monitoring
     */
    setupHealthCheckJob() {
        // Run every 30 minutes
        const healthJob = cron.schedule('*/30 * * * *', async () => {
            try {
                const stats = await DataUpdateService.getUpdateStats();
                logger.info('Background job health check:', stats);
            } catch (error) {
                logger.error('Error in health check job:', error);
            }
        }, {
            scheduled: false,
            timezone: process.env.TIMEZONE || "UTC"
        });

        this.jobs.set('healthCheck', healthJob);
        healthJob.start();
        logger.info('Health check job scheduled (runs every 30 minutes)');
    }

    /**
     * Setup weekly email job - runs every Saturday at 9:00 AM
     */
    setupWeeklyEmailJob() {
        // Run every Saturday at 9:00 AM (0 9 * * 6)
        const weeklyEmailJob = cron.schedule('0 9 * * 6', async () => {
            try {
                logger.info('Running weekly email job (every Saturday at 9:00 AM)');
                await sendMail();
                logger.info('Weekly email job completed successfully');
            } catch (error) {
                logger.error('Error in weekly email job:', error);
            }
        }, {
            scheduled: false,
            timezone: process.env.TIMEZONE || "UTC"
        });

        this.jobs.set('weeklyEmail', weeklyEmailJob);
        weeklyEmailJob.start();
        logger.info('Weekly email job scheduled (runs every Saturday at 9:00 AM)');
    }

    /**
     * Setup trial reminder email job - runs daily at 12:00 PM
     */
    setupTrialReminderJob() {
        // Run daily at 12:00 PM (0 12 * * *)
        const trialReminderJob = cron.schedule('0 12 * * *', async () => {
            try {
                logger.info('Running trial reminder email job (daily at 12:00 PM)');
                await sendTrialReminderEmails();
                logger.info('Trial reminder email job completed successfully');
            } catch (error) {
                logger.error('Error in trial reminder email job:', error);
            }
        }, {
            scheduled: false,
            timezone: process.env.TIMEZONE || "UTC"
        });

        this.jobs.set('trialReminder', trialReminderJob);
        trialReminderJob.start();
        logger.info('Trial reminder email job scheduled (runs daily at 12:00 PM)');
    }

    /**
     * Stop a specific job
     */
    stopJob(jobName) {
        const job = this.jobs.get(jobName);
        if (job) {
            job.stop();
            logger.info(`Stopped job: ${jobName}`);
            return true;
        }
        logger.warn(`Job not found: ${jobName}`);
        return false;
    }

    /**
     * Start a specific job
     */
    startJob(jobName) {
        const job = this.jobs.get(jobName);
        if (job) {
            job.start();
            logger.info(`Started job: ${jobName}`);
            return true;
        }
        logger.warn(`Job not found: ${jobName}`);
        return false;
    }

    /**
     * Stop all jobs
     */
    stopAllJobs() {
        this.jobs.forEach((job, name) => {
            job.stop();
            logger.info(`Stopped job: ${name}`);
        });
        logger.info('All background jobs stopped');
    }

    /**
     * Start all jobs
     */
    startAllJobs() {
        this.jobs.forEach((job, name) => {
            job.start();
            logger.info(`Started job: ${name}`);
        });
        logger.info('All background jobs started');
    }

    /**
     * Get status of all jobs
     */
    getJobsStatus() {
        const status = {};
        this.jobs.forEach((job, name) => {
            status[name] = {
                running: job.running || false,
                scheduled: job.scheduled || false
            };
        });
        return status;
    }

    /**
     * Manually trigger a specific job (for testing/debugging)
     */
    async triggerJob(jobName) {
        try {
            logger.info(`Manually triggering job: ${jobName}`);
            
            switch (jobName) {
                case 'dailyUpdates':
                    return await DataUpdateService.processDailyUpdates();
                case 'cacheCleanup':
                    return await DataUpdateService.cleanupOldCache();
                case 'healthCheck':
                    return await DataUpdateService.getUpdateStats();
                case 'weeklyEmail':
                    await sendMail();
                    return { message: 'Weekly email job executed successfully' };
                case 'trialReminder':
                    await sendTrialReminderEmails();
                    return { message: 'Trial reminder email job executed successfully' };
                default:
                    throw new Error(`Unknown job: ${jobName}`);
            }
        } catch (error) {
            logger.error(`Error triggering job ${jobName}:`, error);
            throw error;
        }
    }

    /**
     * Add a new user to the scheduling system
     */
    async addUser(userId) {
        try {
            await UserSchedulingService.initializeUserSchedule(userId);
            logger.info(`Added user ${userId} to background job scheduling`);
        } catch (error) {
            logger.error(`Error adding user ${userId} to scheduling:`, error);
            throw error;
        }
    }

    /**
     * Update a user's seller accounts in the scheduling system
     */
    async updateUserAccounts(userId) {
        try {
            await UserSchedulingService.updateUserSellerAccounts(userId);
            logger.info(`Updated seller accounts for user ${userId} in scheduling system`);
        } catch (error) {
            logger.error(`Error updating user accounts for ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Get comprehensive statistics about the background job system
     */
    async getSystemStats() {
        try {
            const [jobStats, updateStats, scheduleStats] = await Promise.all([
                this.getJobsStatus(),
                DataUpdateService.getUpdateStats(),
                UserSchedulingService.getScheduleStats()
            ]);

            return {
                jobs: jobStats,
                updates: updateStats,
                scheduling: scheduleStats,
                systemInfo: {
                    initialized: this.isInitialized,
                    totalJobs: this.jobs.size,
                    currentTime: new Date().toISOString(),
                    timezone: process.env.TIMEZONE || "UTC",
                    updateType: 'daily_comprehensive_only'
                }
            };
        } catch (error) {
            logger.error('Error getting system stats:', error);
            return { error: error.message };
        }
    }

    /**
     * Shutdown the job scheduler gracefully
     */
    async shutdown() {
        try {
            logger.info('Shutting down background job scheduler...');
            this.stopAllJobs();
            this.jobs.clear();
            this.isInitialized = false;
            logger.info('Background job scheduler shut down successfully');
        } catch (error) {
            logger.error('Error shutting down job scheduler:', error);
            throw error;
        }
    }
}

// Create singleton instance
const jobScheduler = new JobScheduler();

module.exports = { JobScheduler, jobScheduler }; 
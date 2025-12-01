/**
 * Application Configuration
 * 
 * This file contains all application configuration including database settings
 * and background job controls.
 */

const dbConsts= {
    dbUri: process.env.DB_URI,
    dbName: process.env.DB_NAME
}

/**
 * Background Jobs Configuration
 * 
 * Control whether background jobs run automatically.
 * 
 * To DISABLE background jobs (for manual testing):
 *   - Set enabled: false
 *   - Restart the server
 * 
 * To ENABLE background jobs:
 *   - Set enabled: true
 *   - Restart the server
 * 
 * Individual job controls are optional - if not specified, they follow the 'enabled' setting.
 */
const backgroundJobsConfig = {
    enabled: true,  // ← Change to false to disable all background jobs
    // Individual job controls (optional - if not specified, follows 'enabled' setting)
    jobs: {
        dailyUpdates: true,      // Hourly comprehensive data updates
        cacheCleanup: true,      // Cache cleanup every 6 hours
        healthCheck: true,       // Health check every 30 minutes
        weeklyEmail: true,       // Weekly email on Saturdays
        trialReminder: true      // Daily trial reminder emails
    }
}

/**
 * Helper functions to control background jobs
 * These functions modify the config object in memory (requires server restart to persist)
 */
const backgroundJobsControl = {
    /**
     * Disable all background jobs
     * Note: Requires server restart to take effect
     */
    disable: () => {
        backgroundJobsConfig.enabled = false;
        return backgroundJobsConfig;
    },
    
    /**
     * Enable all background jobs
     * Note: Requires server restart to take effect
     */
    enable: () => {
        backgroundJobsConfig.enabled = true;
        return backgroundJobsConfig;
    },
    
    /**
     * Toggle background jobs on/off
     * Note: Requires server restart to take effect
     */
    toggle: () => {
        backgroundJobsConfig.enabled = !backgroundJobsConfig.enabled;
        return backgroundJobsConfig;
    },
    
    /**
     * Get current status
     */
    getStatus: () => {
        return {
            enabled: backgroundJobsConfig.enabled,
            jobs: backgroundJobsConfig.jobs
        };
    },
    
    /**
     * Check if background jobs are enabled
     */
    isEnabled: () => {
        return backgroundJobsConfig.enabled !== false;
    }
};

module.exports = {
    ...dbConsts,
    backgroundJobs: backgroundJobsConfig,
    backgroundJobsControl: backgroundJobsControl
};
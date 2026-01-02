/**
 * PM2 Ecosystem Configuration - Weekly History Worker
 * 
 * This configuration runs the weekly history worker that records account
 * history snapshots every Sunday at 23:59 UTC.
 * 
 * This worker should run on the same instance as the API server or workers,
 * and only needs a single instance since it runs once per week.
 * 
 * Usage:
 *   pm2 start ecosystem.weekly-history.config.js
 *   pm2 stop weekly-history-worker
 *   pm2 restart weekly-history-worker
 *   pm2 logs weekly-history-worker
 * 
 * Manual Trigger (for testing):
 *   node -e "require('./server/Services/BackgroundJobs/weeklyHistoryWorker.js').manualRun().then(console.log)"
 * 
 * Environment Variables Required:
 * ==============================
 * - DB_URI: MongoDB connection string
 * - DB_NAME: MongoDB database name
 * - TIMEZONE: Timezone for cron scheduling (default: UTC)
 */

// Load environment variables from .env file (root folder)
require('dotenv').config({ path: './.env' });

module.exports = {
    apps: [
        {
            name: 'weekly-history-worker',
            script: './server/Services/BackgroundJobs/weeklyHistoryWorker.js',
            instances: 1, // Only need 1 instance - runs once per week
            exec_mode: 'fork', // Fork mode is sufficient for single instance
            env: {
                NODE_ENV: 'production',
                TIMEZONE: process.env.TIMEZONE || 'UTC'
            },
            // Logging
            error_file: './logs/pm2-weekly-history-error.log',
            out_file: './logs/pm2-weekly-history-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            // Auto-restart on crash
            autorestart: true,
            max_restarts: 5,
            min_uptime: '10s',
            // Memory limits (this worker is lightweight)
            max_memory_restart: '512M',
            // Watch mode (disable in production)
            watch: false,
            // Cron restart - restart worker every day at midnight to ensure fresh state
            cron_restart: '0 0 * * *',
            // Environment variables
            env_production: {
                NODE_ENV: 'production'
            },
            env_development: {
                NODE_ENV: 'development'
            }
        }
    ]
};


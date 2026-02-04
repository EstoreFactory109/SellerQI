/**
 * PM2 Ecosystem Configuration - Alerts Worker
 *
 * Runs an independent cron-based worker that triggers alerts processing
 * on Sundays and Wednesdays.
 *
 * Usage:
 *   pm2 start ecosystem.alerts-worker.config.js
 *   pm2 logs alerts-worker
 *
 * Optional env:
 * - ALERTS_WORKER_CRON (default: "0 6 * * 0,3")
 * - TIMEZONE (default: "UTC")
 */

require('dotenv').config({ path: './.env' });

module.exports = {
  apps: [
    {
      name: 'alerts-worker',
      script: './server/Services/BackgroundJobs/alertsWorker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        TIMEZONE: process.env.TIMEZONE || 'UTC',
        ALERTS_WORKER_CRON: process.env.ALERTS_WORKER_CRON || '0 6 * * 0,3',
      },
      error_file: './logs/pm2-alerts-worker-error.log',
      out_file: './logs/pm2-alerts-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s',
      max_memory_restart: '768M',
      watch: false,
      // Restart daily at midnight to keep cron state fresh
      cron_restart: '0 0 * * *',
      env_production: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
    },
  ],
};


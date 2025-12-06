/**
 * PM2 Ecosystem Configuration - API Server Only
 * 
 * This configuration is for running ONLY the API server on the main EC2 instance.
 * Workers should run on separate EC2 instances using ecosystem.worker.config.js
 * 
 * Usage:
 *   pm2 start ecosystem.api.config.js
 *   pm2 stop ecosystem.api.config.js
 *   pm2 restart ecosystem.api.config.js
 *   pm2 logs ecosystem.api.config.js
 * 
 * Multi-Instance Setup:
 * ====================
 * - Main Instance: Run this config (API server only)
 * - Worker Instances: Run ecosystem.worker.config.js (workers only)
 * 
 * All instances must connect to:
 * - Shared Redis (ElastiCache) for queue: QUEUE_REDIS_HOST
 * - MongoDB: DB_URI
 * - Redis Cloud for cache: REDIS_HOST
 */

// Load environment variables from .env file (root folder)
require('dotenv').config({ path: './.env' });

module.exports = {
    apps: [
        {
            name: 'api-server',
            script: './server/index.js',
            instances: 1, // Single instance for API server
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production',
                PORT: process.env.PORT || 3000
            },
            // Logging
            error_file: './logs/pm2-api-error.log',
            out_file: './logs/pm2-api-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            // Auto-restart on crash
            autorestart: true,
            max_restarts: 10,
            min_uptime: '10s',
            // Memory limits
            max_memory_restart: '1G',
            // Watch mode (disable in production)
            watch: false,
            // Environment variables
            env_production: {
                NODE_ENV: 'production'
            },
            env_development: {
                NODE_ENV: 'development',
                watch: true
            }
        }
    ]
};


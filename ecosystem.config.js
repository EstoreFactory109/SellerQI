/**
 * PM2 Ecosystem Configuration
 * 
 * This file configures PM2 to run:
 * 1. API Server (main application)
 * 2. Worker processes (for processing queue jobs)
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 stop ecosystem.config.js
 *   pm2 restart ecosystem.config.js
 *   pm2 logs ecosystem.config.js
 * 
 * To scale workers:
 *   pm2 scale worker 5  (runs 5 worker instances)
 * 
 * Multi-Instance Deployment:
 * =========================
 * For deploying across multiple EC2 instances:
 * - Main Instance: Use ecosystem.api.config.js (API server only)
 * - Worker Instances: Use ecosystem.worker.config.js (workers only)
 * 
 * See MULTI_INSTANCE_DEPLOYMENT.md for detailed setup instructions.
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
        },
        {
            name: 'worker',
            script: './server/Services/BackgroundJobs/worker.js',
            instances: parseInt(process.env.WORKER_INSTANCES || '2', 10), // Default: 2 workers
            exec_mode: 'cluster', // Run multiple instances
            env: {
                NODE_ENV: 'production',
                WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY || '3', // Jobs per worker
                // WORKER_NAME is not set here - worker.js will use `worker-${process.pid}` as fallback
                // This ensures each worker instance has a unique identifier in merged logs
            },
            // Logging
            error_file: './logs/pm2-worker-error.log',
            out_file: './logs/pm2-worker-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            // Auto-restart on crash
            autorestart: true,
            max_restarts: 10,
            min_uptime: '10s',
            // Memory limits (workers may use more memory)
            max_memory_restart: '2G',
            // Watch mode (disable in production)
            watch: false,
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


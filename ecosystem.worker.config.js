/**
 * PM2 Ecosystem Configuration - Workers Only
 * 
 * This configuration is for running ONLY worker processes on EC2 instances.
 * The API server should run on a separate instance using ecosystem.api.config.js
 * 
 * Usage:
 *   pm2 start ecosystem.worker.config.js
 *   pm2 stop ecosystem.worker.config.js
 *   pm2 restart ecosystem.worker.config.js
 *   pm2 logs ecosystem.worker.config.js
 * 
 * Scaling Workers:
 * ===============
 * You can run multiple worker instances on the same EC2:
 *   pm2 scale worker 5  (runs 5 worker instances)
 * 
 * Or run this config on multiple EC2 instances for horizontal scaling.
 * 
 * Multi-Instance Setup:
 * ====================
 * - Main Instance: Run ecosystem.api.config.js (API server only)
 * - Worker Instances: Run this config (workers only)
 * 
 * All instances must connect to:
 * - Shared Redis (ElastiCache) for queue: QUEUE_REDIS_HOST
 * - MongoDB: DB_URI
 * - Redis Cloud for cache: REDIS_HOST
 * 
 * Environment Variables Required:
 * ==============================
 * - QUEUE_REDIS_HOST: Shared Redis endpoint (ElastiCache or external Redis)
 * - QUEUE_REDIS_PORT: Redis port (default: 6379)
 * - QUEUE_REDIS_PASSWORD: Redis password (if auth enabled)
 * - WORKER_INSTANCES: Number of worker processes per EC2
 *   - Default: 10 (for 10k users/day)
 *   - For 500 users/day: Use 5 workers
 *   - For 1k users/day: Use 10 workers
 * - WORKER_CONCURRENCY: Jobs processed concurrently per worker
 *   - Default: 15 (for 10k users/day)
 *   - For 500 users/day: Use 15 (same, fewer workers)
 *   - See SCALING_BY_USER_COUNT.md for detailed scaling guide
 * - DB_URI: MongoDB connection string
 * - DB_NAME: MongoDB database name
 * - REDIS_HOST: Redis Cloud host for cache
 * - REDIS_PASSWORD: Redis Cloud password
 */

// Load environment variables from .env file (root folder)
require('dotenv').config({ path: './.env' });

module.exports = {
    apps: [
        {
            name: 'worker',
            script: './server/Services/BackgroundJobs/worker.js',
            instances: parseInt(process.env.WORKER_INSTANCES || '10', 10), // Default: 10 workers (optimized for 10k users/day)
            exec_mode: 'cluster', // Run multiple instances
            env: {
                NODE_ENV: 'production',
                WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY || '15', // 15 jobs per worker (optimized for 10k users/day)
                WORKER_NAME: process.env.WORKER_NAME || `worker-${process.env.INSTANCE_ID || 'default'}`
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
            // Memory limits (increased for 15 concurrent jobs per worker)
            max_memory_restart: '4G',
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


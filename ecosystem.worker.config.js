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
 *   - Default: 5 (SellerQI v2 Phase 1 target for ~500 users / ~750 accounts)
 *   - For 1k users/day: Use 10 workers
 *   - For 10k users/day: Use 10 workers (per V2 doc §7) or scale horizontally
 * - WORKER_CONCURRENCY: Jobs processed concurrently per worker
 *   - Default: 15 (matches Phase 1 production target)
 *   - 5 × 15 = 75 phase-job slots → ~25% utilisation at 500-user scale
 *   - See SCALING_BY_USER_COUNT.md and SELLERQI_V2_ARCHITECTURE.md §7,9
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
            // SellerQI v2 Phase 1 default: 5 workers × 15 concurrency = 75 slots.
            // Override via WORKER_INSTANCES env var on the EC2 host.
            instances: parseInt(process.env.WORKER_INSTANCES || '5', 10),
            exec_mode: 'cluster', // Run multiple instances
            env: {
                NODE_ENV: 'production',
                WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY || '15', // 15 jobs per worker
                WORKER_SHUTDOWN_GRACE_MS: process.env.WORKER_SHUTDOWN_GRACE_MS || '120000',
                // WORKER_NAME: If set via env var, use it; otherwise worker.js will use `worker-${process.pid}`
                // This ensures each worker instance has a unique identifier in merged logs
                // For multi-instance deployments, set WORKER_NAME env var with INSTANCE_ID
                USE_SLICE_ASSEMBLER: process.env.USE_SLICE_ASSEMBLER || 'false'
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
            // Graceful shutdown timeout - should be slightly above worker grace period
            kill_timeout: parseInt(process.env.WORKER_KILL_TIMEOUT_MS || '150000', 10), // default 2.5 minutes
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


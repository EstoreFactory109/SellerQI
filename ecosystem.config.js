/**
 * PM2 Ecosystem Configuration
 * 
 * This file configures PM2 to run:
 * 1. API Server (main application)
 * 2. Worker processes (for processing queue jobs)
 * 3. Integration Worker (first-time integration jobs)
 * 4. Weekly History Worker (Sunday 23:59 UTC)
 * 5. Alerts Worker (Sunday and Wednesday 06:00 UTC)
 * 6. Delete User Worker (full user data purge after admin deletes a user)
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
                PORT: process.env.PORT || 3000,
                // Flip to 'true' once the `cron-producer` PM2 app is running.
                // When true, api-server skips registering any in-process cron
                // jobs — those are owned by cron-producer. Default 'false' keeps
                // backwards-compatible behaviour for single-process deploys.
                CRON_PRODUCER_STANDALONE: process.env.CRON_PRODUCER_STANDALONE || 'false'
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
            // SellerQI v2 Phase 1: standalone cron producer.
            //
            // Owns all cron-based scheduling that used to live inside the API:
            //   - Hourly daily-update enqueue (BullMQ producer)
            //   - JobScheduler crons (cache cleanup, health check, weekly email,
            //     trial reminders)
            //   - Email reminder cron
            //
            // Distributed lock (OrchestrationCronLockModel) ensures only one
            // tick fires per hour even if multiple instances accidentally run.
            // Keep `instances: 1` to avoid lock contention in the steady state.
            //
            // Enable by also setting CRON_PRODUCER_STANDALONE=true on the
            // api-server env above — that tells the API to skip in-process crons.
            name: 'cron-producer',
            script: './server/Services/BackgroundJobs/cronProducerStandalone.js',
            instances: 1,
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production',
                TIMEZONE: process.env.TIMEZONE || 'UTC'
            },
            error_file: './logs/pm2-cron-producer-error.log',
            out_file: './logs/pm2-cron-producer-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            autorestart: true,
            max_restarts: 20,
            min_uptime: '10s',
            max_memory_restart: '512M',
            kill_timeout: 30 * 1000,
            watch: false,
            env_production: { NODE_ENV: 'production' },
            env_development: { NODE_ENV: 'development' }
        },
        {
            // SellerQI v2 Phase 1 production target (~500 users / ~750 accounts):
            //   5 worker instances × 15 concurrency = 75 phase-job slots
            //   ≈ 7 phases × 750 accts / 24h ≈ ~220 phase-jobs/h demand vs
            //   75 slots × (60min / 5min/phase) = 900 phase-jobs/h capacity
            //   → ~25% utilisation, comfortable headroom for hot buckets.
            // Override per environment via WORKER_INSTANCES / WORKER_CONCURRENCY.
            name: 'worker',
            script: './server/Services/BackgroundJobs/worker.js',
            instances: parseInt(process.env.WORKER_INSTANCES || '5', 10), // Default: 5 workers (was 2)
            exec_mode: 'cluster', // Run multiple instances
            env: {
                NODE_ENV: 'production',
                WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY || '15', // Jobs per worker (was 3)
                WORKER_SHUTDOWN_GRACE_MS: process.env.WORKER_SHUTDOWN_GRACE_MS || '120000',
                // WORKER_NAME is not set here - worker.js will use `worker-${process.pid}` as fallback
                // This ensures each worker instance has a unique identifier in merged logs
                // Slice assembler flag (default off — finalize uses legacy Analyse path).
                // Flip to 'true' once slice payloads have been verified to match
                // the React dashboard's expected shape. See ScheduledIntegration.js.
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
            // Memory limits (workers may use more memory)
            max_memory_restart: '2G',
            // Graceful shutdown timeout - should be slightly above worker grace period
            kill_timeout: parseInt(process.env.WORKER_KILL_TIMEOUT_MS || '150000', 10), // default 2.5 minutes
            // Watch mode (disable in production)
            watch: false,
            // Environment variables
            env_production: {
                NODE_ENV: 'production'
            },
            env_development: {
                NODE_ENV: 'development'
            }
        },
        {
            // Integration Worker - SEPARATE from scheduled workers
            // Handles first-time Integration.getSpApiData() jobs
            // Uses separate queue: 'user-integration'
            //
            // SellerQI v2 Phase 1 production target: 1 instance × 2 concurrency.
            // First-time integrations are bursty (new signups) but rare relative
            // to scheduled phases. 2 concurrent integrations is enough to clear
            // a 500-user onboarding rate while keeping memory pressure low
            // (integration jobs are 3GB-capped, see max_memory_restart).
            name: 'integration-worker',
            script: './server/Services/BackgroundJobs/integrationWorker.js',
            instances: parseInt(process.env.INTEGRATION_WORKER_INSTANCES || '1', 10), // Default: 1 worker
            exec_mode: 'cluster', // Run multiple instances if needed
            env: {
                NODE_ENV: 'production',
                INTEGRATION_WORKER_CONCURRENCY: process.env.INTEGRATION_WORKER_CONCURRENCY || '2', // Jobs per worker
                INTEGRATION_WORKER_SHUTDOWN_GRACE_MS:
                    process.env.INTEGRATION_WORKER_SHUTDOWN_GRACE_MS || '120000',
            },
            // Logging - separate log files
            error_file: './logs/pm2-integration-worker-error.log',
            out_file: './logs/pm2-integration-worker-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            // Auto-restart on crash
            autorestart: true,
            max_restarts: 10,
            min_uptime: '10s',
            // Memory limits (integration jobs are heavier)
            max_memory_restart: '3G',
            // Graceful shutdown timeout - should be slightly above worker grace period
            kill_timeout: parseInt(process.env.INTEGRATION_WORKER_KILL_TIMEOUT_MS || '150000', 10), // default 2.5 minutes
            // Watch mode (disable in production)
            watch: false,
            // Environment variables
            env_production: {
                NODE_ENV: 'production'
            },
            env_development: {
                NODE_ENV: 'development'
            }
        },
        {
            // Weekly History Worker
            // Runs every Sunday at 11:59 PM UTC to record weekly account history snapshots
            name: 'weekly-history-worker',
            script: './server/Services/BackgroundJobs/weeklyHistoryWorker.js',
            instances: 1, // Single instance (cron-based, doesn't need clustering)
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production'
            },
            // Logging - separate log files
            error_file: './logs/pm2-weekly-history-error.log',
            out_file: './logs/pm2-weekly-history-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            // Auto-restart on crash
            autorestart: true,
            max_restarts: 10,
            min_uptime: '10s',
            // Memory limits
            max_memory_restart: '2G',
            // Graceful shutdown timeout (30 seconds for cron-based worker)
            kill_timeout: 30 * 1000,
            // Watch mode (disable in production)
            watch: false,
            // Environment variables
            env_production: {
                NODE_ENV: 'production'
            },
            env_development: {
                NODE_ENV: 'development'
            }
        },
        {
            // Alerts Worker - Runs Mon/Wed/Fri at 06:00 UTC (cron: 0 6 * * 1,3,5)
            // Runs all alert services and sends a single summary email per subscribed user
            name: 'alerts-worker',
            script: './server/Services/BackgroundJobs/alertsWorker.js',
            instances: 1,
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production',
                TIMEZONE: process.env.TIMEZONE || 'UTC',
                ALERTS_WORKER_CRON: process.env.ALERTS_WORKER_CRON || '0 6 * * 1,3,5',
            },
            error_file: './logs/pm2-alerts-worker-error.log',
            out_file: './logs/pm2-alerts-worker-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            autorestart: true,
            max_restarts: 50,
            restart_delay: 5000,
            min_uptime: '10s',
            max_memory_restart: '768M',
            kill_timeout: 30 * 1000,
            watch: false,
            env_production: {
                NODE_ENV: 'production'
            },
            env_development: {
                NODE_ENV: 'development'
            }
        },
        {
            // Delete User Worker - processes 'full-user-data-deletion' queue
            // Purges all remaining user data after User + Seller are deleted (hybrid delete flow)
            name: 'delete-user-worker',
            script: './server/Services/BackgroundJobs/deleteUserWorker.js',
            instances: 1,
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production',
                DELETE_USER_WORKER_CONCURRENCY: process.env.DELETE_USER_WORKER_CONCURRENCY || '1',
            },
            error_file: './logs/pm2-delete-user-worker-error.log',
            out_file: './logs/pm2-delete-user-worker-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            autorestart: true,
            max_restarts: 10,
            min_uptime: '10s',
            max_memory_restart: '512M',
            kill_timeout: 60 * 60 * 1000, // 1 hour (purge jobs can run long)
            watch: false,
            env_production: {
                NODE_ENV: 'production'
            },
            env_development: {
                NODE_ENV: 'development'
            }
        }
    ]
};


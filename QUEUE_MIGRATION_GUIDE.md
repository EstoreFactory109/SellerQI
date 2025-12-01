# Queue-Based Architecture Migration Guide

## Overview

This guide explains how to migrate from the old hourly batch processing system to the new queue-based architecture using BullMQ.

## Architecture Changes

### Old System
- **Cron Job**: Runs every hour, processes users directly in batches
- **Blocking**: API server blocked during processing
- **No Retries**: Failed jobs not automatically retried
- **No Scalability**: Fixed batch size, can't scale workers

### New System
- **Cron Producer**: Runs every hour, ONLY enqueues user IDs
- **Workers**: Separate processes pull jobs from queue and process them
- **Non-Blocking**: API server never blocked by background jobs
- **Auto Retries**: Failed jobs automatically retried with exponential backoff
- **Scalable**: Add more workers via PM2 as user count grows

## Prerequisites

1. **Node.js** (v16+)
2. **PM2** installed globally: `npm install -g pm2`
3. **Redis Cloud** already connected (no changes needed)
4. **MongoDB** connection (no changes needed)

## Installation Steps

### 1. Install Dependencies

```bash
cd server
npm install bullmq
```

### 2. Environment Variables

Add these to your `.env` file (if not already present):

```env
# Redis Cloud (existing - no changes)
REDIS_HOST=your-redis-host.redis.cloud
REDIS_PASSWORD=your-redis-password

# Worker Configuration (new)
WORKER_CONCURRENCY=3          # Jobs processed concurrently per worker
WORKER_INSTANCES=2             # Number of worker processes (start with 2)

# Optional
TIMEZONE=UTC                   # Timezone for cron jobs
```

### 3. Database Migration

The new system uses a `JobStatus` model. MongoDB will create the collection automatically on first use. No manual migration needed.

### 4. Update Code

The following files have been created/updated:

**New Files:**
- `server/Services/BackgroundJobs/processUserData.js` - Core business logic wrapper
- `server/config/queueRedisConn.js` - Redis connection for BullMQ
- `server/Services/BackgroundJobs/queue.js` - BullMQ queue setup
- `server/Services/BackgroundJobs/producer.js` - Job enqueuing
- `server/Services/BackgroundJobs/worker.js` - Job processing worker
- `server/Services/BackgroundJobs/cronProducer.js` - Cron job that enqueues users
- `server/models/system/JobStatusModel.js` - Job status tracking
- `server/controllers/system/JobStatusController.js` - API endpoints
- `server/routes/jobStatus.routes.js` - Job status routes
- `ecosystem.config.js` - PM2 configuration

**Updated Files:**
- `server/api/app.js` - Uses new cron producer instead of old batch processing

### 5. Start Services with PM2

```bash
# Start both API server and workers
pm2 start ecosystem.config.js

# Check status
pm2 status

# View logs
pm2 logs

# View logs for specific app
pm2 logs api-server
pm2 logs worker
```

### 6. Verify Setup

1. **Check API server is running:**
   ```bash
   curl http://localhost:3000/app/job-status/queue/stats
   ```

2. **Check workers are processing jobs:**
   ```bash
   pm2 logs worker --lines 50
   ```

3. **Monitor queue:**
   - Wait for the next hour (cron runs at minute 0)
   - Check queue stats: `GET /app/job-status/queue/stats`
   - Check job status: `GET /app/job-status/status/user/:userId`

## Scaling Workers

As your user count grows, increase the number of workers:

### Option 1: Update PM2 Config

Edit `ecosystem.config.js`:
```javascript
{
    name: 'worker',
    instances: 5, // Increase from 2 to 5
    ...
}
```

Then restart:
```bash
pm2 restart ecosystem.config.js
```

### Option 2: Scale Dynamically

```bash
# Scale to 5 workers
pm2 scale worker 5

# Scale to 10 workers
pm2 scale worker 10
```

### Recommended Worker Count

- **200 users**: 2 workers
- **1,000 users**: 3-5 workers
- **5,000 users**: 5-10 workers
- **10,000+ users**: 10-20 workers

**Formula**: `workers = Math.ceil(totalUsers / 1000) * 2`

## Monitoring

### Queue Statistics

```bash
GET /app/job-status/queue/stats
```

Returns:
```json
{
  "waiting": 10,
  "active": 3,
  "completed": 150,
  "failed": 2,
  "delayed": 0,
  "total": 165
}
```

### Job Status by User

```bash
GET /app/job-status/status/user/:userId
```

### Recent Jobs

```bash
GET /app/job-status/recent?limit=50&status=completed
```

### Failed Jobs

```bash
GET /app/job-status/failed?limit=100
```

## Migration from Old System

### Step 1: Deploy New Code

1. Deploy all new files
2. Install `bullmq` dependency
3. Update `.env` with worker config
4. **DO NOT** start workers yet

### Step 2: Enable New Cron Producer

The new cron producer will start automatically when the API server starts. It will:
- Enqueue users every hour (same schedule as before)
- NOT process them (workers will do that)

### Step 3: Start Workers

```bash
pm2 start ecosystem.config.js
```

Workers will start processing jobs from the queue.

### Step 4: Monitor

Monitor for 24 hours to ensure:
- Jobs are being enqueued (check queue stats)
- Jobs are being processed (check worker logs)
- No duplicate processing (check job status)
- Failed jobs are retrying (check failed jobs endpoint)

### Step 5: Disable Old System

Once verified, you can disable the old batch processing in `server/config/config.js`:

```javascript
const backgroundJobsConfig = {
    enabled: true,
    jobs: {
        dailyUpdates: false, // Disable old batch processing
        cacheCleanup: true,
        healthCheck: true,
        weeklyEmail: true,
        trialReminder: true
    }
}
```

## Troubleshooting

### Workers Not Processing Jobs

1. Check Redis connection:
   ```bash
   pm2 logs worker | grep -i redis
   ```

2. Check queue has jobs:
   ```bash
   curl http://localhost:3000/app/job-status/queue/stats
   ```

3. Check worker is running:
   ```bash
   pm2 status
   ```

### Jobs Stuck in "Waiting" State

1. Check worker logs for errors
2. Check Redis connection
3. Restart workers: `pm2 restart worker`

### High Memory Usage

1. Reduce `WORKER_CONCURRENCY` in `.env`
2. Reduce number of worker instances
3. Check for memory leaks in `processUserData`

### Duplicate Jobs

The producer automatically detects duplicate jobs. If you see duplicates:
1. Check producer logs
2. Verify `enqueueUser` is being called correctly
3. Check for multiple cron jobs running

## Performance Tuning

### Worker Concurrency

`WORKER_CONCURRENCY` controls how many jobs each worker processes simultaneously.

- **Low (1-2)**: Better for slow users, less memory usage
- **Medium (3-5)**: Balanced (recommended)
- **High (10+)**: Faster processing, higher memory usage

### Batch Size

The producer processes users in batches of 50. For large user counts, you can increase this in `cronProducer.js`:

```javascript
const enqueueResult = await enqueueUsers(userIds, {
    batchSize: 100, // Increase from 50
    ...
});
```

## API Endpoints

### User Endpoints (Require Auth)

- `GET /app/job-status/status/user/:userId` - Get job status for a user

### Admin Endpoints (Require Admin Auth)

- `GET /app/job-status/status/job/:jobId` - Get job status by job ID
- `GET /app/job-status/recent?limit=50&status=completed` - Get recent jobs
- `GET /app/job-status/queue/stats` - Get queue statistics
- `GET /app/job-status/failed?limit=100` - Get failed jobs

## Rollback Plan

If you need to rollback:

1. Stop workers: `pm2 stop worker`
2. Revert `server/api/app.js` to use old `JobScheduler`
3. Restart API server: `pm2 restart api-server`
4. Old system will resume hourly batch processing

## Support

For issues or questions:
1. Check worker logs: `pm2 logs worker`
2. Check queue stats: `GET /app/job-status/queue/stats`
3. Check failed jobs: `GET /app/job-status/failed`


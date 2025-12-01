# Queue-Based Architecture Summary

## Overview

This document provides a high-level overview of the new queue-based architecture for automatic user data fetching.

## Architecture Components

### 1. **processUserData.js** - Core Business Logic
- **Location**: `server/Services/BackgroundJobs/processUserData.js`
- **Purpose**: Wrapper function that processes ALL seller accounts for a single user
- **Called by**: Workers only
- **What it does**:
  1. Fetches user's seller accounts
  2. For each account (country/region):
     - Calls `Integration.getSpApiData(userId, region, country)`
     - Calls `AnalyseService.Analyse(userId, country, region)`
     - Updates Redis cache
     - Marks update as complete

### 2. **queue.js** - BullMQ Queue Setup
- **Location**: `server/Services/BackgroundJobs/queue.js`
- **Purpose**: Creates and configures the BullMQ queue
- **Key Features**:
  - Uses existing Redis Cloud connection (no duplicate clients)
  - Namespaced keys (`bullmq:`) to avoid cache conflicts
  - Automatic retries with exponential backoff
  - Job persistence across restarts
  - Progress tracking

### 3. **producer.js** - Job Enqueuing
- **Location**: `server/Services/BackgroundJobs/producer.js`
- **Purpose**: Adds jobs to the queue
- **Functions**:
  - `enqueueUser(userId)` - Enqueue single user
  - `enqueueUsers(userIds)` - Bulk enqueue
  - `getQueueStats()` - Queue statistics
  - `removeJob(jobId)` - Cancel a job

### 4. **worker.js** - Job Processing
- **Location**: `server/Services/BackgroundJobs/worker.js`
- **Purpose**: Processes jobs from the queue
- **Runs in**: Separate process (via PM2)
- **What it does**:
  1. Pulls jobs from queue
  2. Calls `processUserData(userId)`
  3. Updates job status in database
  4. Handles retries automatically

### 5. **cronProducer.js** - Hourly Enqueue Job
- **Location**: `server/Services/BackgroundJobs/cronProducer.js`
- **Purpose**: Replaces old batch processing cron
- **What it does**:
  - Runs every hour (same schedule as before)
  - Gets users needing updates
  - **ONLY enqueues user IDs** (never processes)
  - Returns immediately (non-blocking)

### 6. **JobStatusModel.js** - Job Tracking
- **Location**: `server/models/system/JobStatusModel.js`
- **Purpose**: MongoDB model for tracking job execution
- **Tracks**:
  - Job ID, User ID, Status
  - Timestamps (started, completed, failed)
  - Execution details (duration, accounts processed, errors)

### 7. **JobStatusController.js** - API Endpoints
- **Location**: `server/controllers/system/JobStatusController.js`
- **Endpoints**:
  - `GET /app/job-status/status/user/:userId` - Get user's job status
  - `GET /app/job-status/status/job/:jobId` - Get job by ID
  - `GET /app/job-status/recent` - Recent jobs
  - `GET /app/job-status/queue/stats` - Queue statistics
  - `GET /app/job-status/failed` - Failed jobs

## Data Flow

```
1. CRON (Every Hour)
   └─> cronProducer.js
       └─> Gets users needing updates
       └─> producer.enqueueUser() for each user
           └─> Adds job to BullMQ queue

2. WORKER (Separate Process)
   └─> worker.js pulls job from queue
       └─> Calls processUserData(userId)
           └─> For each seller account:
               ├─> Integration.getSpApiData()
               ├─> AnalyseService.Analyse()
               ├─> Update Redis cache
               └─> Mark update complete
       └─> Updates JobStatus in database
```

## Key Benefits

1. **Non-Blocking**: API server never blocked by background jobs
2. **Scalable**: Add more workers as user count grows
3. **Resilient**: Automatic retries, crash-safe, persists across restarts
4. **Observable**: Job status tracking, queue statistics, failed job inspection
5. **Efficient**: Slow users don't block fast users (parallel processing)

## Configuration

### Environment Variables

```env
# Redis (existing)
REDIS_HOST=your-redis-host.redis.cloud
REDIS_PASSWORD=your-redis-password

# Workers (new)
WORKER_CONCURRENCY=3      # Jobs per worker
WORKER_INSTANCES=2        # Number of workers
```

### PM2 Configuration

See `ecosystem.config.js`:
- **api-server**: 1 instance (API)
- **worker**: 2+ instances (job processing)

## Scaling Guide

| Users | Workers | Concurrency | Total Capacity |
|-------|---------|-------------|----------------|
| 200   | 2       | 3           | 6 jobs/min     |
| 1,000 | 3-5     | 3           | 9-15 jobs/min  |
| 5,000 | 5-10    | 3           | 15-30 jobs/min |
| 10,000+| 10-20   | 3           | 30-60 jobs/min |

**Formula**: `workers = Math.ceil(totalUsers / 1000) * 2`

## Monitoring

### Queue Statistics
```bash
GET /app/job-status/queue/stats
```

### Job Status
```bash
GET /app/job-status/status/user/:userId
```

### Failed Jobs
```bash
GET /app/job-status/failed?limit=100
```

### PM2 Logs
```bash
pm2 logs worker
pm2 logs api-server
```

## Migration Checklist

- [x] Install `bullmq` dependency
- [x] Add worker environment variables
- [x] Deploy all new files
- [x] Start workers with PM2
- [x] Monitor for 24 hours
- [ ] Disable old batch processing (once verified)
- [ ] Scale workers as needed

## File Structure

```
server/
├── Services/
│   └── BackgroundJobs/
│       ├── processUserData.js      # Core business logic
│       ├── queue.js                 # BullMQ queue setup
│       ├── producer.js              # Job enqueuing
│       ├── worker.js                 # Job processing
│       └── cronProducer.js           # Hourly enqueue cron
├── config/
│   └── queueRedisConn.js            # Redis connection for BullMQ
├── models/
│   └── system/
│       └── JobStatusModel.js         # Job tracking model
├── controllers/
│   └── system/
│       └── JobStatusController.js    # API endpoints
└── routes/
    └── jobStatus.routes.js           # Job status routes

ecosystem.config.js                   # PM2 configuration
QUEUE_MIGRATION_GUIDE.md              # Detailed migration guide
```

## Important Notes

1. **Workers MUST run in separate processes** - Never import `worker.js` in API server
2. **Cron ONLY enqueues** - Never processes jobs directly
3. **Redis connection is reused** - No duplicate clients
4. **Jobs persist across restarts** - BullMQ stores jobs in Redis
5. **Automatic retries** - Failed jobs retry up to 3 times with exponential backoff

## Support

For detailed setup instructions, see `QUEUE_MIGRATION_GUIDE.md`.


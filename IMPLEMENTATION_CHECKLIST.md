# Implementation Checklist

## Files Created

### Core Queue System
- ✅ `server/Services/BackgroundJobs/processUserData.js` - Core business logic wrapper
- ✅ `server/config/queueRedisConn.js` - Redis connection for BullMQ (reuses existing)
- ✅ `server/Services/BackgroundJobs/queue.js` - BullMQ queue setup
- ✅ `server/Services/BackgroundJobs/producer.js` - Job enqueuing functions
- ✅ `server/Services/BackgroundJobs/worker.js` - Worker process (runs separately)
- ✅ `server/Services/BackgroundJobs/cronProducer.js` - Hourly cron that enqueues users

### Database & API
- ✅ `server/models/system/JobStatusModel.js` - Job status tracking model
- ✅ `server/controllers/system/JobStatusController.js` - API endpoints for job status
- ✅ `server/routes/jobStatus.routes.js` - Job status routes

### Configuration & Documentation
- ✅ `ecosystem.config.js` - PM2 configuration
- ✅ `QUEUE_MIGRATION_GUIDE.md` - Detailed migration guide
- ✅ `QUEUE_ARCHITECTURE_SUMMARY.md` - Architecture overview
- ✅ `QUICK_START.md` - Quick setup guide
- ✅ `IMPLEMENTATION_CHECKLIST.md` - This file

### Files Modified
- ✅ `server/api/app.js` - Updated to use new cron producer
- ✅ `server/Services/BackgroundJobs/JobScheduler.js` - Disabled old daily update job

## Installation Steps

### 1. Install Dependencies

```bash
cd server
npm install bullmq
```

**Note**: Your `package.json` currently only shows `dotenv`. Make sure you have all other dependencies installed (express, mongoose, redis, etc.). The `bullmq` package is the only new dependency needed.

### 2. Environment Variables

Add to your `.env` file:

```env
# Worker Configuration (NEW)
WORKER_CONCURRENCY=3
WORKER_INSTANCES=2

# Existing Redis (no changes needed)
REDIS_HOST=your-redis-host.redis.cloud
REDIS_PASSWORD=your-redis-password
```

### 3. Database

No migration needed! The `JobStatus` collection will be created automatically on first use.

### 4. Start Services

```bash
# Install PM2 globally if not already installed
npm install -g pm2

# Start both API server and workers
pm2 start ecosystem.config.js

# Check status
pm2 status

# View logs
pm2 logs
```

### 5. Verify Setup

1. **Check API server is running:**
   ```bash
   curl http://localhost:3000/app/job-status/queue/stats
   ```
   (Requires authentication - use your auth token)

2. **Check workers are running:**
   ```bash
   pm2 logs worker --lines 20
   ```
   Should see: `[Worker:worker-XXXX] Worker started with concurrency: 3`

3. **Wait for next hour** (cron runs at minute 0) or manually test:
   - Check `cronProducer.js` for `manualEnqueue()` function
   - Or use the producer API if you create an endpoint

## Testing Checklist

- [ ] Workers start successfully
- [ ] Queue connects to Redis
- [ ] Cron enqueues users (check at next hour)
- [ ] Workers process jobs
- [ ] Job status saved to database
- [ ] Failed jobs retry automatically
- [ ] API endpoints return job status
- [ ] No duplicate processing
- [ ] Slow users don't block fast users

## Migration Steps

### Phase 1: Deploy (No Impact)
1. Deploy all new files
2. Install `bullmq`
3. Add environment variables
4. **DO NOT start workers yet**

### Phase 2: Enable New System
1. Restart API server (new cron producer will start)
2. Start workers: `pm2 start ecosystem.config.js`
3. Monitor for 24 hours

### Phase 3: Verify
1. Check queue stats show jobs
2. Check workers are processing
3. Check job status API works
4. Verify no duplicate processing

### Phase 4: Disable Old System
Once verified, in `server/config/config.js`:

```javascript
const backgroundJobsConfig = {
    enabled: true,
    jobs: {
        dailyUpdates: false, // Disable old batch processing
        // ... other jobs
    }
}
```

## Scaling Guide

| Users | Workers | Command |
|-------|---------|----------|
| 200   | 2       | `pm2 scale worker 2` |
| 1,000 | 3-5     | `pm2 scale worker 5` |
| 5,000 | 5-10    | `pm2 scale worker 10` |
| 10,000+| 10-20   | `pm2 scale worker 20` |

## Monitoring Commands

```bash
# Queue statistics
curl http://localhost:3000/app/job-status/queue/stats

# User job status
curl http://localhost:3000/app/job-status/status/user/:userId

# Recent jobs
curl http://localhost:3000/app/job-status/recent?limit=50

# Failed jobs
curl http://localhost:3000/app/job-status/failed?limit=100

# PM2 status
pm2 status

# Worker logs
pm2 logs worker

# API server logs
pm2 logs api-server
```

## Troubleshooting

### Workers Not Starting
- Check Redis connection: `pm2 logs worker | grep -i redis`
- Verify environment variables are set
- Check `ecosystem.config.js` paths are correct

### Jobs Not Processing
- Check workers are running: `pm2 status`
- Check queue has jobs: `GET /app/job-status/queue/stats`
- Check worker logs: `pm2 logs worker`

### High Memory Usage
- Reduce `WORKER_CONCURRENCY` in `.env`
- Reduce worker instances
- Check for memory leaks in `processUserData`

### Duplicate Jobs
- Producer automatically detects duplicates
- Check for multiple cron jobs running
- Verify `enqueueUser` is not called multiple times

## Rollback Plan

If you need to rollback:

1. Stop workers: `pm2 stop worker`
2. Revert `server/api/app.js` changes
3. Restart API server: `pm2 restart api-server`
4. Old system will resume

## Support

- **Detailed Guide**: See `QUEUE_MIGRATION_GUIDE.md`
- **Architecture**: See `QUEUE_ARCHITECTURE_SUMMARY.md`
- **Quick Start**: See `QUICK_START.md`

## Next Steps

1. ✅ Review all created files
2. ✅ Install `bullmq` dependency
3. ✅ Add environment variables
4. ✅ Test in development environment
5. ✅ Deploy to production
6. ✅ Monitor for 24 hours
7. ✅ Scale workers as needed


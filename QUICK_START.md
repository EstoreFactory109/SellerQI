# Quick Start Guide - Queue-Based Architecture

## 1. Install Dependencies

```bash
cd server
npm install bullmq
```

## 2. Update Environment Variables

Add to your `.env` file:

```env
# Worker Configuration
WORKER_CONCURRENCY=3
WORKER_INSTANCES=2
```

## 3. Start Services

```bash
# Start both API server and workers
pm2 start ecosystem.config.js

# Check status
pm2 status

# View logs
pm2 logs
```

## 4. Verify It's Working

```bash
# Check queue stats (requires auth)
curl http://localhost:3000/app/job-status/queue/stats

# Check worker logs
pm2 logs worker --lines 50
```

## 5. Scale Workers (as needed)

```bash
# Scale to 5 workers
pm2 scale worker 5
```

## That's It!

The system will:
- ✅ Enqueue users every hour (cron)
- ✅ Process jobs automatically (workers)
- ✅ Retry failed jobs automatically
- ✅ Track job status in database

## Monitoring

- **Queue Stats**: `GET /app/job-status/queue/stats`
- **User Job Status**: `GET /app/job-status/status/user/:userId`
- **Failed Jobs**: `GET /app/job-status/failed`
- **PM2 Logs**: `pm2 logs worker`

## Troubleshooting

**Workers not processing?**
```bash
pm2 logs worker | grep -i error
```

**No jobs in queue?**
- Wait for next hour (cron runs at minute 0)
- Or manually trigger: Check `cronProducer.js` for manual enqueue function

**High memory usage?**
- Reduce `WORKER_CONCURRENCY` in `.env`
- Reduce worker instances: `pm2 scale worker 2`

For detailed information, see `QUEUE_MIGRATION_GUIDE.md`.


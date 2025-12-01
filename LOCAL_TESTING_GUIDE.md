# Local Testing Guide - Queue System

## Quick Start (2 Terminals)

### Terminal 1: Start API Server

```bash
# Make sure you're in project root
cd /Users/ankanmandal/Documents/IBEX

# Start API server (with nodemon or npm run dev)
npm run dev
# OR
nodemon server/index.js
```

**What you should see:**
```
✅ Connected to Redis Cloud!
✅ Queue-based daily update cron producer initialized (enqueues users only)
⚠️  IMPORTANT: Workers must be running separately (via PM2) to process jobs
Server started on port 3000
```

### Terminal 2: Start Worker

```bash
# In a new terminal, navigate to project root
cd /Users/ankanmandal/Documents/IBEX

# Start worker
node server/Services/BackgroundJobs/worker.js
```

**What you should see:**
```
[Worker:worker-XXXX] Worker started with concurrency: 3
```

## Testing the Queue System

### Option 1: Wait for Cron (Automatic)

The cron runs every hour at minute 0. So if it's 2:30 PM, wait until 3:00 PM.

**Check logs:**
```bash
# Terminal 1 (API Server) - Should see:
[CronProducer] Running hourly enqueue job
[CronProducer] Found X users needing daily updates
[CronProducer] Enqueuing X users for processing

# Terminal 2 (Worker) - Should see:
[Worker:worker-XXXX] Starting job job-123 for user user456
[Worker:worker-XXXX] Job job-123 completed successfully
```

### Option 2: Manually Enqueue a User (Immediate Testing)

Create a test script to enqueue a user immediately:

**Create `test-enqueue.js` in root:**

```javascript
// test-enqueue.js
require('dotenv').config();
const { enqueueUser } = require('./server/Services/BackgroundJobs/producer.js');

async function test() {
    try {
        // Replace with a real user ID from your database
        const testUserId = 'YOUR_USER_ID_HERE'; // MongoDB ObjectId
        
        console.log(`🚀 Enqueuing test user: ${testUserId}`);
        const result = await enqueueUser(testUserId, {
            enqueuedBy: 'manual-test'
        });
        
        console.log('✅ Result:', result);
        
        if (result.success) {
            console.log(`✅ User enqueued successfully! Job ID: ${result.jobId}`);
            console.log('👀 Watch Terminal 2 (worker) to see it process...');
        } else {
            console.log('⚠️  User already has a job in queue');
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
    process.exit(0);
}

test();
```

**Run it:**
```bash
node test-enqueue.js
```

**Then watch Terminal 2 (worker) - you should see it start processing immediately!**

### Option 3: Check Queue Status

**Via API (if you have auth):**
```bash
curl http://localhost:3000/app/job-status/queue/stats
```

**Or create a simple test script:**

```javascript
// test-queue-stats.js
require('dotenv').config();
const { getQueueStats } = require('./server/Services/BackgroundJobs/producer.js');

async function test() {
    try {
        const stats = await getQueueStats();
        console.log('📊 Queue Statistics:');
        console.log(JSON.stringify(stats, null, 2));
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
    process.exit(0);
}

test();
```

Run: `node test-queue-stats.js`

## Step-by-Step Testing Process

### 1. Start Both Services

**Terminal 1:**
```bash
npm run dev
```

**Terminal 2:**
```bash
node server/Services/BackgroundJobs/worker.js
```

### 2. Verify They're Running

**Check Terminal 1:**
- ✅ Server started on port 3000
- ✅ Cron producer initialized

**Check Terminal 2:**
- ✅ Worker started with concurrency: 3

### 3. Enqueue a Test User

**Option A: Use test script (recommended)**
```bash
# Edit test-enqueue.js with a real user ID
node test-enqueue.js
```

**Option B: Wait for next hour**
- Check current time
- Wait until minute 0 (e.g., 3:00 PM, 4:00 PM)

### 4. Watch Processing

**Terminal 2 should show:**
```
[Worker:worker-XXXX] Starting job job-123 for user user456
[processUserData] Starting data processing for user user456
[processUserData] Processing account US-NA for user user456
[processUserData] Fetching API data for user user456, US-NA
[processUserData] Successfully processed account US-NA for user user456
[Worker:worker-XXXX] Job job-123 completed successfully
```

### 5. Verify Completion

**Check job status:**
```bash
# Via API (if you have auth token)
curl http://localhost:3000/app/job-status/status/user/YOUR_USER_ID
```

## Testing Multiple Workers Locally

If you want to test with multiple workers:

**Terminal 2:**
```bash
WORKER_NAME=worker-1 node server/Services/BackgroundJobs/worker.js
```

**Terminal 3:**
```bash
WORKER_NAME=worker-2 node server/Services/BackgroundJobs/worker.js
```

**Terminal 4:**
```bash
WORKER_NAME=worker-3 node server/Services/BackgroundJobs/worker.js
```

Each worker will process jobs independently!

## Testing with Different Concurrency

**Terminal 2:**
```bash
WORKER_CONCURRENCY=5 node server/Services/BackgroundJobs/worker.js
```

This worker will process 5 jobs simultaneously instead of 3.

## Common Issues & Solutions

### Issue: "Cannot find module 'bullmq'"
**Solution:**
```bash
cd server
npm install bullmq
```

### Issue: "Redis connection error"
**Solution:**
- Check `.env` has `REDIS_HOST` and `REDIS_PASSWORD`
- Verify Redis Cloud is accessible

### Issue: "Worker not processing jobs"
**Solution:**
- Check queue has jobs: `node test-queue-stats.js`
- Check worker logs for errors
- Verify Redis connection

### Issue: "No users enqueued"
**Solution:**
- Wait for next hour (cron runs at :00)
- Or manually enqueue: `node test-enqueue.js`
- Check if users have `dailyUpdateHour` assigned

## Quick Test Checklist

- [ ] API server running (Terminal 1)
- [ ] Worker running (Terminal 2)
- [ ] Redis connected (check logs)
- [ ] Queue initialized (check logs)
- [ ] Enqueued a test user (manual or wait for cron)
- [ ] Worker picked up job (Terminal 2 logs)
- [ ] Job completed successfully (Terminal 2 logs)

## Monitoring Commands

```bash
# Check queue stats
node test-queue-stats.js

# Check job status (via API)
curl http://localhost:3000/app/job-status/status/user/USER_ID

# Watch worker logs in real-time
# (Just watch Terminal 2)

# Watch API server logs in real-time
# (Just watch Terminal 1)
```

## Next Steps After Local Testing

Once local testing works:
1. Deploy to EC2
2. Use PM2: `pm2 start ecosystem.config.js`
3. Monitor with: `pm2 logs` and `pm2 status`


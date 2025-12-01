# Local Development Guide - Queue System

## Running Workers Locally (Without PM2)

For local development, you don't need PM2. You can run workers directly with Node.js.

### Option 1: Run Worker Directly (Recommended for Local)

```bash
# Terminal 1: Start API server (as usual)
npm run dev
# or
nodemon server/index.js

# Terminal 2: Start worker
node server/Services/BackgroundJobs/worker.js
```

### Option 2: Run Multiple Workers Locally

If you want to test with multiple workers:

```bash
# Terminal 1: API server
npm run dev

# Terminal 2: Worker 1
WORKER_NAME=worker-1 node server/Services/BackgroundJobs/worker.js

# Terminal 3: Worker 2
WORKER_NAME=worker-2 node server/Services/BackgroundJobs/worker.js
```

### Option 3: Use PM2 Locally (Optional)

You can still use PM2 locally if you prefer:

```bash
# Start everything with PM2
pm2 start ecosystem.config.js

# View logs
pm2 logs

# Stop everything
pm2 stop ecosystem.config.js
```

## Environment Variables for Local Development

Make sure your `.env` file has:

```env
# Redis (required)
REDIS_HOST=your-redis-host.redis.cloud
REDIS_PASSWORD=your-redis-password

# Worker Configuration (optional - defaults shown)
WORKER_CONCURRENCY=3
WORKER_INSTANCES=1  # Not used when running directly with node
```

## Testing the Queue System Locally

### 1. Start API Server
```bash
npm run dev
```

### 2. Start Worker
```bash
node server/Services/BackgroundJobs/worker.js
```

You should see:
```
[Worker:worker-XXXX] Worker started with concurrency: 3
```

### 3. Manually Enqueue a User (for testing)

You can create a test script or use the API if you have an endpoint. Or wait for the hourly cron to enqueue users.

### 4. Monitor Queue

Check queue stats via API:
```bash
GET /app/job-status/queue/stats
```

Or check worker logs to see jobs being processed.

## Differences: Local vs Production

| Aspect | Local Development | Production |
|--------|------------------|------------|
| **API Server** | `npm run dev` or `nodemon` | PM2 (`api-server`) |
| **Workers** | `node worker.js` (manual) | PM2 (`worker` instances) |
| **Scaling** | Manual (open more terminals) | `pm2 scale worker 5` |
| **Auto-restart** | Manual restart | PM2 auto-restarts |
| **Logs** | Console output | PM2 logs |

## Quick Test Script

Create `test-worker.js` in the root:

```javascript
// test-worker.js
const { enqueueUser } = require('./server/Services/BackgroundJobs/producer.js');

async function test() {
    try {
        // Replace with a real user ID from your database
        const testUserId = 'YOUR_TEST_USER_ID';
        
        console.log(`Enqueuing test user: ${testUserId}`);
        const result = await enqueueUser(testUserId);
        console.log('Result:', result);
    } catch (error) {
        console.error('Error:', error);
    }
    process.exit(0);
}

test();
```

Run it:
```bash
node test-worker.js
```

Then watch your worker process the job!

## Troubleshooting Local Development

### Worker Not Processing Jobs?

1. **Check Redis connection:**
   ```bash
   # In worker terminal, you should see connection logs
   ```

2. **Check queue has jobs:**
   ```bash
   # Use API endpoint or check Redis directly
   ```

3. **Check worker is running:**
   ```bash
   # Worker terminal should show: "Worker started with concurrency: 3"
   ```

### Jobs Stuck?

- Check worker logs for errors
- Verify Redis is accessible
- Make sure `processUserData` function is working

### Multiple Workers Conflict?

- Each worker should have a unique `WORKER_NAME` if running multiple
- Or just run one worker locally for testing

## Production Deployment

When deploying to production, use PM2:

```bash
pm2 start ecosystem.config.js
pm2 scale worker 5  # Scale as needed
```


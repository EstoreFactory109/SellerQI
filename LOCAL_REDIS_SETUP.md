# Local Redis Setup for Queue System

## Overview

The queue system now uses **LOCAL Redis** (separate from Redis Cloud).
- **Queue System**: Uses local Redis (localhost:6379)
- **Cache System**: Continues using Redis Cloud (unchanged)

This allows you to set `noeviction` policy locally without affecting Redis Cloud.

## Step 1: Install Local Redis

### macOS
```bash
brew install redis
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install redis-server
```

### Windows
Download from: https://redis.io/download

## Step 2: Start Local Redis

```bash
# Start Redis server
redis-server

# You should see:
# Ready to accept connections
```

**Keep this terminal open** - Redis needs to keep running.

## Step 3: Set Eviction Policy

Open a new terminal and run:

```bash
# Connect to local Redis
redis-cli

# Set eviction policy to noeviction
CONFIG SET maxmemory-policy noeviction

# Verify it's set
CONFIG GET maxmemory-policy
# Should return: "noeviction"

# Exit
exit
```

## Step 4: Make It Persistent (Optional)

To make the eviction policy persist after Redis restart:

```bash
# Edit Redis config file
# macOS: /usr/local/etc/redis.conf
# Linux: /etc/redis/redis.conf

# Add or update this line:
maxmemory-policy noeviction

# Then restart Redis
```

## Step 5: Verify Setup

```bash
# Test connection
redis-cli ping
# Should return: PONG

# Check eviction policy
redis-cli CONFIG GET maxmemory-policy
# Should return: "noeviction"
```

## Step 6: Start Your Application

Now start your worker:

```bash
# Terminal 1: API Server
npm run dev

# Terminal 2: Worker
node server/Services/BackgroundJobs/worker.js
```

**You should NOT see the eviction policy warning anymore!**

## Environment Variables (Optional)

If you want to customize local Redis connection, add to `.env`:

```env
# Local Redis for Queue (optional - defaults shown)
QUEUE_REDIS_HOST=localhost
QUEUE_REDIS_PORT=6379
QUEUE_REDIS_PASSWORD=  # Usually not needed for local
QUEUE_REDIS_USERNAME=  # Usually not needed for local
```

## Architecture

```
┌─────────────────────────────────┐
│  Application                    │
│                                 │
│  ┌──────────────────────────┐  │
│  │ Cache Operations         │  │
│  │ (analyse_data keys)      │  │
│  │ → Redis Cloud            │  │
│  └──────────────────────────┘  │
│                                 │
│  ┌──────────────────────────┐  │
│  │ Queue Operations         │  │
│  │ (BullMQ jobs)            │  │
│  │ → Local Redis            │  │
│  └──────────────────────────┘  │
└─────────────────────────────────┘
```

## Troubleshooting

### "Connection refused" Error

**Problem**: Local Redis not running

**Solution**:
```bash
# Start Redis
redis-server
```

### "Eviction policy" Warning Still Shows

**Problem**: Eviction policy not set

**Solution**:
```bash
redis-cli CONFIG SET maxmemory-policy noeviction
```

### Redis Won't Start

**Problem**: Port 6379 already in use

**Solution**:
```bash
# Check what's using the port
lsof -i :6379

# Kill the process or use different port
# Then update QUEUE_REDIS_PORT in .env
```

## Production Deployment

For production (EC2), you have two options:

### Option 1: Install Redis on EC2
```bash
# On EC2
sudo apt install redis-server
sudo systemctl start redis
sudo systemctl enable redis
redis-cli CONFIG SET maxmemory-policy noeviction
```

### Option 2: Use Separate Redis Cloud Instance
- Create a new Redis Cloud database
- Set eviction policy to `noeviction`
- Use that for queue, keep existing for cache

## Verification

After setup, check logs:

```bash
# Should see:
[QueueRedis] Connecting to local Redis at localhost:6379
[Worker:worker-XXXX] Worker started with concurrency: 3

# Should NOT see:
IMPORTANT! Eviction policy is volatile-lru...
```

## Summary

✅ **Cache**: Still uses Redis Cloud (unchanged)
✅ **Queue**: Now uses Local Redis (with noeviction)
✅ **No warnings**: Eviction policy issue resolved
✅ **Separation**: Queue and cache are independent


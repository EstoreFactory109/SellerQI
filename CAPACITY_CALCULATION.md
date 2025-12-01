# Capacity Calculation Guide

## Your Current Setup

- **Workers**: 2 (default from ecosystem.config.js)
- **Concurrency per worker**: 3
- **Total concurrent capacity**: 2 × 3 = **6 jobs simultaneously**
- **Job duration**: 30 minutes to 4-5 hours per user

## How It Works

### Hourly Distribution

Users are distributed across 24 hours. At each hour:
- Cron enqueues users scheduled for that hour
- Workers start processing immediately
- Jobs can take 30 minutes to 4-5 hours

### Capacity Per Hour

With your current setup:
- **6 jobs can run simultaneously**
- If each job takes 1 hour average: **6 users/hour**
- If each job takes 2 hours average: **3 users/hour**
- If each job takes 4 hours average: **1.5 users/hour**

## Will All Users Complete in 24 Hours?

### Scenario Analysis

**Best Case (30 minutes per user):**
- Capacity: 6 jobs × (60 min / 30 min) = **12 users/hour**
- Can handle: 12 × 24 = **288 users/day** ✅

**Average Case (2 hours per user):**
- Capacity: 6 jobs × (60 min / 120 min) = **3 users/hour**
- Can handle: 3 × 24 = **72 users/day** ⚠️

**Worst Case (4-5 hours per user):**
- Capacity: 6 jobs × (60 min / 240 min) = **1.5 users/hour**
- Can handle: 1.5 × 24 = **36 users/day** ❌

### Important: Jobs Can Spill Over

If a job takes longer than 1 hour, it will continue running. This is **OKAY** because:
- Workers process continuously (not just during the hour)
- Jobs complete when they finish (not limited to 1 hour)
- The system tracks completion, not hourly deadlines

**Example:**
- 2:00 PM: 10 users enqueued for hour 14
- Workers start processing 6 users immediately
- 3:00 PM: 4 users still processing (took 2 hours each)
- 3:00 PM: New users for hour 15 are enqueued
- Workers continue processing all jobs (both old and new)
- All jobs complete eventually

## How to Calculate Your Needs

### Step 1: Count Your Users

```bash
# Check how many users you have
# Or check your database
```

### Step 2: Estimate Average Processing Time

Based on your experience:
- Fast users: 30 minutes
- Average users: 2 hours
- Slow users: 4-5 hours

### Step 3: Calculate Required Capacity

**Formula:**
```
Required Capacity = (Total Users / 24) / (60 / Average Minutes Per User)
```

**Example with 200 users, 2 hour average:**
```
Users per hour = 200 / 24 = 8.3 users/hour
Required concurrent jobs = 8.3 / (60 / 120) = 8.3 / 0.5 = 16.6 jobs
```

**Your current capacity: 6 jobs**
**Required: ~17 jobs**
**Need to scale: 17 / 3 = ~6 workers**

### Step 4: Scale Workers

```bash
# Scale to 6 workers
pm2 scale worker 6

# New capacity: 6 workers × 3 concurrency = 18 jobs ✅
```

## Recommended Scaling

| Total Users | Avg Time | Users/Hour | Required Workers | Recommended |
|-------------|----------|------------|------------------|-------------|
| 50          | 2 hours  | 2.1        | 1                | 2 workers   |
| 100         | 2 hours  | 4.2        | 3                | 3 workers   |
| 200         | 2 hours  | 8.3        | 6                | 6 workers   |
| 500         | 2 hours  | 20.8       | 14               | 15 workers  |
| 1,000       | 2 hours  | 41.7       | 28               | 30 workers  |

**Formula for workers:**
```
Workers = Math.ceil((Total Users / 24) / (60 / Avg Minutes) / Concurrency)
```

## Monitoring Your System

### Check Queue Backlog

```bash
# Via API
GET /app/job-status/queue/stats

# Look for:
# - waiting: Should stay low (< 10)
# - active: Should match your capacity (6 with current setup)
```

### Check Processing Times

```bash
# Check job durations in logs
pm2 logs worker | grep "duration"

# Or check JobStatus collection in MongoDB
```

### Signs You Need More Workers

1. **Queue backlog growing**: `waiting` count keeps increasing
2. **Jobs taking longer**: Average duration increasing
3. **Users not updated**: Users waiting > 24 hours for update
4. **High memory/CPU**: Workers maxed out

## Quick Answer for Your Setup

**With WORKER_CONCURRENCY=3 and 2 workers (6 total capacity):**

- ✅ **Can handle ~72 users** if average time is 2 hours
- ⚠️ **May struggle with 200+ users** if average time is 2+ hours
- ❌ **Will struggle with 200+ users** if average time is 4+ hours

**Recommendation:**
- If you have < 100 users: Current setup is fine
- If you have 100-200 users: Scale to 4-6 workers
- If you have 200+ users: Scale to 6-10 workers

## Scaling Commands

```bash
# Check current status
pm2 status

# Scale workers
pm2 scale worker 6  # Increase to 6 workers

# New capacity: 6 × 3 = 18 concurrent jobs

# Monitor after scaling
pm2 logs worker
pm2 monit
```

## Important Notes

1. **Jobs don't have to complete in 1 hour** - They can take longer
2. **System processes continuously** - Not limited to hourly windows
3. **Backlog is okay** - As long as it doesn't keep growing
4. **Monitor and adjust** - Start with 2 workers, scale as needed


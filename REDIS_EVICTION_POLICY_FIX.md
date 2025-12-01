# Redis Eviction Policy Fix for BullMQ

## The Warning

You're seeing this warning:
```
IMPORTANT! Eviction policy is volatile-lru. It should be "noeviction"
```

## Why This Matters

BullMQ requires Redis eviction policy to be `noeviction` because:
- **Job Loss Prevention**: If Redis evicts keys when memory is full, jobs could be lost
- **Data Integrity**: Queue data must persist even under memory pressure
- **Reliability**: BullMQ needs guaranteed persistence of job data

## How to Fix in Redis Cloud

### Step 1: Access Redis Cloud Dashboard

1. Go to [Redis Cloud Console](https://app.redislabs.com/)
2. Log in to your account
3. Select your subscription

### Step 2: Navigate to Database Configuration

1. Click on your database
2. Go to **Configuration** tab
3. Scroll to **Advanced Settings** or **Memory Settings**

### Step 3: Change Eviction Policy

1. Find **"Max memory policy"** or **"Eviction policy"** setting
2. Change from `volatile-lru` (or current value) to **`noeviction`**
3. Click **Save** or **Update**

### Step 4: Restart Database (if required)

Some Redis Cloud plans require a restart:
1. Go to **Configuration** → **Actions**
2. Click **Restart** (if available)
3. Wait for restart to complete (~1-2 minutes)

### Step 5: Verify

After restart, check the warning is gone:

```bash
# Restart your worker
# The warning should no longer appear
```

## Alternative: If You Can't Change Policy

If you're on a Redis Cloud plan that doesn't allow changing eviction policy:

### Option 1: Upgrade Plan
- Contact Redis Cloud support
- Upgrade to a plan that allows custom eviction policies

### Option 2: Use Separate Redis Instance
- Create a separate Redis instance for BullMQ
- Set eviction policy to `noeviction` on that instance
- Use different connection details for queue

### Option 3: Monitor Memory Usage
- Keep Redis memory usage below 80%
- Monitor closely to prevent eviction
- **Not recommended** - jobs may still be lost

## Verification

After fixing, restart your worker:

```bash
# Stop worker
# (Ctrl+C in terminal, or pm2 restart worker)

# Start worker again
node server/Services/BackgroundJobs/worker.js
# OR
pm2 restart worker
```

**You should NOT see the eviction policy warning anymore.**

## What Happens If You Don't Fix It?

- ⚠️ Jobs may be lost if Redis memory fills up
- ⚠️ Queue data may be evicted
- ⚠️ System may become unreliable
- ✅ System will still work, but with risk of data loss

## Current Status

- ✅ **Worker is running** - The warning doesn't stop it
- ⚠️ **Eviction policy needs fixing** - For production reliability
- ✅ **System will work** - But fix it before production deployment

## Quick Checklist

- [ ] Access Redis Cloud dashboard
- [ ] Navigate to database configuration
- [ ] Change eviction policy to `noeviction`
- [ ] Save changes
- [ ] Restart database (if required)
- [ ] Restart worker
- [ ] Verify warning is gone

## Support

If you can't find the setting:
1. Check Redis Cloud documentation
2. Contact Redis Cloud support
3. Check your plan's limitations


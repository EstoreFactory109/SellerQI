# Background Job System for IBEX

This background job system automatically updates user data from Amazon APIs at scheduled intervals while distributing the load across time to avoid overwhelming the servers.

## Overview

The system consists of three main components:

1. **UserSchedulingService** - Manages user schedules and distributes them across time slots
2. **DataUpdateService** - Handles the actual data fetching and Redis cache updates
3. **JobScheduler** - Manages the cron jobs and scheduling

## Features

### Daily Updates (24-hour intervals)
- **Data Updated**: Profitability dashboard and sponsored ads data
- **Distribution**: Users are distributed across 24 hours (one user per hour slot)
- **Cache Update**: Redis cache is updated with fresh analyzed data
- **Gap Enforcement**: Exactly 24 hours between each user's updates

### Weekly Updates (7-day intervals)  
- **Data Updated**: All other data (V1/V2 reports, financial data, inventory, etc.)
- **Distribution**: Users are distributed across 7 days
- **Gap Enforcement**: Exactly 7 days between each user's updates

### Load Distribution
- Users are automatically assigned time slots to spread load evenly
- Daily updates run every hour (checking for users scheduled for that hour)
- Weekly updates run daily at midnight (checking for users scheduled for that day)

## How It Works

### 1. User Registration
When a user verifies their account, they are automatically:
- Assigned a daily update hour (0-23)
- Assigned a weekly update day (0-6)
- Added to the scheduling system

### 2. Data Updates
The system runs scheduled jobs:
- **Hourly**: Checks for users needing daily updates
- **Daily at midnight**: Checks for users needing weekly updates
- **Every 6 hours**: Cleans up old cache entries
- **Every 30 minutes**: Health check and monitoring

### 3. Cache Management
- Updated data is stored in Redis with the same key format as the existing middleware
- Cache TTL is set to 1 hour to ensure fresh data
- Old cache entries are automatically cleaned up

## API Endpoints

### User Endpoints
- `GET /app/jobs/user/schedule` - Get user's scheduling information
- `POST /app/jobs/user/manual-update` - Manually trigger update for current user
- `PUT /app/jobs/user/update-accounts` - Update seller accounts in scheduling system

### Admin Endpoints
- `GET /app/jobs/admin/system-stats` - Get comprehensive system statistics
- `GET /app/jobs/admin/job-status` - Get status of all background jobs
- `POST /app/jobs/admin/trigger/:jobName` - Manually trigger a specific job
- `PUT /app/jobs/admin/control/:jobName` - Start/stop a specific job
- `POST /app/jobs/admin/emergency-stop` - Stop all background jobs
- `POST /app/jobs/admin/restart-jobs` - Restart all background jobs

### Available Job Names
- `dailyUpdates` - Process daily updates for all eligible users
- `weeklyUpdates` - Process weekly updates for all eligible users
- `cacheCleanup` - Clean up old cache entries
- `healthCheck` - Get system statistics

## Configuration

### Environment Variables
- `TIMEZONE` - Set the timezone for job scheduling (default: UTC)

### Job Schedules
- **Daily Updates**: `0 * * * *` (every hour)
- **Weekly Updates**: `0 0 * * *` (daily at midnight)
- **Cache Cleanup**: `30 */6 * * *` (every 6 hours at :30)
- **Health Check**: `*/30 * * * *` (every 30 minutes)

## Database Schema

### UserUpdateSchedule Model
```javascript
{
  userId: ObjectId,              // Reference to User
  dailyUpdateHour: Number,       // Hour (0-23) for daily updates
  weeklyUpdateDay: Number,       // Day (0-6) for weekly updates
  lastDailyUpdate: Date,         // Last daily update timestamp
  lastWeeklyUpdate: Date,        // Last weekly update timestamp
  sellerAccounts: [{             // User's seller accounts
    country: String,
    region: String,
    lastDailyUpdate: Date,
    lastWeeklyUpdate: Date
  }]
}
```

## Usage Examples

### Manual User Update
```javascript
POST /app/jobs/user/manual-update
{
  "country": "US",
  "region": "NA",
  "updateType": "both"  // "daily", "weekly", or "both"
}
```

### Get System Statistics
```javascript
GET /app/jobs/admin/system-stats
```

### Trigger Daily Updates Manually
```javascript
POST /app/jobs/admin/trigger/dailyUpdates
```

## Monitoring

The system provides several monitoring endpoints:

1. **System Stats** - Overall system health and performance
2. **Job Status** - Status of individual background jobs
3. **Update Stats** - Statistics about data updates
4. **Schedule Stats** - Distribution of users across time slots

## Error Handling

- Individual user update failures don't stop the batch process
- Failed updates are logged but don't crash the system
- Scheduling failures don't prevent user registration/verification
- Redis connection issues are handled gracefully

## Performance Considerations

- Users are processed in batches to avoid overwhelming the system
- Delays are added between batches to reduce load
- Daily updates use batch size of 5 users
- Weekly updates use batch size of 3 users (more intensive)

## Maintenance

### Adding New Users
New users are automatically added to the scheduling system when they verify their account.

### Updating User Accounts
When users add new seller accounts, the scheduling system is automatically updated.

### Manual Intervention
Admins can manually trigger updates, start/stop jobs, and get system statistics through the provided endpoints.

## Integration Points

The background job system integrates with:

1. **User Registration**: Auto-scheduling on verification
2. **Seller Account Management**: Auto-updating schedules when accounts change
3. **Analyzing Controller**: Uses existing analysis logic
4. **Redis Cache**: Updates cache with same format as existing middleware
5. **Existing API Logic**: Leverages current data fetching and processing

This system ensures that all users get fresh data regularly while maintaining system performance and reliability. 
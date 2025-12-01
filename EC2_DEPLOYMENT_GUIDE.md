# Complete EC2 Deployment Guide - Queue System

## Prerequisites

- EC2 instance running (Ubuntu/Amazon Linux)
- Node.js installed (v16+)
- MongoDB accessible (local or remote)
- Redis Cloud accessible
- Git repository access

## Step-by-Step Deployment

### Step 1: Connect to EC2 and Navigate to Project

```bash
# SSH into your EC2 instance
ssh -i your-key.pem ubuntu@your-ec2-ip

# Navigate to your project directory (or create it)
cd /var/www  # or wherever you deploy
# OR if project already exists:
cd /path/to/your/project
```

### Step 2: Pull Latest Code

```bash
# If using Git
git pull origin main
# OR
git pull origin master

# If first time setup
git clone your-repo-url
cd your-project-name
```

### Step 3: Install Dependencies

```bash
# Navigate to server directory
cd server

# Install all dependencies (including bullmq)
npm install

# Verify bullmq is installed
npm list bullmq
# Should show: bullmq@5.65.0 (or similar)
```

### Step 4: Set Up Environment Variables

```bash
# Create or edit .env file in server directory
nano server/.env
# OR
vim server/.env
```

**Add/Verify these environment variables:**

```env
# Database
DB_URI=your-mongodb-connection-string
DB_NAME=your-database-name

# Redis Cloud
REDIS_HOST=your-redis-host.redis.cloud
REDIS_PASSWORD=your-redis-password

# Server
PORT=3000
NODE_ENV=production
CORS_ORIGIN_DOMAIN=your-frontend-domain

# Worker Configuration (NEW)
WORKER_CONCURRENCY=3
WORKER_INSTANCES=2

# Timezone (optional)
TIMEZONE=UTC

# Other existing env vars (JWT_SECRET, etc.)
JWT_SECRET=your-jwt-secret
# ... add all other required env vars
```

**Save and exit:**
- Nano: `Ctrl+X`, then `Y`, then `Enter`
- Vim: `Esc`, then `:wq`, then `Enter`

### Step 5: Install PM2 Globally

```bash
# Install PM2 globally
npm install -g pm2

# Verify installation
pm2 --version
# Should show version number
```

### Step 6: Build Frontend (if applicable)

```bash
# Navigate to client directory
cd ../client

# Install client dependencies
npm install

# Build for production
npm run build

# Go back to root
cd ..
```

### Step 7: Test Database and Redis Connections

```bash
# Test MongoDB connection (optional - create a test script)
# Or just proceed - errors will show in logs if connection fails

# Test Redis connection
# The app will show connection status on startup
```

### Step 8: Start Application with PM2

```bash
# Make sure you're in the project root directory
cd /path/to/your/project

# Start both API server and workers
pm2 start ecosystem.config.js

# This will start:
# - api-server (1 instance)
# - worker (2 instances by default)
```

### Step 9: Verify Services Are Running

```bash
# Check PM2 status
pm2 status

# Should show:
# ┌─────┬──────────────┬─────────┬─────────┬──────────┬─────────┐
# │ id  │ name         │ mode    │ ↺       │ status   │ cpu     │
# ├─────┼──────────────┼─────────┼─────────┼──────────┼─────────┤
# │ 0   │ api-server   │ fork    │ 0       │ online   │ 0%      │
# │ 1   │ worker       │ cluster │ 0       │ online   │ 0%      │
# │ 2   │ worker       │ cluster │ 0       │ online   │ 0%      │
# └─────┴──────────────┴─────────┴─────────┴──────────┴─────────┘
```

### Step 10: Check Logs

```bash
# View all logs
pm2 logs

# View specific app logs
pm2 logs api-server
pm2 logs worker

# View last 100 lines
pm2 logs --lines 100

# You should see:
# - API server: "Server started on port 3000"
# - API server: "Queue-based daily update cron producer initialized"
# - Workers: "Worker started with concurrency: 3"
```

### Step 11: Save PM2 Configuration

```bash
# Save current PM2 process list
pm2 save

# Setup PM2 to start on system reboot
pm2 startup
# This will output a command - RUN THAT COMMAND (it's system-specific)
# Example output:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

### Step 12: Verify Queue System is Working

```bash
# Option 1: Check via API (if you have auth token)
curl http://localhost:3000/app/job-status/queue/stats

# Option 2: Check PM2 logs for worker activity
pm2 logs worker --lines 50

# Option 3: Wait for next hour (cron runs at minute 0)
# Then check logs to see jobs being enqueued and processed
```

### Step 13: Scale Workers (Optional - Based on User Count)

```bash
# Scale to 5 workers (for ~1,000 users)
pm2 scale worker 5

# Scale to 10 workers (for ~5,000 users)
pm2 scale worker 10

# Check status after scaling
pm2 status
```

### Step 14: Set Up Nginx (if using reverse proxy)

```bash
# Install Nginx
sudo apt update
sudo apt install nginx

# Configure Nginx
sudo nano /etc/nginx/sites-available/your-app

# Add configuration:
# server {
#     listen 80;
#     server_name your-domain.com;
#     
#     location / {
#         proxy_pass http://localhost:3000;
#         proxy_http_version 1.1;
#         proxy_set_header Upgrade $http_upgrade;
#         proxy_set_header Connection 'upgrade';
#         proxy_set_header Host $host;
#         proxy_cache_bypass $http_upgrade;
#     }
# }

# Enable site
sudo ln -s /etc/nginx/sites-available/your-app /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### Step 15: Set Up SSL (Optional - using Let's Encrypt)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is set up automatically
```

## Useful PM2 Commands

```bash
# View status
pm2 status

# View logs
pm2 logs
pm2 logs api-server
pm2 logs worker

# Restart services
pm2 restart all
pm2 restart api-server
pm2 restart worker

# Stop services
pm2 stop all
pm2 stop api-server
pm2 stop worker

# Delete services
pm2 delete all
pm2 delete api-server
pm2 delete worker

# Monitor (real-time)
pm2 monit

# Scale workers
pm2 scale worker 5

# Reload (zero-downtime restart)
pm2 reload all
```

## Monitoring and Maintenance

### Daily Checks

```bash
# Check if services are running
pm2 status

# Check for errors in logs
pm2 logs --err --lines 50

# Check queue statistics (via API)
curl http://localhost:3000/app/job-status/queue/stats
```

### Weekly Checks

```bash
# Check disk space
df -h

# Check memory usage
free -h

# Check PM2 memory usage
pm2 list

# Review failed jobs
# Via API: GET /app/job-status/failed
```

### Troubleshooting

```bash
# If API server crashes
pm2 logs api-server --err
pm2 restart api-server

# If workers crash
pm2 logs worker --err
pm2 restart worker

# If Redis connection fails
# Check REDIS_HOST and REDIS_PASSWORD in .env
# Check Redis Cloud dashboard

# If MongoDB connection fails
# Check DB_URI in .env
# Check MongoDB is accessible from EC2

# If jobs not processing
# 1. Check workers are running: pm2 status
# 2. Check queue has jobs: API endpoint
# 3. Check worker logs: pm2 logs worker
```

## Complete Deployment Script

You can create a deployment script `deploy.sh`:

```bash
#!/bin/bash

# Deployment script for EC2

echo "🚀 Starting deployment..."

# Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# Install server dependencies
echo "📦 Installing server dependencies..."
cd server
npm install

# Install client dependencies and build
echo "🏗️  Building frontend..."
cd ../client
npm install
npm run build
cd ..

# Restart PM2 services
echo "🔄 Restarting services..."
pm2 restart ecosystem.config.js

# Save PM2 configuration
pm2 save

echo "✅ Deployment complete!"
echo "📊 Check status: pm2 status"
echo "📝 Check logs: pm2 logs"
```

Make it executable:
```bash
chmod +x deploy.sh
```

Run it:
```bash
./deploy.sh
```

## Quick Reference Checklist

- [ ] Pull latest code from Git
- [ ] Install dependencies (`npm install` in server/)
- [ ] Set up `.env` file with all required variables
- [ ] Install PM2 globally (`npm install -g pm2`)
- [ ] Build frontend (`npm run build` in client/)
- [ ] Start services (`pm2 start ecosystem.config.js`)
- [ ] Verify services running (`pm2 status`)
- [ ] Check logs (`pm2 logs`)
- [ ] Save PM2 config (`pm2 save`)
- [ ] Set up PM2 startup (`pm2 startup` + run command)
- [ ] Scale workers if needed (`pm2 scale worker N`)
- [ ] Test queue system (wait for cron or manually enqueue)
- [ ] Set up Nginx (optional)
- [ ] Set up SSL (optional)

## Environment Variables Checklist

Make sure these are in `server/.env`:

- [ ] `DB_URI` - MongoDB connection string
- [ ] `DB_NAME` - Database name
- [ ] `REDIS_HOST` - Redis Cloud host
- [ ] `REDIS_PASSWORD` - Redis Cloud password
- [ ] `WORKER_CONCURRENCY` - Worker concurrency (default: 3)
- [ ] `WORKER_INSTANCES` - Number of workers (default: 2)
- [ ] `PORT` - Server port (default: 3000)
- [ ] `NODE_ENV` - Set to `production`
- [ ] `JWT_SECRET` - JWT secret key
- [ ] All other existing environment variables

## Post-Deployment Verification

After deployment, verify:

1. **API Server is running:**
   ```bash
   curl http://localhost:3000/health
   # OR check your health endpoint
   ```

2. **Workers are processing:**
   ```bash
   pm2 logs worker
   # Should see: "Worker started with concurrency: 3"
   ```

3. **Cron is enqueuing:**
   - Wait for next hour (minute 0)
   - Check logs: `pm2 logs api-server | grep CronProducer`
   - Should see: "Enqueuing X users for processing"

4. **Jobs are being processed:**
   - Check worker logs: `pm2 logs worker`
   - Should see: "Starting job..." and "Job completed successfully"

## Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs --err`
2. Check system logs: `journalctl -u pm2-*`
3. Verify environment variables are set correctly
4. Check Redis and MongoDB connections
5. Review the troubleshooting section above


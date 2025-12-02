# MCP Production Deployment Guide

## ❌ No, NOT on localhost in Production!

In production, your Express server (including the MCP integration) should **NOT** run on localhost. Here's how it should work:

## 🏗️ Production Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Production Server                    │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Nginx (Reverse Proxy)                    │  │
│  │  Listens on: 0.0.0.0:80/443 (public)            │  │
│  └──────────────┬───────────────────────────────────┘  │
│                 │                                       │
│                 │ Proxies to:                          │
│                 ▼                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │      Express Server (PM2)                       │  │
│  │  Listens on: 0.0.0.0:3000 (internal)           │  │
│  │  Includes: MCP endpoints (/app/mcp/*)          │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │      Worker Processes (PM2)                      │  │
│  │  Background job processing                      │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## ✅ Correct Production Setup

### 1. Express Server Configuration

Your server should listen on **all interfaces** (0.0.0.0), not just localhost:

```javascript
// server/index.js (Current - This is CORRECT)
const port = process.env.PORT || 3000;

app.listen(port, () => {  // ✅ Listens on 0.0.0.0 by default
    logger.info(`Server started on port ${port}`);
});
```

**This is already correct!** By default, `app.listen(port)` binds to `0.0.0.0`, which means:
- ✅ Accessible from outside (via reverse proxy)
- ✅ Works with Nginx
- ✅ Works with load balancers

### 2. Nginx Configuration (Recommended)

In production, use Nginx as a reverse proxy:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # Proxy all requests to Express server
    location / {
        proxy_pass http://localhost:3000;  # ← localhost here is OK!
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # MCP endpoints are automatically included
    # They're part of /app/mcp/* routes
}
```

**Note**: In Nginx config, `localhost:3000` is correct because:
- Nginx runs on the same server
- It's an internal connection
- Express server is only accessible internally (not exposed to internet)

### 3. PM2 Configuration

Your `ecosystem.config.js` is already correct:

```javascript
{
    name: 'api-server',
    script: './server/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000  // ✅ Uses environment variable
    }
}
```

## 🌐 Accessing MCP Endpoints in Production

### Development (Local)
```
http://localhost:3000/app/mcp/queries
```

### Production (Public)
```
https://your-domain.com/app/mcp/queries
```

The MCP endpoints are **part of your Express server**, so they're accessible through:
- ✅ Your production domain
- ✅ Through Nginx reverse proxy
- ✅ With SSL/HTTPS
- ✅ With your existing authentication

## 🔒 Security Considerations

### 1. Authentication Required
All MCP endpoints require authentication:
```javascript
router.use(auth);  // ✅ JWT token required
router.use(getLocation);  // ✅ Region validation
```

### 2. Internal vs External Access

**Express Server** (Internal):
- Listens on: `0.0.0.0:3000` (all interfaces)
- But should be behind firewall
- Only accessible from same server (for Nginx)

**Nginx** (External):
- Listens on: `0.0.0.0:80/443` (public)
- Handles SSL/TLS
- Rate limiting
- DDoS protection

### 3. Environment Variables

Make sure these are set in production:

```env
# Server
PORT=3000  # Internal port (not exposed to internet)
NODE_ENV=production

# CORS
CORS_ORIGIN_DOMAIN=https://your-frontend-domain.com

# Database
DB_URI=your-mongodb-connection-string

# AWS Credentials (for MCP API calls)
AWS_ACCESS_KEY=your-access-key
AWS_SECRET_KEY=your-secret-key
ROLE_ARN=your-role-arn
```

## 🚀 Deployment Steps

### 1. Deploy Code
```bash
# On production server
git pull origin main
cd server
npm install
```

### 2. Start with PM2
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Set up auto-start on reboot
```

### 3. Configure Nginx
```bash
# Edit Nginx config
sudo nano /etc/nginx/sites-available/your-site

# Test config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### 4. Verify MCP Endpoints
```bash
# Test from server
curl -X GET "http://localhost:3000/app/mcp/queries" \
  -H "Authorization: Bearer <test-token>"

# Test from external (through domain)
curl -X GET "https://your-domain.com/app/mcp/queries" \
  -H "Authorization: Bearer <test-token>"
```

## ❌ Common Mistakes to Avoid

### ❌ DON'T: Bind to localhost only
```javascript
// ❌ WRONG - Only accessible from same machine
app.listen(port, 'localhost', () => {
    // This would break Nginx proxy
});
```

### ❌ DON'T: Expose port 3000 directly
```bash
# ❌ WRONG - Don't expose Express port to internet
# Use firewall to block port 3000 from external access
sudo ufw deny 3000
```

### ❌ DON'T: Run MCP as separate server
```bash
# ❌ NOT NEEDED - MCP is integrated into Express
# You don't need to run the MCP server separately
```

## ✅ What You Have (Correct Setup)

1. ✅ Express server listens on `0.0.0.0:3000` (all interfaces)
2. ✅ MCP endpoints are part of Express (`/app/mcp/*`)
3. ✅ PM2 manages the server process
4. ✅ Authentication middleware protects endpoints
5. ✅ Ready for Nginx reverse proxy

## 📝 Summary

**Question**: Should MCP run on localhost in production?

**Answer**: 
- ❌ **NO** - The Express server should listen on `0.0.0.0:3000` (all interfaces)
- ✅ **YES** - Nginx can proxy from `localhost:3000` (internal connection)
- ✅ **YES** - MCP endpoints are accessible via your production domain
- ✅ **YES** - Everything runs as part of your Express server (no separate process)

The MCP integration is **already correctly configured** for production! Just make sure:
1. Your Express server is behind Nginx (recommended)
2. Port 3000 is not exposed to the internet (firewall)
3. SSL/HTTPS is configured (Nginx)
4. Environment variables are set correctly

## 🔍 Quick Check

To verify your setup is correct:

```bash
# Check what your server is listening on
sudo netstat -tlnp | grep 3000
# Should show: 0.0.0.0:3000 (not 127.0.0.1:3000)

# Check PM2 status
pm2 status
# Should show: api-server (online)

# Test endpoint
curl http://localhost:3000/app/mcp/queries
# Should return: 401 Unauthorized (auth required - this is correct!)
```

Your current setup is **production-ready**! 🎉


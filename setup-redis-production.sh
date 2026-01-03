#!/bin/bash

# Redis Production Setup Script for Ubuntu
# This script automates the Redis configuration for production use with BullMQ

set -e  # Exit on error

echo "=========================================="
echo "Redis Production Setup Script"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root or with sudo${NC}"
    exit 1
fi

# Step 1: Install Redis
echo -e "${YELLOW}[1/8] Checking Redis installation...${NC}"
if ! command -v redis-server &> /dev/null; then
    echo "Installing Redis..."
    apt update
    apt install -y redis-server
else
    echo -e "${GREEN}✓ Redis is already installed${NC}"
fi

# Step 2: Stop Redis to make configuration changes
echo -e "${YELLOW}[2/8] Stopping Redis service...${NC}"
systemctl stop redis-server

# Step 3: Backup original config
echo -e "${YELLOW}[3/8] Backing up original configuration...${NC}"
if [ ! -f /etc/redis/redis.conf.backup ]; then
    cp /etc/redis/redis.conf /etc/redis/redis.conf.backup
    echo -e "${GREEN}✓ Configuration backed up${NC}"
else
    echo -e "${GREEN}✓ Backup already exists${NC}"
fi

# Step 4: Configure Redis
echo -e "${YELLOW}[4/8] Configuring Redis for production...${NC}"

REDIS_CONF="/etc/redis/redis.conf"

# Ask for memory limit
read -p "Enter Redis memory limit (e.g., 200mb, 500mb) [default: 200mb]: " MEMORY_LIMIT
MEMORY_LIMIT=${MEMORY_LIMIT:-200mb}

# Ask for password (optional)
read -p "Do you want to set a password for Redis? (y/n) [default: n]: " SET_PASSWORD
SET_PASSWORD=${SET_PASSWORD:-n}

if [ "$SET_PASSWORD" = "y" ] || [ "$SET_PASSWORD" = "Y" ]; then
    read -sp "Enter Redis password: " REDIS_PASSWORD
    echo ""
    read -sp "Confirm Redis password: " REDIS_PASSWORD_CONFIRM
    echo ""
    
    if [ "$REDIS_PASSWORD" != "$REDIS_PASSWORD_CONFIRM" ]; then
        echo -e "${RED}Passwords do not match!${NC}"
        exit 1
    fi
else
    REDIS_PASSWORD=""
fi

# Apply configuration changes
echo "Applying configuration..."

# Network binding
sed -i 's/^# bind 127.0.0.1/bind 127.0.0.1/' $REDIS_CONF
sed -i 's/^bind .*/bind 127.0.0.1 ::1/' $REDIS_CONF

# Protected mode
sed -i 's/^protected-mode .*/protected-mode yes/' $REDIS_CONF

# Memory configuration
sed -i "s/^# maxmemory .*/maxmemory $MEMORY_LIMIT/" $REDIS_CONF
sed -i "s/^maxmemory .*/maxmemory $MEMORY_LIMIT/" $REDIS_CONF
sed -i 's/^# maxmemory-policy .*/maxmemory-policy noeviction/' $REDIS_CONF
sed -i 's/^maxmemory-policy .*/maxmemory-policy noeviction/' $REDIS_CONF

# Persistence (RDB)
sed -i 's/^save 900 1/save 900 1/' $REDIS_CONF
sed -i 's/^save 300 10/save 300 10/' $REDIS_CONF
sed -i 's/^save 60 10000/save 60 10000/' $REDIS_CONF

# Persistence (AOF)
sed -i 's/^appendonly .*/appendonly yes/' $REDIS_CONF
sed -i 's/^# appendonly yes/appendonly yes/' $REDIS_CONF
sed -i 's/^appendfsync .*/appendfsync everysec/' $REDIS_CONF

# Logging
sed -i 's/^loglevel .*/loglevel notice/' $REDIS_CONF
mkdir -p /var/log/redis
chown redis:redis /var/log/redis
sed -i 's|^logfile .*|logfile /var/log/redis/redis-server.log|' $REDIS_CONF

# Password (if set)
if [ -n "$REDIS_PASSWORD" ]; then
    if grep -q "^requirepass" $REDIS_CONF; then
        sed -i "s/^requirepass .*/requirepass $REDIS_PASSWORD/" $REDIS_CONF
    else
        echo "requirepass $REDIS_PASSWORD" >> $REDIS_CONF
    fi
    echo -e "${GREEN}✓ Password configured${NC}"
else
    # Remove password if exists
    sed -i '/^requirepass/d' $REDIS_CONF
    echo -e "${GREEN}✓ No password set (localhost only)${NC}"
fi

# Performance tuning
sed -i 's/^tcp-keepalive .*/tcp-keepalive 300/' $REDIS_CONF

echo -e "${GREEN}✓ Configuration applied${NC}"

# Step 5: Create backup directory
echo -e "${YELLOW}[5/8] Setting up backup directory...${NC}"
mkdir -p /var/backups/redis
chown redis:redis /var/backups/redis
echo -e "${GREEN}✓ Backup directory created${NC}"

# Step 6: Create backup script
echo -e "${YELLOW}[6/8] Creating backup script...${NC}"
cat > /usr/local/bin/redis-backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/redis"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Create RDB backup
redis-cli BGSAVE > /dev/null 2>&1

# Wait for background save to complete
LAST_SAVE=$(redis-cli LASTSAVE)
while [ "$(redis-cli LASTSAVE)" == "$LAST_SAVE" ]; do
    sleep 1
done

# Copy RDB file
cp /var/lib/redis/dump.rdb $BACKUP_DIR/dump_$DATE.rdb 2>/dev/null || true

# Copy AOF file if exists
if [ -f /var/lib/redis/appendonly.aof ]; then
    cp /var/lib/redis/appendonly.aof $BACKUP_DIR/appendonly_$DATE.aof
fi

# Keep only last 7 days of backups
find $BACKUP_DIR -name "*.rdb" -mtime +7 -delete 2>/dev/null || true
find $BACKUP_DIR -name "*.aof" -mtime +7 -delete 2>/dev/null || true

echo "Backup completed: $DATE"
EOF

chmod +x /usr/local/bin/redis-backup.sh
chown redis:redis /usr/local/bin/redis-backup.sh
echo -e "${GREEN}✓ Backup script created${NC}"

# Step 7: Create health check script
echo -e "${YELLOW}[7/8] Creating health check script...${NC}"
cat > /usr/local/bin/redis-health-check.sh << 'EOF'
#!/bin/bash
if [ -n "$REDIS_PASSWORD" ]; then
    REDIS_STATUS=$(redis-cli -a "$REDIS_PASSWORD" ping 2>&1)
else
    REDIS_STATUS=$(redis-cli ping 2>&1)
fi

if [ "$REDIS_STATUS" = "PONG" ]; then
    echo "✅ Redis is healthy"
    exit 0
else
    echo "❌ Redis is not responding: $REDIS_STATUS"
    exit 1
fi
EOF

chmod +x /usr/local/bin/redis-health-check.sh
echo -e "${GREEN}✓ Health check script created${NC}"

# Step 8: Start and enable Redis
echo -e "${YELLOW}[8/8] Starting Redis service...${NC}"
systemctl start redis-server
systemctl enable redis-server

# Wait a moment for Redis to start
sleep 2

# Test connection
if [ -n "$REDIS_PASSWORD" ]; then
    if redis-cli -a "$REDIS_PASSWORD" ping > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Redis is running and responding${NC}"
    else
        echo -e "${RED}✗ Redis is not responding. Check logs: sudo journalctl -u redis-server${NC}"
        exit 1
    fi
else
    if redis-cli ping > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Redis is running and responding${NC}"
    else
        echo -e "${RED}✗ Redis is not responding. Check logs: sudo journalctl -u redis-server${NC}"
        exit 1
    fi
fi

# Display configuration summary
echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Configuration Summary:"
echo "  - Memory Limit: $MEMORY_LIMIT"
echo "  - Eviction Policy: noeviction"
echo "  - Persistence: RDB + AOF enabled"
echo "  - Binding: 127.0.0.1 (localhost only)"
echo "  - Protected Mode: enabled"
if [ -n "$REDIS_PASSWORD" ]; then
    echo "  - Password: Set (save this password!)"
else
    echo "  - Password: Not set (localhost only)"
fi
echo ""
echo "Next Steps:"
echo "  1. Update your .env file:"
if [ -n "$REDIS_PASSWORD" ]; then
    echo "     QUEUE_REDIS_HOST=localhost"
    echo "     QUEUE_REDIS_PORT=6379"
    echo "     QUEUE_REDIS_PASSWORD=$REDIS_PASSWORD"
else
    echo "     QUEUE_REDIS_HOST=localhost"
    echo "     QUEUE_REDIS_PORT=6379"
fi
echo "     QUEUE_USE_REDIS_CLOUD=false"
echo ""
echo "  2. Test the connection:"
if [ -n "$REDIS_PASSWORD" ]; then
    echo "     redis-cli -a '$REDIS_PASSWORD' ping"
else
    echo "     redis-cli ping"
fi
echo ""
echo "  3. Check Redis status:"
echo "     sudo systemctl status redis-server"
echo ""
echo "  4. View Redis info:"
echo "     redis-cli INFO memory"
echo ""
echo "  5. Set up daily backups (optional):"
echo "     sudo crontab -e"
echo "     Add: 0 2 * * * /usr/local/bin/redis-backup.sh >> /var/log/redis/backup.log 2>&1"
echo ""
echo "=========================================="

if [ -n "$REDIS_PASSWORD" ]; then
    echo ""
    echo -e "${YELLOW}⚠️  IMPORTANT: Save your Redis password!${NC}"
    echo "Password: $REDIS_PASSWORD"
    echo ""
fi


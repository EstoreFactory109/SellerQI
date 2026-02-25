#!/usr/bin/env bash
# Reset PM2 state and start all apps from ecosystem.config.js.
# Use when you see "Process X not found" or "Cannot read properties of undefined (reading 'pm2_env')".
# Run from project root: ./scripts/pm2-reset-and-start.sh

set -e
cd "$(dirname "$0")/.."

echo "Stopping PM2 daemon and clearing state (pm2 kill)..."
pm2 kill

echo "Starting all apps from ecosystem.config.js..."
pm2 start ecosystem.config.js

echo "Done. Run 'pm2 status' or 'pm2 list' to verify."

/**
 * sharedQueueConnection.js
 * 
 * Shared IORedis connection instance for BullMQ Queue and Worker.
 * 
 * This ensures both Queue (for adding jobs) and Worker (for processing jobs)
 * use the exact same Redis connection, preventing any connection-related
 * visibility issues where jobs added by the Queue aren't seen by the Worker.
 * 
 * Usage:
 *   const { getSharedConnection } = require('./sharedQueueConnection');
 *   const connection = getSharedConnection();
 *   // Pass to both Worker and Queue
 */

const Redis = require('ioredis');
const { getQueueRedisConnection } = require('../../config/queueRedisConn.js');
const logger = require('../../utils/Logger.js');

let sharedConnection = null;

/**
 * Get or create the shared IORedis connection instance.
 * This returns the same instance every time, ensuring Queue and Worker
 * share the exact same connection to Redis.
 * 
 * @returns {Redis} Shared IORedis connection instance
 */
function getSharedConnection() {
    if (!sharedConnection) {
        const connectionOptions = getQueueRedisConnection();
        
        sharedConnection = new Redis({
            host: connectionOptions.host,
            port: connectionOptions.port,
            username: connectionOptions.username,
            password: connectionOptions.password,
            maxRetriesPerRequest: null, // Required for BullMQ
            enableReadyCheck: false, // Faster connection
            lazyConnect: false,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                logger.warn(`[SharedQueueConnection] Retrying connection (attempt ${times}) after ${delay}ms`);
                return delay;
            }
        });

        sharedConnection.on('connect', () => {
            logger.info(`[SharedQueueConnection] Connected to Redis at ${connectionOptions.host}:${connectionOptions.port}`);
        });

        sharedConnection.on('error', (err) => {
            logger.error('[SharedQueueConnection] Redis connection error:', err.message);
        });

        sharedConnection.on('close', () => {
            logger.warn('[SharedQueueConnection] Redis connection closed');
        });

        sharedConnection.on('reconnecting', () => {
            logger.info('[SharedQueueConnection] Reconnecting to Redis...');
        });
    }
    
    return sharedConnection;
}

/**
 * Close the shared connection (for graceful shutdown)
 */
async function closeSharedConnection() {
    if (sharedConnection) {
        try {
            await sharedConnection.quit();
            sharedConnection = null;
            logger.info('[SharedQueueConnection] Redis connection closed gracefully');
        } catch (error) {
            logger.error('[SharedQueueConnection] Error closing connection:', error.message);
            sharedConnection = null;
        }
    }
}

module.exports = {
    getSharedConnection,
    closeSharedConnection
};

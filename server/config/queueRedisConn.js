/**
 * queueRedisConn.js
 * 
 * Redis connection configuration for BullMQ.
 * 
 * IMPORTANT: This uses LOCAL Redis for the queue system.
 * Cache operations continue to use Redis Cloud (via redisConn.js).
 * 
 * This separation allows:
 * - Queue system to use local Redis with "noeviction" policy
 * - Cache system to continue using Redis Cloud (unchanged)
 * 
 * Setup Local Redis:
 * ==================
 * 1. Install Redis locally: brew install redis (Mac) or apt-get install redis (Linux)
 * 2. Start Redis: redis-server
 * 3. Set eviction policy: redis-cli CONFIG SET maxmemory-policy noeviction
 * 4. (Optional) Set in .env: QUEUE_REDIS_HOST, QUEUE_REDIS_PORT
 */

const logger = require('../utils/Logger.js');

/**
 * Get Redis connection options for BullMQ
 * 
 * Uses LOCAL Redis instance (separate from cache Redis Cloud).
 * This allows setting "noeviction" policy locally without affecting Redis Cloud.
 * 
 * @returns {Object} Redis connection options for BullMQ
 */
function getQueueRedisConnection() {
    // Use LOCAL Redis for queue (separate from cache)
    // Default to localhost:6379 (standard local Redis)
    const connectionOptions = {
        host: process.env.QUEUE_REDIS_HOST || 'localhost',
        port: parseInt(process.env.QUEUE_REDIS_PORT || '6379', 10),
        // Local Redis usually doesn't need username/password
        username: process.env.QUEUE_REDIS_USERNAME || undefined,
        password: process.env.QUEUE_REDIS_PASSWORD || undefined,
        // Enable retry strategy
        retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            logger.warn(`[QueueRedis] Retrying connection (attempt ${times}) after ${delay}ms`);
            return delay;
        },
        // Connection timeout
        connectTimeout: 10000,
        // Enable keep-alive
        keepAlive: 30000,
        // Max retries - BullMQ requires this to be null
        maxRetriesPerRequest: null
    };

    logger.info(`[QueueRedis] Connecting to local Redis at ${connectionOptions.host}:${connectionOptions.port}`);

    return connectionOptions;
}

/**
 * Verify that local Redis for queue is accessible
 * This checks the LOCAL Redis instance (not Redis Cloud)
 */
async function verifyQueueRedisConnection() {
    try {
        const { createClient } = require('redis');
        const connectionOptions = getQueueRedisConnection();
        
        const testClient = createClient({
            socket: {
                host: connectionOptions.host,
                port: connectionOptions.port,
                connectTimeout: connectionOptions.connectTimeout
            },
            ...(connectionOptions.password && { password: connectionOptions.password }),
            ...(connectionOptions.username && { username: connectionOptions.username })
        });

        await testClient.connect();
        await testClient.ping();
        await testClient.quit();
        
        logger.info('[QueueRedis] Verified local Redis connection is active');
        return true;
    } catch (error) {
        logger.error('[QueueRedis] Failed to verify local Redis connection:', error);
        logger.error('[QueueRedis] Make sure local Redis is running: redis-server');
        throw error;
    }
}

module.exports = {
    getQueueRedisConnection,
    verifyQueueRedisConnection
};


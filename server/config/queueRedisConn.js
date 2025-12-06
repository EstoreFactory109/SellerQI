/**
 * queueRedisConn.js
 * 
 * Redis connection configuration for BullMQ.
 * 
 * Configuration: Uses Redis Cloud for Queue (Same as Cache)
 * ==========================================================
 * 
 * RECOMMENDED: Use the same Redis Cloud instance for both cache and queue.
 * BullMQ automatically prefixes queue keys with 'bullmq:' so there's no conflict.
 * 
 * Key Separation:
 * - Cache keys: 'analyse_data:userId:country:region:adminId'
 * - Queue keys: 'bullmq:user-data-processing:...' (automatically prefixed)
 * 
 * Both can safely use the same Redis Cloud instance without conflicts.
 * 
 * Environment Variables (Redis Cloud):
 * ====================================
 * - QUEUE_REDIS_HOST: Redis Cloud host (same as REDIS_HOST)
 * - QUEUE_REDIS_PORT: Redis Cloud port (usually 13335, same as cache)
 * - QUEUE_REDIS_USERNAME: 'default' (same as cache)
 * - QUEUE_REDIS_PASSWORD: Redis Cloud password (same as REDIS_PASSWORD)
 * 
 * If QUEUE_REDIS_HOST is not set, defaults to REDIS_HOST (Redis Cloud).
 * This ensures both cache and queue use the same Redis Cloud instance.
 * 
 * Local Redis (Development Only):
 * ================================
 * For local development, you can override to use local Redis:
 * - Set QUEUE_REDIS_HOST=localhost
 * - Set QUEUE_REDIS_PORT=6379
 * 
 * Note: Local Redis only works for single-instance deployment.
 * For multi-instance, you MUST use Redis Cloud or another shared Redis.
 */

const logger = require('../utils/Logger.js');

/**
 * Get Redis connection options for BullMQ
 * 
 * Uses Redis Cloud by default (same as cache), or local Redis if QUEUE_REDIS_HOST is set to localhost.
 * BullMQ uses 'bullmq:' prefix for all keys, so it won't conflict with cache keys.
 * 
 * @returns {Object} Redis connection options for BullMQ
 */
function getQueueRedisConnection() {
    // Default to Redis Cloud (same as cache) if QUEUE_REDIS_HOST not set
    // This ensures both cache and queue use the same Redis Cloud instance
    const defaultHost = process.env.QUEUE_REDIS_HOST || process.env.REDIS_HOST || 'localhost';
    const defaultPort = process.env.QUEUE_REDIS_PORT 
        ? parseInt(process.env.QUEUE_REDIS_PORT, 10)
        : (process.env.REDIS_HOST ? 13335 : 6379); // Redis Cloud port or local port
    
    const connectionOptions = {
        host: defaultHost,
        port: defaultPort,
        // Default to Redis Cloud credentials if using Redis Cloud
        username: process.env.QUEUE_REDIS_USERNAME || (process.env.REDIS_HOST ? 'default' : undefined),
        password: process.env.QUEUE_REDIS_PASSWORD || (process.env.REDIS_HOST ? process.env.REDIS_PASSWORD : undefined),
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

    const redisType = connectionOptions.host === 'localhost' || connectionOptions.host === '127.0.0.1' 
        ? 'local' 
        : 'Redis Cloud';
    logger.info(`[QueueRedis] Connecting to ${redisType} at ${connectionOptions.host}:${connectionOptions.port}`);

    return connectionOptions;
}

/**
 * Verify that Redis for queue is accessible
 * This checks the queue Redis instance (Redis Cloud by default, or local if configured)
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
        
        const redisType = connectionOptions.host === 'localhost' || connectionOptions.host === '127.0.0.1' 
            ? 'local' 
            : 'Redis Cloud';
        logger.info(`[QueueRedis] Verified ${redisType} connection is active`);
        return true;
    } catch (error) {
        logger.error('[QueueRedis] Failed to verify Redis connection:', error);
        if (connectionOptions.host === 'localhost' || connectionOptions.host === '127.0.0.1') {
        logger.error('[QueueRedis] Make sure local Redis is running: redis-server');
        } else {
            logger.error(`[QueueRedis] Make sure Redis Cloud at ${connectionOptions.host}:${connectionOptions.port} is accessible`);
            logger.error('[QueueRedis] Verify REDIS_HOST, REDIS_PASSWORD, and network connectivity');
        }
        throw error;
    }
}

module.exports = {
    getQueueRedisConnection,
    verifyQueueRedisConnection
};


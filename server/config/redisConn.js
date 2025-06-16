// config/redis.js
const { createClient } = require('redis');
const logger = require('../utils/Logger.js');

let redisClient = null;

const connectRedis = async () => {
    if (redisClient) {
        return redisClient;
    }

    try {
        redisClient = createClient({
            username: 'default',
            password: '1wIlUfUSIs8KpljSQQaJzeDXzdQNeEgW',
            socket: {
                host: 'redis-13335.c267.us-east-1-4.ec2.redns.redis-cloud.com',
                port: 13335
            }
        });

        redisClient.on('connect', () => {
            logger.info('✅ Connected to Redis Cloud!');
        });

        redisClient.on('error', (err) => {
            logger.error('❌ Redis connection error:', err);
        });

        await redisClient.connect();
        return redisClient;
    } catch (error) {
        logger.error('❌ Redis connection error:', error);
        throw error;
    }
};

const getRedisClient = () => {
    if (!redisClient) {
        throw new Error('Redis client not initialized. Call connectRedis() first.');
    }
    return redisClient;
};

module.exports = { connectRedis, getRedisClient };
/**
 * Clear all analyse_data cache entries from Redis.
 * Use after deploying recommendation/code changes so users get fresh data.
 *
 * Usage (from server directory): node scripts/clearAnalyseCache.js
 * Or from project root: node server/scripts/clearAnalyseCache.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { connectRedis, getRedisClient } = require('../config/redisConn');

async function clearCache() {
    try {
        await connectRedis();
        const redisClient = getRedisClient();
        const keys = await redisClient.keys('analyse_data:*');
        if (keys.length === 0) {
            console.log('No analyse cache keys found.');
            process.exit(0);
        }
        await redisClient.del(keys);
        console.log(`Cleared ${keys.length} cache entries (analyse_data:*).`);
        process.exit(0);
    } catch (err) {
        console.error('Failed to clear cache:', err.message);
        process.exit(1);
    }
}

clearCache();

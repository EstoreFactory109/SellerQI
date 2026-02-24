/**
 * Clear all application cache entries from Redis.
 * Includes: analyse_data:*, profitability-table-full:*
 * Use after deploying recommendation/code changes so users get fresh data.
 *
 * Usage (from project root): node server/scripts/clearAnalyseCache.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { connectRedis, getRedisClient } = require('../config/redisConn');

const CACHE_PATTERNS = [
    'analyse_data:*',
    'profitability-table-full:*',
    'ads_spend_by_asin:*'
];

async function clearCache() {
    try {
        await connectRedis();
        const redisClient = getRedisClient();
        let totalCleared = 0;

        for (const pattern of CACHE_PATTERNS) {
            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
                await redisClient.del(keys);
                console.log(`Cleared ${keys.length} keys (${pattern})`);
                totalCleared += keys.length;
            }
        }

        if (totalCleared === 0) {
            console.log('No cache keys found.');
        } else {
            console.log(`Done. Total cache entries cleared: ${totalCleared}`);
        }
        process.exit(0);
    } catch (err) {
        console.error('Failed to clear cache:', err.message);
        process.exit(1);
    }
}

clearCache();

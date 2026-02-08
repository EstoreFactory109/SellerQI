#!/usr/bin/env node

/**
 * Script to clear all Redis cache
 * Usage: node clear-redis-cache.js
 */

require('dotenv').config();
const { connectRedis, getRedisClient } = require('./server/config/redisConn');
const logger = require('./server/utils/Logger.js');

async function clearAllCache() {
    try {
        console.log('Connecting to Redis...');
        await connectRedis();
        const redisClient = getRedisClient();
        
        console.log('Fetching all cache keys...');
        
        // Get cache keys matching common patterns (exclude queue keys)
        const cachePatterns = [
            'analyse_data:*',
            'page_data:*',
            'economics:*',
            'asin_wise:*',
            'cache:*'
        ];
        
        let allKeys = [];
        for (const pattern of cachePatterns) {
            try {
                const keys = await redisClient.keys(pattern);
                if (keys && keys.length > 0) {
                    allKeys.push(...keys);
                    console.log(`Found ${keys.length} keys matching pattern: ${pattern}`);
                }
            } catch (error) {
                console.warn(`Error fetching keys for pattern ${pattern}:`, error.message);
            }
        }
        
        // Remove duplicates
        allKeys = [...new Set(allKeys)];
        
        if (allKeys.length === 0) {
            console.log('✅ No cache keys found. Cache is already clear!');
            console.log('Note: Queue keys (bullmq:*) are preserved.');
            process.exit(0);
        }
        
        console.log(`\nFound ${allKeys.length} cache keys to clear`);
        console.log('Sample cache keys:', allKeys.slice(0, 5));
        
        console.log(`\nTotal unique keys to delete: ${allKeys.length}`);
        console.log('Sample keys:', allKeys.slice(0, 5));
        
        // Delete all keys
        if (allKeys.length > 0) {
            // Delete in batches to avoid overwhelming Redis
            const batchSize = 100;
            let deleted = 0;
            
            for (let i = 0; i < allKeys.length; i += batchSize) {
                const batch = allKeys.slice(i, i + batchSize);
                await redisClient.del(batch);
                deleted += batch.length;
                console.log(`Deleted ${deleted}/${allKeys.length} keys...`);
            }
            
            console.log(`\n✅ Successfully cleared ${deleted} cache entries!`);
        }
        
        // Verify by checking remaining keys
        const remainingKeys = await redisClient.keys('analyse_data:*');
        console.log(`Remaining 'analyse_data:*' keys: ${remainingKeys.length}`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error clearing cache:', error);
        logger.error('Error clearing cache:', error);
        process.exit(1);
    }
}

// Run the script
clearAllCache();

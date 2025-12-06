/**
 * check-redis-memory.js
 * 
 * Check current Redis Cloud memory usage including cache and queue
 * 
 * Usage:
 *   node check-redis-memory.js
 */

require('dotenv').config();
const { createClient } = require('redis');

async function checkRedisMemory() {
    const client = createClient({
        username: 'default',
        password: process.env.REDIS_PASSWORD,
        socket: {
            host: process.env.REDIS_HOST,
            port: 13335
        }
    });

    try {
        await client.connect();
        
        console.log('\n📊 Redis Cloud Memory Analysis\n');
        console.log('='.repeat(60));
        
        // Get memory info
        const info = await client.info('memory');
        const memoryLines = info.split('\r\n');
        
        const usedMemory = memoryLines.find(line => line.startsWith('used_memory:'));
        const usedMemoryHuman = memoryLines.find(line => line.startsWith('used_memory_human:'));
        const maxMemory = memoryLines.find(line => line.startsWith('maxmemory:'));
        const maxMemoryHuman = memoryLines.find(line => line.startsWith('maxmemory_human:'));
        
        if (usedMemory && maxMemory) {
            const used = parseInt(usedMemory.split(':')[1]);
            const max = parseInt(maxMemory.split(':')[1]);
            const usagePercent = max > 0 ? (used / max) * 100 : 0;
            
            console.log('\n💾 Total Memory Usage:');
            console.log(`   Used: ${usedMemoryHuman?.split(':')[1] || 'N/A'}`);
            console.log(`   Max:  ${maxMemoryHuman?.split(':')[1] || 'N/A'}`);
            console.log(`   Usage: ${usagePercent.toFixed(1)}%`);
            
            if (usagePercent > 80) {
                console.log('   ⚠️  WARNING: Memory usage > 80% - consider upgrading');
            } else if (usagePercent > 60) {
                console.log('   ⚠️  CAUTION: Memory usage > 60% - monitor closely');
            } else {
                console.log('   ✅ Memory usage is healthy');
            }
        }
        
        // Count cache keys
        const cacheKeys = await client.keys('analyse_data:*');
        console.log(`\n📦 Cache Keys: ${cacheKeys.length}`);
        
        // Count queue keys
        const queueKeys = await client.keys('bullmq:*');
        console.log(`📋 Queue Keys: ${queueKeys.length}`);
        
        // Estimate cache memory (sample a few keys)
        let cacheSampleSize = 0;
        const sampleSize = Math.min(10, cacheKeys.length);
        if (sampleSize > 0) {
            for (let i = 0; i < sampleSize; i++) {
                const key = cacheKeys[i];
                const value = await client.get(key);
                if (value) {
                    cacheSampleSize += Buffer.byteLength(value, 'utf8');
                }
            }
            const avgCacheSize = cacheSampleSize / sampleSize;
            const estimatedCacheMemory = (avgCacheSize * cacheKeys.length) / (1024 * 1024); // MB
            console.log(`\n💡 Estimated Cache Memory: ~${estimatedCacheMemory.toFixed(2)} MB`);
        }
        
        // Estimate queue memory
        const estimatedQueueMemory = (queueKeys.length * 3) / 1024; // 3KB per job
        console.log(`💡 Estimated Queue Memory: ~${estimatedQueueMemory.toFixed(2)} MB`);
        
        // Calculate breakdown
        if (usedMemory) {
            const used = parseInt(usedMemory.split(':')[1]);
            const usedMB = used / (1024 * 1024);
            const estimatedCacheMB = cacheKeys.length > 0 ? (cacheSampleSize / sampleSize * cacheKeys.length) / (1024 * 1024) : 0;
            const estimatedQueueMB = (queueKeys.length * 3) / 1024;
            const otherMB = usedMB - estimatedCacheMB - estimatedQueueMB;
            
            console.log('\n📊 Memory Breakdown (Estimated):');
            console.log(`   Cache:  ~${estimatedCacheMB.toFixed(2)} MB (${((estimatedCacheMB/usedMB)*100).toFixed(1)}%)`);
            console.log(`   Queue:  ~${estimatedQueueMB.toFixed(2)} MB (${((estimatedQueueMB/usedMB)*100).toFixed(1)}%)`);
            console.log(`   Other:  ~${otherMB.toFixed(2)} MB (${((otherMB/usedMB)*100).toFixed(1)}%)`);
            console.log(`   Total:  ~${usedMB.toFixed(2)} MB`);
        }
        
        // Recommendations
        console.log('\n💡 Recommendations:');
        if (cacheKeys.length > 1000) {
            console.log('   - Consider implementing cache TTL to prevent unlimited growth');
        }
        if (queueKeys.length > 5000) {
            console.log('   - Queue depth is high - consider scaling workers');
        }
        if (maxMemory && usedMemory) {
            const used = parseInt(usedMemory.split(':')[1]);
            const max = parseInt(maxMemory.split(':')[1]);
            const usagePercent = (used / max) * 100;
            if (usagePercent > 60) {
                console.log('   - Consider upgrading Redis Cloud plan for more memory');
            }
        }
        
        // For 500 users/day capacity check
        console.log('\n📈 Capacity Check (500 users/day):');
        const queueCapacity = (maxMemory ? parseInt(maxMemory.split(':')[1]) : 250 * 1024 * 1024) - (usedMemory ? parseInt(usedMemory.split(':')[1]) : 0);
        const queueCapacityMB = queueCapacity / (1024 * 1024);
        const maxWaitingJobs = (queueCapacityMB * 1024) / 3; // 3KB per job
        
        console.log(`   Available memory: ~${queueCapacityMB.toFixed(2)} MB`);
        console.log(`   Can handle: ~${Math.floor(maxWaitingJobs)} waiting jobs`);
        
        if (maxWaitingJobs > 10000) {
            console.log('   ✅ Sufficient capacity for 500 users/day');
        } else if (maxWaitingJobs > 5000) {
            console.log('   ⚠️  Capacity is adequate but monitor closely');
        } else {
            console.log('   ❌ Capacity may be insufficient - consider upgrading');
        }
        
        console.log('\n' + '='.repeat(60) + '\n');
        
    } catch (error) {
        console.error('❌ Error checking Redis memory:', error.message);
    } finally {
        await client.quit();
    }
}

checkRedisMemory();


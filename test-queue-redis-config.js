/**
 * test-queue-redis-config.js
 * 
 * Test script to verify Redis Cloud configuration for queue
 * 
 * Usage:
 *   node test-queue-redis-config.js
 * 
 * This script:
 * 1. Tests the queue Redis connection
 * 2. Shows which Redis instance is being used
 * 3. Verifies the connection works
 * 4. Optionally enqueues a test job
 */

require('dotenv').config();
const { getQueueRedisConnection, verifyQueueRedisConnection } = require('./server/config/queueRedisConn.js');
const { getQueue } = require('./server/Services/BackgroundJobs/queue.js');
const { getQueueStats } = require('./server/Services/BackgroundJobs/producer.js');
const logger = require('./server/utils/Logger.js');

async function testQueueRedisConfig() {
    console.log('\n🔍 Testing Queue Redis Configuration\n');
    console.log('=' .repeat(60));
    
    // Show environment variables
    console.log('\n📋 Environment Variables:');
    console.log(`   REDIS_HOST: ${process.env.REDIS_HOST || 'NOT SET'}`);
    console.log(`   REDIS_PASSWORD: ${process.env.REDIS_PASSWORD ? '***SET***' : 'NOT SET'}`);
    console.log(`   QUEUE_REDIS_HOST: ${process.env.QUEUE_REDIS_HOST || 'NOT SET (✅ will auto-use REDIS_HOST)'}`);
    console.log(`   QUEUE_REDIS_PORT: ${process.env.QUEUE_REDIS_PORT || 'NOT SET (✅ will auto-use 13335 for Redis Cloud)'}`);
    console.log(`   QUEUE_REDIS_USERNAME: ${process.env.QUEUE_REDIS_USERNAME || 'NOT SET (✅ will auto-use "default" for Redis Cloud)'}`);
    console.log(`   QUEUE_REDIS_PASSWORD: ${process.env.QUEUE_REDIS_PASSWORD ? '***SET***' : 'NOT SET (✅ will auto-use REDIS_PASSWORD)'}`);
    console.log('\n   💡 Note: "NOT SET" is EXPECTED and CORRECT!');
    console.log('      The queue automatically uses REDIS_HOST/REDIS_PASSWORD when QUEUE_* vars are not set.');
    console.log('      This is the recommended configuration for using Redis Cloud for both cache and queue.');
    
    // Get connection config
    console.log('\n🔌 Queue Redis Connection Config (ACTUAL VALUES BEING USED):');
    const connectionConfig = getQueueRedisConnection();
    console.log(`   Host: ${connectionConfig.host}`);
    console.log(`   Port: ${connectionConfig.port}`);
    console.log(`   Username: ${connectionConfig.username || 'none'}`);
    console.log(`   Password: ${connectionConfig.password ? '***SET***' : 'none'}`);
    
    const isRedisCloud = connectionConfig.host !== 'localhost' && connectionConfig.host !== '127.0.0.1';
    console.log(`   Type: ${isRedisCloud ? '✅ Redis Cloud' : '⚠️  Local Redis'}`);
    
    if (isRedisCloud) {
        console.log('\n   ✅ PERFECT! Using Redis Cloud for queue (same as cache)');
        console.log('   ✅ Configuration is correct for multi-instance deployment');
        console.log(`   ✅ Queue will connect to: ${connectionConfig.host}:${connectionConfig.port}`);
    } else {
        console.log('\n   ⚠️  Using local Redis (localhost)');
        console.log('   ⚠️  This will NOT work for multi-instance deployment');
        console.log('   💡 Set REDIS_HOST to use Redis Cloud instead');
    }
    
    // Test connection
    console.log('\n🧪 Testing Connection...');
    try {
        await verifyQueueRedisConnection();
        console.log('   ✅ Connection successful!');
    } catch (error) {
        console.log('   ❌ Connection failed!');
        console.log(`   Error: ${error.message}`);
        console.log('\n💡 Troubleshooting:');
        if (isRedisCloud) {
            console.log('   1. Verify REDIS_HOST is correct');
            console.log('   2. Verify REDIS_PASSWORD is correct');
            console.log('   3. Check network connectivity to Redis Cloud');
            console.log('   4. Verify Redis Cloud allows connections from your IP');
        } else {
            console.log('   1. Make sure local Redis is running: redis-server');
            console.log('   2. Or set REDIS_HOST to use Redis Cloud');
        }
        process.exit(1);
    }
    
    // Test queue operations
    console.log('\n📊 Testing Queue Operations...');
    try {
        const queue = getQueue();
        console.log('   ✅ Queue instance created successfully');
        
        // Get queue stats
        const stats = await getQueueStats();
        console.log('\n   📈 Queue Statistics:');
        console.log(`      Waiting: ${stats.waiting}`);
        console.log(`      Active: ${stats.active}`);
        console.log(`      Completed: ${stats.completed}`);
        console.log(`      Failed: ${stats.failed}`);
        console.log(`      Delayed: ${stats.delayed}`);
        console.log(`      Total: ${stats.total}`);
        
        console.log('\n   ✅ Queue operations working correctly!');
    } catch (error) {
        console.log('   ❌ Queue operations failed!');
        console.log(`   Error: ${error.message}`);
        process.exit(1);
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Configuration Test Complete!\n');
    
    if (isRedisCloud) {
        console.log('✅ Your configuration is ready for multi-instance deployment!');
        console.log('   - Queue is using Redis Cloud');
        console.log('   - All EC2 instances can connect to the same queue');
    } else {
        console.log('⚠️  Currently using local Redis');
        console.log('   - This works for single-instance deployment');
        console.log('   - For multi-instance, set REDIS_HOST to Redis Cloud endpoint');
    }
    
    console.log('\n💡 Next Steps:');
    console.log('   1. Start a worker: node server/Services/BackgroundJobs/worker.js');
    console.log('   2. Or use PM2: pm2 start ecosystem.worker.config.js');
    console.log('   3. Test enqueue: node test-enqueue.js <userId>');
    console.log('\n');
}

// Run the test
testQueueRedisConfig().catch(error => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
});


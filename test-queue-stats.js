// test-queue-stats.js
// Quick script to check queue statistics

require('dotenv').config();
const { getQueueStats } = require('./server/Services/BackgroundJobs/producer.js');

async function test() {
    try {
        console.log('📊 Fetching queue statistics...\n');
        const stats = await getQueueStats();
        
        console.log('Queue Statistics:');
        console.log('================');
        console.log(`⏳ Waiting:    ${stats.waiting}`);
        console.log(`🔄 Active:     ${stats.active}`);
        console.log(`✅ Completed:  ${stats.completed}`);
        console.log(`❌ Failed:     ${stats.failed}`);
        console.log(`⏰ Delayed:    ${stats.delayed}`);
        console.log(`📦 Total:      ${stats.total}`);
        
        if (stats.waiting > 0) {
            console.log(`\n⚠️  ${stats.waiting} jobs waiting - make sure workers are running!`);
        }
        
        if (stats.active > 0) {
            console.log(`\n✅ ${stats.active} jobs currently being processed`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    }
    process.exit(0);
}

test();


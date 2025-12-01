// test-enqueue.js
// Quick script to manually enqueue a user for testing

require('dotenv').config();
const { enqueueUser } = require('./server/Services/BackgroundJobs/producer.js');

async function test() {
    try {
        // Replace with a real user ID from your database
        const testUserId = process.argv[2] || 'YOUR_USER_ID_HERE'; // Pass as argument or edit here
        
        if (testUserId === 'YOUR_USER_ID_HERE') {
            console.log('❌ Please provide a user ID:');
            console.log('   node test-enqueue.js YOUR_USER_ID');
            console.log('\n   OR edit this file and replace YOUR_USER_ID_HERE');
            process.exit(1);
        }
        
        console.log(`🚀 Enqueuing test user: ${testUserId}`);
        const result = await enqueueUser(testUserId, {
            enqueuedBy: 'manual-test'
        });
        
        console.log('\n✅ Result:', JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log(`\n✅ User enqueued successfully!`);
            console.log(`📋 Job ID: ${result.jobId}`);
            console.log(`👀 Watch your worker terminal to see it process...`);
        } else {
            console.log(`\n⚠️  ${result.message}`);
            if (result.existingJob) {
                console.log(`📋 Existing Job ID: ${result.jobId}`);
            }
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    }
    process.exit(0);
}

test();


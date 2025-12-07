// diagnose-queue.js
// Comprehensive diagnostic script to understand why jobs aren't being enqueued

require('dotenv').config();
const dbConnect = require('./server/config/dbConn.js');
const UserUpdateSchedule = require('./server/models/user-auth/UserUpdateScheduleModel.js');
const User = require('./server/models/user-auth/userModel.js');
const { enqueueUser, getQueueStats } = require('./server/Services/BackgroundJobs/producer.js');
const { UserSchedulingService } = require('./server/Services/BackgroundJobs/UserSchedulingService.js');

async function diagnose() {
    try {
        console.log('🔌 Connecting to database...');
        await dbConnect();
        console.log('✅ Connected to database\n');

        // Get current time info
        const now = new Date();
        const currentHour = now.getUTCHours();
        const currentTime = now.toISOString();
        console.log('⏰ Current Time Info:');
        console.log('====================');
        console.log(`UTC Time:      ${currentTime}`);
        console.log(`Current Hour:  ${currentHour}:00 UTC\n`);

        // Check total schedules
        const totalSchedules = await UserUpdateSchedule.countDocuments();
        console.log(`📊 Total User Schedules: ${totalSchedules}\n`);

        if (totalSchedules === 0) {
            console.log('⚠️  No user schedules found!');
            console.log('   Users need to have schedules initialized before they can be enqueued.\n');
            return;
        }

        // Check users by hour
        console.log('📅 Users Scheduled by Hour:');
        console.log('===========================');
        for (let hour = 0; hour < 24; hour++) {
            const count = await UserUpdateSchedule.countDocuments({ dailyUpdateHour: hour });
            const marker = hour === currentHour ? ' ⬅️  CURRENT HOUR' : '';
            console.log(`Hour ${hour.toString().padStart(2, '0')}:00 UTC - ${count} users${marker}`);
        }
        console.log('');

        // Check users needing updates (current hour)
        console.log('🔍 Checking Users Needing Updates (Current Hour):');
        console.log('================================================');
        const usersNeedingUpdate = await UserSchedulingService.getUsersNeedingDailyUpdate();
        console.log(`Found: ${usersNeedingUpdate.length} users needing updates at hour ${currentHour}\n`);

        if (usersNeedingUpdate.length === 0) {
            console.log('❌ No users found. Reasons could be:');
            console.log('   1. No users scheduled for hour ' + currentHour);
            console.log('   2. All users were updated in the last 24 hours');
            console.log('   3. Users are not verified\n');

            // Show detailed breakdown
            const schedulesForThisHour = await UserUpdateSchedule.find({
                dailyUpdateHour: currentHour
            }).populate('userId');

            console.log(`📋 Detailed Breakdown for Hour ${currentHour}:`);
            console.log('===========================================');
            console.log(`Total schedules for this hour: ${schedulesForThisHour.length}`);

            let verifiedCount = 0;
            let notVerifiedCount = 0;
            let updatedRecentlyCount = 0;
            let neverUpdatedCount = 0;

            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

            for (const schedule of schedulesForThisHour) {
                if (!schedule.userId) {
                    console.log(`   ⚠️  Schedule has no userId (orphaned)`);
                    continue;
                }

                if (!schedule.userId.isVerified) {
                    notVerifiedCount++;
                } else {
                    verifiedCount++;
                }

                if (!schedule.lastDailyUpdate) {
                    neverUpdatedCount++;
                } else if (schedule.lastDailyUpdate >= twentyFourHoursAgo) {
                    updatedRecentlyCount++;
                }
            }

            console.log(`   ✅ Verified users: ${verifiedCount}`);
            console.log(`   ❌ Not verified: ${notVerifiedCount}`);
            console.log(`   ⏰ Updated in last 24h: ${updatedRecentlyCount}`);
            console.log(`   🆕 Never updated: ${neverUpdatedCount}\n`);

            // Show sample users
            if (schedulesForThisHour.length > 0) {
                console.log('📝 Sample Users (first 5):');
                for (let i = 0; i < Math.min(5, schedulesForThisHour.length); i++) {
                    const s = schedulesForThisHour[i];
                    const lastUpdate = s.lastDailyUpdate 
                        ? s.lastDailyUpdate.toISOString() 
                        : 'Never';
                    const verified = s.userId?.isVerified ? '✅' : '❌';
                    console.log(`   ${verified} User: ${s.userId?._id || 'N/A'}, Last Update: ${lastUpdate}`);
                }
                console.log('');
            }
        } else {
            console.log(`✅ Found ${usersNeedingUpdate.length} users that should be enqueued!\n`);

            // Try to enqueue them
            console.log('🚀 Attempting to enqueue users...');
            const userIds = usersNeedingUpdate
                .map(schedule => schedule.userId?._id?.toString())
                .filter(id => id);

            console.log(`   Extracted ${userIds.length} valid user IDs\n`);

            if (userIds.length > 0) {
                // Try enqueueing first user as test
                console.log(`🧪 Testing with first user: ${userIds[0]}`);
                try {
                    const result = await enqueueUser(userIds[0], {
                        enqueuedBy: 'diagnostic-test'
                    });
                    
                    if (result.success) {
                        console.log(`   ✅ Successfully enqueued! Job ID: ${result.jobId}\n`);
                    } else {
                        console.log(`   ⚠️  ${result.message}`);
                        if (result.existingJob) {
                            console.log(`   📋 Existing Job ID: ${result.jobId}\n`);
                        }
                    }
                } catch (error) {
                    console.log(`   ❌ Error: ${error.message}\n`);
                }

                // Check queue stats
                const stats = await getQueueStats();
                console.log('📈 Current Queue Status:');
                console.log('========================');
                console.log(`⏳ Waiting:    ${stats.waiting}`);
                console.log(`🔄 Active:     ${stats.active}`);
                console.log(`✅ Completed:  ${stats.completed}`);
                console.log(`❌ Failed:     ${stats.failed}`);
                console.log(`⏰ Delayed:    ${stats.delayed}`);
                console.log(`📦 Total:      ${stats.total}\n`);
            }
        }

        // Option to test with specific user
        const testUserId = process.argv[2];
        if (testUserId) {
            console.log(`\n🧪 Testing Manual Enqueue for User: ${testUserId}`);
            console.log('==========================================');
            try {
                const result = await enqueueUser(testUserId, {
                    enqueuedBy: 'manual-test'
                });
                
                if (result.success) {
                    console.log(`✅ Successfully enqueued! Job ID: ${result.jobId}`);
                } else {
                    console.log(`⚠️  ${result.message}`);
                    if (result.existingJob) {
                        console.log(`📋 Existing Job ID: ${result.jobId}`);
                    }
                }

                const stats = await getQueueStats();
                console.log(`\n📈 Queue Status After Test:`);
                console.log(`⏳ Waiting: ${stats.waiting}`);
                console.log(`🔄 Active: ${stats.active}`);
            } catch (error) {
                console.log(`❌ Error: ${error.message}`);
            }
        } else {
            console.log('\n💡 Tip: Test with a specific user ID:');
            console.log('   node diagnose-queue.js YOUR_USER_ID');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    }
    process.exit(0);
}

diagnose();



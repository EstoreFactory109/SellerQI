/**
 * test-scheduled-integration.js
 * 
 * Test script for the new Scheduled Integration system
 * 
 * Usage:
 *   node test-scheduled-integration.js <userId> <country> <region>
 * 
 * Example:
 *   node test-scheduled-integration.js 69321e2e16696f839efbcc0b US NA
 */

require('dotenv').config();
const { ScheduledIntegration } = require('./server/Services/schedule/ScheduledIntegration.js');
const { getFunctionsForDay } = require('./server/Services/schedule/ScheduleConfig.js');
const logger = require('./server/utils/Logger.js');
const dbConnect = require('./server/config/dbConn.js');

async function testScheduledIntegration() {
    try {
        // Initialize database connection first
        console.log('🔌 Connecting to database...');
        try {
            await dbConnect();
            console.log('✅ Database connected\n');
        } catch (dbError) {
            console.error('❌ Failed to connect to database:', dbError.message);
            console.error('⚠️  Continuing anyway, but database operations may fail...\n');
        }

        // Get arguments
        const userId = process.argv[2];
        const country = process.argv[3] || 'US';
        const region = process.argv[4] || 'NA';
        const dayArg = process.argv[5]; // Optional: day to test (0-6 or day name)

        if (!userId) {
            console.log('❌ Please provide a user ID:');
            console.log('   node test-scheduled-integration.js <userId> [country] [region] [day]');
            console.log('\n   Examples:');
            console.log('   node test-scheduled-integration.js 69321e2e16696f839efbcc0b US NA');
            console.log('   node test-scheduled-integration.js 69321e2e16696f839efbcc0b US NA 0    # Sunday');
            console.log('   node test-scheduled-integration.js 69321e2e16696f839efbcc0b US NA monday  # Monday');
            console.log('   node test-scheduled-integration.js 69321e2e16696f839efbcc0b US NA saturday  # Saturday');
            process.exit(1);
        }

        // Get day of week (current day or specified day)
        let dayOfWeek;
        let dayName;
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        if (dayArg) {
            // Parse day argument
            const dayLower = dayArg.toLowerCase();
            const dayMap = {
                '0': 0, 'sunday': 0, 'sun': 0,
                '1': 1, 'monday': 1, 'mon': 1,
                '2': 2, 'tuesday': 2, 'tue': 2,
                '3': 3, 'wednesday': 3, 'wed': 3,
                '4': 4, 'thursday': 4, 'thu': 4,
                '5': 5, 'friday': 5, 'fri': 5,
                '6': 6, 'saturday': 6, 'sat': 6
            };
            
            if (dayMap[dayLower] !== undefined) {
                dayOfWeek = dayMap[dayLower];
                dayName = dayNames[dayOfWeek];
                console.log(`📌 Testing for: ${dayName} (simulated, not current day)\n`);
            } else {
                console.log(`⚠️  Invalid day argument: ${dayArg}`);
                console.log('   Using current day instead\n');
                dayOfWeek = new Date().getDay();
                dayName = dayNames[dayOfWeek];
            }
        } else {
            dayOfWeek = new Date().getDay();
            dayName = dayNames[dayOfWeek];
        }
        
        const currentDay = dayName;

        console.log('\n🧪 Testing Scheduled Integration System');
        console.log('=====================================\n');
        console.log(`📅 Current Day: ${currentDay} (${dayOfWeek})`);
        console.log(`👤 User ID: ${userId}`);
        console.log(`🌍 Country: ${country}`);
        console.log(`🌎 Region: ${region}\n`);

        // Show which functions will run today
        const scheduledFunctions = getFunctionsForDay(dayOfWeek);
        const functionKeys = Object.keys(scheduledFunctions);
        
        console.log(`📋 Functions scheduled for ${currentDay}: ${functionKeys.length}\n`);
        functionKeys.forEach((key, index) => {
            const config = scheduledFunctions[key];
            console.log(`   ${index + 1}. ${config.description || key}`);
            if (config.requiresAccessToken) console.log('      - Requires SP-API Token');
            if (config.requiresAdsToken) console.log('      - Requires Ads Token');
            if (config.requiresRefreshToken) console.log('      - Requires Refresh Token');
        });

        console.log('\n🚀 Starting scheduled integration...\n');
        const startTime = Date.now();

        // Call ScheduledIntegration with optional day override for testing
        const result = await ScheduledIntegration.getScheduledApiData(userId, region, country, dayOfWeek);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log('\n📊 Results:');
        console.log('=====================================\n');
        console.log(`✅ Success: ${result.success}`);
        console.log(`📈 Status Code: ${result.statusCode}`);
        console.log(`⏱️  Duration: ${duration}s\n`);

        if (result.summary) {
            console.log('📈 Summary:');
            console.log(`   Total Services: ${result.summary.totalServices}`);
            console.log(`   Successful: ${result.summary.successfulServices}`);
            console.log(`   Failed: ${result.summary.failedServices}`);
            console.log(`   Success Rate: ${result.summary.successRate}\n`);

            if (result.summary.successful && result.summary.successful.length > 0) {
                console.log('✅ Successful Services:');
                result.summary.successful.forEach(service => {
                    console.log(`   - ${service}`);
                });
                console.log('');
            }

            if (result.summary.failed && result.summary.failed.length > 0) {
                console.log('❌ Failed Services:');
                result.summary.failed.forEach(service => {
                    console.log(`   - ${service}`);
                });
                console.log('');
            }

            if (result.summary.warnings && result.summary.warnings.length > 0) {
                console.log('⚠️  Warnings:');
                result.summary.warnings.forEach(warning => {
                    console.log(`   - ${warning}`);
                });
                console.log('');
            }
        }

        if (result.error) {
            console.log('❌ Error:', result.error);
            
            // Provide helpful suggestions for common errors
            if (result.error.includes('No seller account found')) {
                console.log('\n💡 Suggestion:');
                console.log('   This user may not have a seller account for this region/country combination.');
                console.log('   Try using a different country/region, or check the user\'s seller accounts in the database.');
            } else if (result.error.includes('Database connection')) {
                console.log('\n💡 Suggestion:');
                console.log('   Check your MongoDB connection string in .env file');
                console.log('   Ensure MongoDB server is running and accessible');
            } else if (result.error.includes('token')) {
                console.log('\n💡 Suggestion:');
                console.log('   This user may be missing required tokens (SP-API or Ads tokens)');
                console.log('   Check the user\'s seller account configuration in the database');
            }
        }

        if (result.data) {
            const dataKeys = Object.keys(result.data);
            console.log(`📦 Data Keys Retrieved: ${dataKeys.length}`);
            dataKeys.forEach(key => {
                const dataItem = result.data[key];
                if (dataItem && typeof dataItem === 'object') {
                    const success = dataItem.success !== false;
                    const status = success ? '✅' : '❌';
                    console.log(`   ${status} ${key}: ${success ? 'Success' : dataItem.error || 'Failed'}`);
                }
            });
        }

        console.log('\n✅ Test completed!\n');

    } catch (error) {
        console.error('\n❌ Test failed with error:');
        console.error(error.message);
        console.error('\nStack trace:');
        console.error(error.stack);
        process.exit(1);
    } finally {
        // Close database connection
        try {
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState === 1) {
                await mongoose.connection.close();
                console.log('🔌 Database connection closed');
            }
        } catch (closeError) {
            // Ignore errors when closing
        }
    }
    
    process.exit(0);
}

// Run the test
testScheduledIntegration();


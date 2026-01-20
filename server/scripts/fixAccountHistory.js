/**
 * Script to fix missing account history for a specific account
 * This will trigger the account history creation process
 * 
 * Usage: node scripts/fixAccountHistory.js <userId> <country> <region>
 * Example: node scripts/fixAccountHistory.js 6941dd95e1cff3f900a726b6 AU FE
 */

// Load environment variables
require('dotenv').config();

const dbConnect = require('../config/dbConn.js');
const { Integration } = require('../Services/main/Integration.js');
const AccountHistory = require('../models/user-auth/AccountHistory.js');
const logger = require('../utils/Logger.js');

const [,, userId, country, region] = process.argv;

if (!userId || !country || !region) {
    console.error('\n❌ Missing required parameters');
    console.error('Usage: node scripts/fixAccountHistory.js <userId> <country> <region>');
    console.error('Example: node scripts/fixAccountHistory.js 6941dd95e1cff3f900a726b6 AU FE\n');
    process.exit(1);
}

async function fixAccountHistory() {
    // Ensure database connection is established
    try {
        // Check if DB_URI and DB_NAME are set
        if (!process.env.DB_URI || !process.env.DB_NAME) {
            console.error('\n❌ Missing database configuration:');
            console.error(`   DB_URI: ${process.env.DB_URI ? 'Set' : 'NOT SET'}`);
            console.error(`   DB_NAME: ${process.env.DB_NAME ? 'Set' : 'NOT SET'}`);
            console.error('   Please check your .env file\n');
            process.exit(1);
        }

        await dbConnect();
        console.log('✅ Database connected\n');
    } catch (dbError) {
        console.error('\n❌ Failed to connect to database:');
        console.error(`   Error: ${dbError.message}`);
        
        // Provide helpful debugging info
        if (dbError.message.includes('Invalid scheme')) {
            console.error('\n   💡 Tip: Check that DB_URI in your .env file starts with "mongodb://" or "mongodb+srv://"');
            console.error('   Example: DB_URI=mongodb+srv://username:password@cluster.mongodb.net\n');
        }
        
        process.exit(1);
    }
    try {
        console.log(`\n🔍 Checking account history for User: ${userId}, Country: ${country}, Region: ${region}\n`);

        // Check current state
        const existingHistory = await AccountHistory.findOne({ 
            User: userId, 
            country: country, 
            region: region 
        });

        if (existingHistory) {
            console.log('📊 Current account history status:');
            console.log(`   - Record exists: Yes`);
            console.log(`   - Number of entries: ${existingHistory.accountHistory?.length || 0}`);
            
            if (existingHistory.accountHistory && existingHistory.accountHistory.length > 0) {
                const lastEntry = existingHistory.accountHistory[existingHistory.accountHistory.length - 1];
                console.log(`   - Last entry date: ${lastEntry.Date}`);
                console.log(`   - Last entry expiry: ${lastEntry.expireDate}`);
                console.log(`   - Last entry health score: ${lastEntry.HealthScore}`);
            } else {
                console.log('   - ⚠️  Record exists but has NO entries');
            }
        } else {
            console.log('📊 Current account history status:');
            console.log('   - Record exists: No');
            console.log('   - ⚠️  No account history found');
        }

        console.log('\n🔄 Attempting to create/update account history...\n');

        // Call the integration service to create account history
        const result = await Integration.addNewAccountHistory(userId, country, region);

        console.log('✅ Account history process completed successfully!\n');

        // Verify the result
        const updatedHistory = await AccountHistory.findOne({ 
            User: userId, 
            country: country, 
            region: region 
        });

        if (updatedHistory) {
            console.log('📊 Updated account history status:');
            console.log(`   - Record exists: Yes`);
            console.log(`   - Number of entries: ${updatedHistory.accountHistory?.length || 0}`);
            
            if (updatedHistory.accountHistory && updatedHistory.accountHistory.length > 0) {
                const lastEntry = updatedHistory.accountHistory[updatedHistory.accountHistory.length - 1];
                console.log(`   - Last entry date: ${lastEntry.Date}`);
                console.log(`   - Last entry expiry: ${lastEntry.expireDate}`);
                console.log(`   - Last entry health score: ${lastEntry.HealthScore}`);
                console.log(`   - Last entry total products: ${lastEntry.TotalProducts}`);
                console.log(`   - Last entry products with issues: ${lastEntry.ProductsWithIssues}`);
                console.log(`   - Last entry total issues: ${lastEntry.TotalNumberOfIssues}`);
                console.log('\n✅ Account history has been successfully created/updated!\n');
            } else {
                console.log('   - ⚠️  Record exists but still has NO entries');
                console.log('   - This might indicate an issue with the data calculation\n');
            }
        } else {
            console.log('❌ Account history record was not created');
            console.log('   - This might indicate an error during the process\n');
        }

    } catch (error) {
        console.error('\n❌ Error fixing account history:');
        console.error(`   Error: ${error.message}`);
        if (error.stack) {
            console.error(`   Stack: ${error.stack}`);
        }
        console.error('\n');
        logger.error('Error in fixAccountHistory script', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
    } finally {
        // Wait a bit for logs to flush, then exit
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    }
}

// Run the script
fixAccountHistory().catch((error) => {
    console.error('\n❌ Unexpected error:', error);
    process.exit(1);
});

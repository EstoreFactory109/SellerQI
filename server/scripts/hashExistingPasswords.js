/**
 * Migration Script: Hash Existing Plain-Text Passwords
 * 
 * This script migrates all existing plain-text passwords to bcrypt hashed passwords.
 * It's safe to run multiple times as it checks if passwords are already hashed.
 * 
 * Usage: 
 *   - Test on single user: node server/scripts/hashExistingPasswords.js <email|userId>
 *   - Process all users:   node server/scripts/hashExistingPasswords.js
 * 
 * Examples:
 *   node server/scripts/hashExistingPasswords.js user@example.com
 *   node server/scripts/hashExistingPasswords.js 507f1f77bcf86cd799439011
 * 
 * Requirements:
 * - DB_URI and DB_NAME must be set in .env file
 * - All users must have passwords (required field)
 */

// Load environment variables
require('dotenv').config();

const dbConnect = require('../config/dbConn.js');
const UserModel = require('../models/user-auth/userModel.js');
const { hashPassword } = require('../utils/HashPassword.js');
const logger = require('../utils/Logger.js');
const mongoose = require('mongoose');

/**
 * Check if a password is already hashed
 * Bcrypt hashes start with $2a$, $2b$, or $2y$ and are 60 characters long
 */
function isPasswordHashed(password) {
    if (!password || typeof password !== 'string') {
        return false;
    }
    
    // Bcrypt hash format: $2a$10$... (60 characters total)
    // Also check for $2b$ and $2y$ variants
    const bcryptHashPattern = /^\$2[aby]\$\d{2}\$.{53}$/;
    return bcryptHashPattern.test(password);
}

async function hashExistingPasswords() {
    let totalUsers = 0;
    let hashedCount = 0;
    let alreadyHashedCount = 0;
    let errorCount = 0;
    let skippedCount = 0; // Users without passwords

    // Get user identifier from command line arguments (optional)
    const userIdentifier = process.argv[2];
    let isSingleUserMode = false;

    try {
        // Check if DB_URI and DB_NAME are set
        if (!process.env.DB_URI || !process.env.DB_NAME) {
            console.error('\n❌ Missing database configuration:');
            console.error(`   DB_URI: ${process.env.DB_URI ? 'Set' : 'NOT SET'}`);
            console.error(`   DB_NAME: ${process.env.DB_NAME ? 'Set' : 'NOT SET'}`);
            console.error('   Please check your .env file\n');
            process.exit(1);
        }

        console.log('\n🔌 Connecting to database...');
        await dbConnect();
        console.log('✅ Database connected successfully\n');

        let users = [];
        
        // If user identifier provided, fetch only that user
        if (userIdentifier) {
            isSingleUserMode = true;
            console.log(`🔍 Looking for user: ${userIdentifier}\n`);
            
            // Try to find by email first
            let user = await UserModel.findOne({ email: userIdentifier }).select('+password email firstName lastName');
            
            // If not found by email, try by ID
            if (!user && mongoose.Types.ObjectId.isValid(userIdentifier)) {
                user = await UserModel.findById(userIdentifier).select('+password email firstName lastName');
            }
            
            if (!user) {
                console.error(`❌ User not found: ${userIdentifier}`);
                console.error('   Please check the email or user ID and try again.\n');
                process.exit(1);
            }
            
            users = [user];
            console.log(`✅ Found user: ${user.email} (${user.firstName} ${user.lastName})\n`);
        } else {
            // Fetch all users with their passwords
            console.log('📊 Fetching all users from database...');
            users = await UserModel.find({}).select('+password email firstName lastName');
        }
        
        totalUsers = users.length;
        
        if (totalUsers === 0) {
            console.log('ℹ️  No users found in the database.\n');
            process.exit(0);
        }

        if (isSingleUserMode) {
            console.log('🔄 Starting password migration for single user...\n');
        } else {
            console.log(`✅ Found ${totalUsers} user(s) in the database\n`);
            console.log('🔄 Starting password migration...\n');
        }
        console.log('─'.repeat(60));

        // Process each user
        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            const userInfo = `${user.email} (${user.firstName} ${user.lastName})`;

            try {
                // Check if user has a password
                if (!user.password) {
                    console.log(`⏭️  [${i + 1}/${totalUsers}] Skipping ${userInfo} - No password found`);
                    skippedCount++;
                    continue;
                }

                // Check if password is already hashed
                if (isPasswordHashed(user.password)) {
                    console.log(`✓ [${i + 1}/${totalUsers}] ${userInfo} - Password already hashed`);
                    alreadyHashedCount++;
                    continue;
                }

                // Hash the plain-text password
                console.log(`🔄 [${i + 1}/${totalUsers}] Hashing password for ${userInfo}...`);
                const hashedPassword = await hashPassword(user.password);

                // Update the user with the hashed password
                await UserModel.findByIdAndUpdate(
                    user._id,
                    { password: hashedPassword },
                    { new: true }
                );

                console.log(`✅ [${i + 1}/${totalUsers}] Successfully hashed password for ${userInfo}`);
                hashedCount++;

            } catch (error) {
                console.error(`❌ [${i + 1}/${totalUsers}] Error processing ${userInfo}:`);
                console.error(`   ${error.message}`);
                errorCount++;
                logger.error(`Error hashing password for user ${user._id} (${user.email}):`, {
                    error: error.message,
                    stack: error.stack
                });
            }
        }

        // Print summary
        console.log('\n' + '─'.repeat(60));
        if (isSingleUserMode) {
            console.log('\n📊 Test Result:');
            console.log('─'.repeat(60));
        } else {
            console.log('\n📊 Migration Summary:');
            console.log('─'.repeat(60));
        }
        console.log(`   Total users processed:     ${totalUsers}`);
        console.log(`   ✓ Passwords hashed:         ${hashedCount}`);
        console.log(`   ✓ Already hashed:           ${alreadyHashedCount}`);
        console.log(`   ⏭️  Skipped (no password):   ${skippedCount}`);
        console.log(`   ❌ Errors:                  ${errorCount}`);
        console.log('─'.repeat(60));

        if (errorCount > 0) {
            console.log('\n⚠️  Some errors occurred during migration. Check the logs above for details.');
        } else if (hashedCount > 0) {
            if (isSingleUserMode) {
                console.log('\n✅ Test completed successfully!');
                console.log(`   Password has been hashed and stored securely.`);
                console.log(`   You can now test login with this user to verify it works.`);
            } else {
                console.log('\n✅ Migration completed successfully!');
                console.log(`   ${hashedCount} password(s) have been hashed and stored securely.`);
            }
        } else {
            if (isSingleUserMode) {
                console.log('\n✅ Password is already hashed. No migration needed.');
            } else {
                console.log('\n✅ All passwords are already hashed. No migration needed.');
            }
        }

        console.log('\n');

    } catch (error) {
        console.error('\n❌ Fatal error during migration:');
        console.error(`   Error: ${error.message}`);
        if (error.stack) {
            console.error(`   Stack: ${error.stack}`);
        }
        console.error('\n');
        logger.error('Fatal error in hashExistingPasswords script', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    } finally {
        // Wait a bit for logs to flush, then exit
        setTimeout(() => {
            process.exit(errorCount > 0 ? 1 : 0);
        }, 1000);
    }
}

// Run the script
console.log('🚀 Starting password hashing migration script...\n');
hashExistingPasswords().catch((error) => {
    console.error('\n❌ Unexpected error:', error);
    process.exit(1);
});

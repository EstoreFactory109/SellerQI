const cron = require('node-cron');
const logger = require('../../utils/Logger.js');
const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { sendAnalysisReadyEmail } = require('../Email/sendEmailAfter48hrs.js');

/**
 * Check if a user needs to receive an email
 * This includes users who:
 * 1. Don't have seller central data
 * 2. Have empty seller account arrays
 */
const checkUserNeedsEmail = async (user) => {
    try {
        // Check if user has seller central reference
        if (!user.sellerCentral) {
            logger.info(`User ${user.email} has no seller central data - needs email`);
            return true;
        }

        // Check if seller central exists and has data
        const sellerCentral = await Seller.findById(user.sellerCentral);
        if (!sellerCentral) {
            logger.info(`User ${user.email} has invalid seller central reference - needs email`);
            return true;
        }

        // Check if seller account array is empty
        if (!sellerCentral.sellerAccount || sellerCentral.sellerAccount.length === 0) {
            logger.info(`User ${user.email} has empty seller account array - needs email`);
            return true;
        }

        // User has seller central data with accounts
        return false;
    } catch (error) {
        logger.error(`Error checking if user ${user.email} needs email:`, error);
        return false;
    }
};

/**
 * Send email to users who need connection reminder
 */
const sendConnectionReminderEmails = async () => {
    try {
        logger.info('Starting connection reminder email process');
        
        // Find all verified users
        const users = await User.find({ 
            isVerified: true,
            connectAccountReminder:{$gt:0}
        }).select('firstName lastName email sellerCentral connectAccountReminder');

        logger.info(`Found ${users.length} verified users to analyze`);

        let emailsSent = 0;
        const loginUrl = 'https://members.sellerqi.com/';

        for (const user of users) {
            try {
                // Double check that user still has reminders left (safety check)
                if (user.connectAccountReminder <= 0) {
                    logger.debug(`User ${user.email} has no remaining reminders (${user.connectAccountReminder}), skipping`);
                    continue;
                }

                const needsEmail = await checkUserNeedsEmail(user);
                
                if (needsEmail) {
                    const emailResult = await sendAnalysisReadyEmail(
                        user.email, 
                        user.firstName, 
                        loginUrl
                    );
                    
                    if (emailResult) {
                        emailsSent++;
                        const newReminderCount = user.connectAccountReminder - 1;
                        const updatedUser = await User.findOneAndUpdate(
                            {_id:user._id},
                            {
                                $set:{
                                    connectAccountReminder: newReminderCount
                                }
                            },
                            {new:true}
                        );
                        if(!updatedUser){
                            logger.error(`Failed to update user ${user.email}`);
                        }
                        logger.info(`Connection reminder email sent to ${user.email}. Remaining reminders: ${newReminderCount}`);
                    } else {
                        logger.error(`Failed to send connection reminder email to ${user.email}`);
                    }
                } else {
                    logger.debug(`User ${user.email} does not need connection reminder email`);
                }
            } catch (userError) {
                logger.error(`Error processing user ${user.email}:`, userError);
            }
        }

        logger.info(`Connection reminder email process completed. Emails sent: ${emailsSent}`);
        return emailsSent;
    } catch (error) {
        logger.error('Error in sendConnectionReminderEmails:', error);
        return 0;
    }
};

/**
 * Initialize the email reminder cron job
 */
const initializeEmailReminderJob = () => {
    try {
        
        // Schedule the job to run every 48 hours (every 2 days at midnight)
        cron.schedule('0 0 */2 * *', async () => {
            logger.info('Running scheduled connection reminder email job (every 48 hours)');
            await sendConnectionReminderEmails();
        });
        
        logger.info('Email reminder cron job initialized - will run every 48 hours');
        return true;
    } catch (error) {
        logger.error('Failed to initialize email reminder cron job:', error);
        return false;
    }
};

// Export the functions for import in app.js
module.exports = { 
    initializeEmailReminderJob,
    sendConnectionReminderEmails, 
    checkUserNeedsEmail 
};
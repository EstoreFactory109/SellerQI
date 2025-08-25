const ReminderEmail = require('../Email/ReminderEmailToUpgrade');
const User = require('../../models/userModel');
const logger = require('../../utils/Logger.js');
const dbConnect = require('../../config/dbConn.js');

const sendTrialReminderEmails = async () => {
    try {
        await dbConnect();
        const now = new Date();
        
        // Calculate time threshold for 3 days
        const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
        
        // Get users in trial period with specific time remaining
        const usersToRemind = await User.find({
            isInTrialPeriod: true,
            trialEndsDate: {
                $gte: now,
                $lte: threeDaysFromNow
            }
        }).select('email firstName lastName trialEndsDate');
        
        if (usersToRemind.length === 0) {
            logger.info('No users found for trial reminder emails');
            return;
        }
        
        let emailsSent = 0;
        let emailsFailed = 0;

        
        
        for (const user of usersToRemind) {
            try {
                const timeRemaining = user.trialEndsDate - now;
                const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
                const hoursRemaining = Math.ceil(timeRemaining / (60 * 60 * 1000));
                
                let reminderDays = 0;
                
                // Determine which reminder to send based on time remaining
                if (hoursRemaining <= 12) {
                    reminderDays = 0.5; // 12 hours
                } else if (daysRemaining <= 1) {
                    reminderDays = 1; // 1 day
                } else if (daysRemaining <= 3) {
                    reminderDays = 3; // 3 days
                } else {
                    continue; // Skip if more than 3 days remaining
                }
                
                const userName = `${user.firstName} ${user.lastName}`;
                const upgradeUrl = `${process.env.FRONTEND_URL || 'https://your-frontend-url.com'}/upgrade`;
                console.log(reminderDays,userName,upgradeUrl);
               
                const emailResult = await ReminderEmail.RemiderEmail(
                    user.email,
                    reminderDays==0.5?"12 hours":reminderDays+" days",
                    userName,
                    upgradeUrl
                );
                
                if (emailResult) {
                    emailsSent++;
                    logger.info(`Trial reminder email sent to ${user.email} for ${reminderDays} days remaining`);
                } else {
                    emailsFailed++;
                    logger.error(`Failed to send trial reminder email to ${user.email}`);
                }
                
            } catch (error) {
                emailsFailed++;
                logger.error(`Error processing trial reminder for user ${user.email}:`, error);
            }
        }
        
        logger.info(`Trial reminder emails completed. Sent: ${emailsSent}, Failed: ${emailsFailed}`);
        
    } catch (error) {
        logger.error('Error in sendTrialReminderEmails:', error);
        throw error;
    }
};

module.exports = { sendTrialReminderEmails };


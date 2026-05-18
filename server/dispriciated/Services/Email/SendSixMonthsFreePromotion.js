require('dotenv').config();
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');


// Import database connection
const dbConnect = require('../../config/dbConn.js');
const User = require('../../models/user-auth/userModel.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const { resolveRecipientEmail } = require('./resolveRecipientEmail.js');

// Read the email template
const sixMonthsFreeTemplate = fs.readFileSync(
    path.join(__dirname, '..', '..', 'Emails', 'SixMonthsFreePromotionTemplate.html'), 
    'utf8'
);

const sendSixMonthsFreePromotion = async () => {
    try {
        // Connect to database
        await dbConnect();
        console.log('Connected to database');

        // Set mongoose timeout options
        mongoose.set('bufferCommands', false);

        // Fetch all users with email addresses
        const users = await User.find({ email: { $exists: true, $ne: null } }, { 
            email: 1, 
            firstName: 1, 
            lastName: 1 
        });

        console.log(`Found ${users.length} users to send emails to`);

        // Create email transporter
        const transporter = nodemailer.createTransport({
            host: "email-smtp.us-west-2.amazonaws.com",
            port: 587,
            secure: false,
            auth: {
                user: 'AKIA2FN7DZKEYYDJEN77',
                pass: 'BIL6H/1cR769EdaTP20/T+Gohw+FqxFE5a6yjkEdE0+z',
            },
        });

        let successCount = 0;
        let failureCount = 0;

        // Send email to each user
        for (const user of users) {
            try {
                const recipientEmail = await resolveRecipientEmail(user.email, user._id);

                // Create email log entry
                const emailLog = new EmailLogs({
                    emailType: 'OTHER',
                    receiverEmail: recipientEmail,
                    receiverId: user._id,
                    status: 'PENDING',
                    subject: "🎉 6 Months Free - Our Gift to You!",
                    emailContent: `6 months free promotion sent to ${user.firstName} ${user.lastName}`,
                    emailProvider: 'AWS_SES'
                });

                // Save initial log
                await emailLog.save();

                // Prepare email content
                const customerName = `${user.firstName} ${user.lastName}`;
                let emailContent = sixMonthsFreeTemplate.replace('{{customerName}}', customerName);
                
                // Replace URL placeholders
                emailContent = emailContent.replace(/\{\{privacyUrl\}\}/g, process.env.PRIVACY_URL || 'https://www.sellerqi.com/privacy-policy');
                emailContent = emailContent.replace(/\{\{termsUrl\}\}/g, process.env.TERMS_URL || 'https://www.sellerqi.com/terms-of-use');
                emailContent = emailContent.replace(/\{\{refundUrl\}\}/g, process.env.REFUND_URL || 'https://www.sellerqi.com/terms-of-use');
                emailContent = emailContent.replace(/\{\{cancellationUrl\}\}/g, process.env.CANCELLATION_URL || 'https://www.sellerqi.com/terms-of-use');
                emailContent = emailContent.replace(/\{\{unsubscribeUrl\}\}/g, process.env.UNSUBSCRIBE_URL || 'https://sellerqi.com/unsubscribe');

                // Send email
                const info = await transporter.sendMail({
                    from: 'support@sellerqi.com',
                    to: recipientEmail,
                    subject: "🎉 6 Months Free - Our Gift to You!",
                    html: emailContent,
                });

                // Mark email as sent
                await emailLog.markAsSent();
                console.log(`✅ Email sent successfully to ${recipientEmail} (${customerName})`);
                successCount++;

            } catch (error) {
                console.error(`❌ Failed to send email to ${user.email}:`, error.message);
                failureCount++;
                
                // Mark email as failed if log exists
                try {
                    const emailLog = await EmailLogs.findOne({
                        receiverId: user._id,
                        emailType: 'OTHER',
                        status: 'PENDING'
                    });
                    if (emailLog) {
                        await emailLog.markAsFailed(error.message);
                    }
                } catch (logError) {
                    console.error('Failed to update email log:', logError.message);
                }
            }
        }

        console.log('\n📊 Email Campaign Summary:');
        console.log(`✅ Successfully sent: ${successCount} emails`);
        console.log(`❌ Failed to send: ${failureCount} emails`);
        console.log(`📧 Total users: ${users.length}`);

    } catch (error) {
        console.error('❌ Script execution failed:', error);
    } finally {
        // Close database connection
        await mongoose.connection.close();
        console.log('Database connection closed');
        process.exit(0);
    }
};

// Run the script
if (require.main === module) {
    console.log('🚀 Starting 6 Months Free Promotion Email Campaign...');
    sendSixMonthsFreePromotion();
}

module.exports = { sendSixMonthsFreePromotion };

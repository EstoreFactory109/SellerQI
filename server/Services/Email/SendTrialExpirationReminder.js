const nodemailer = require('nodemailer');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const fs = require('fs');
const path = require('path');

// Read the email template
const trialExpirationTemplate = fs.readFileSync(
    path.join(__dirname, '..', '..', 'Emails', 'FreeTrialUpgradeMailTemplate.html'), 
    'utf8'
);

/**
 * Send trial expiration reminder email to user
 * @param {string} email - User email address
 * @param {string} firstName - User first name
 * @param {string} lastName - User last name
 * @param {Date} trialEndsDate - Date when trial ends
 * @param {string} userId - User ID
 * @returns {Promise<string|boolean>} - Message ID on success, false on failure
 */
const sendTrialExpirationReminder = async (email, firstName, lastName, trialEndsDate, userId = null) => {
    // Calculate days remaining
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const trialEnd = new Date(trialEndsDate);
    trialEnd.setHours(0, 0, 0, 0);
    const daysRemaining = Math.ceil((trialEnd - today) / (1000 * 60 * 60 * 24));
    
    const userName = `${firstName} ${lastName}`;
    const upgradeUrl = process.env.UPGRADE_URL || 'https://members.sellerqi.com/upgrade';
    
    // Create email log entry
    const emailLog = new EmailLogs({
        emailType: 'UPGRADE_REMINDER',
        receiverEmail: email,
        receiverId: userId,
        status: 'PENDING',
        subject: `Your Free Trial Expires in ${daysRemaining} Days - Upgrade to Pro Now`,
        emailContent: `Hi ${userName}, your free trial expires in ${daysRemaining} days. Upgrade to Pro to continue using SellerQI.`,
        emailProvider: 'AWS_SES'
    });

    // Ensure all values are strings and handle undefined/null values
    const safeReplace = (template, placeholder, value) => {
        const safeValue = value !== undefined && value !== null ? String(value) : '';
        return template.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), safeValue);
    };

    let template = trialExpirationTemplate;
    
    // Replace all template variables
    template = safeReplace(template, '{{days}}', daysRemaining);
    template = safeReplace(template, '{{userName}}', userName);
    template = safeReplace(template, '{{upgradeUrl}}', upgradeUrl);
    
    // Replace social media URLs if they exist in template
    template = safeReplace(template, '{{facebookUrl}}', process.env.FACEBOOK_URL || 'https://www.facebook.com/sellerqi');
    template = safeReplace(template, '{{twitterUrl}}', process.env.TWITTER_URL || 'https://www.twitter.com/sellerqi');
    template = safeReplace(template, '{{linkedinUrl}}', process.env.LINKEDIN_URL || 'https://www.linkedin.com/company/sellerqi');
    template = safeReplace(template, '{{youtubeUrl}}', process.env.YOUTUBE_URL || 'https://www.youtube.com/@sellerqi');
    template = safeReplace(template, '{{privacyUrl}}', process.env.PRIVACY_URL || 'https://www.sellerqi.com/privacy-policy');
    template = safeReplace(template, '{{termsUrl}}', process.env.TERMS_URL || 'https://www.sellerqi.com/terms-of-use');
    template = safeReplace(template, '{{refundUrl}}', process.env.REFUND_URL || 'https://www.sellerqi.com/terms-of-use');
    template = safeReplace(template, '{{cancellationUrl}}', process.env.CANCELLATION_URL || 'https://www.sellerqi.com/terms-of-use');
    template = safeReplace(template, '{{unsubscribeUrl}}', process.env.UNSUBSCRIBE_URL || 'https://sellerqi.com/unsubscribe');

    try {
        // Save initial log
        await emailLog.save();
        logger.info(`Email log created for ${email}, attempting to send email...`);
        
        // Verify email configuration
        if (!process.env.ADMIN_USERNAME || !process.env.APP_PASSWORD) {
            throw new Error('Email credentials not configured (ADMIN_USERNAME or APP_PASSWORD missing)');
        }

        const fromEmail = process.env.SELF_MAIL_ID || process.env.ADMIN_EMAIL_ID;
        if (!fromEmail) {
            throw new Error('Sender email not configured (SELF_MAIL_ID or ADMIN_EMAIL_ID missing)');
        }

        logger.info(`Sending email from ${fromEmail} to ${email}`);
        
        const transporter = nodemailer.createTransport({
            host: "email-smtp.us-west-2.amazonaws.com",
            port: 587, // Use 587 for STARTTLS
            secure: false, // Set to false for STARTTLS
            auth: {
                user: process.env.ADMIN_USERNAME, // Your AWS SES access key
                pass: process.env.APP_PASSWORD, // Your AWS SES secret key
            },
        });

        // Verify connection
        await transporter.verify();
        logger.info('SMTP connection verified successfully');

        const text = `
            Dear ${userName},

            Your free trial with SellerQI is expiring in ${daysRemaining} days.

            We hope you've enjoyed exploring our platform and the valuable insights it provides for your Amazon business. To continue accessing all premium features and data, please upgrade to Pro.

            Upgrade now to keep optimizing your Amazon business performance without interruption.

            Best regards,  
            SellerQi Team
            
            `;
        const body = template;

        // Send mail with defined transport object
        const mailOptions = {
            from: fromEmail, // Sender address
            to: email, // List of receivers
            subject: `Your Free Trial Expires in ${daysRemaining} Days - Upgrade to Pro Now`, // Subject line
            text: text, // Plain text body
            html: body, // HTML body
        };

        logger.info(`Attempting to send email with options:`, {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject
        });

        const info = await transporter.sendMail(mailOptions);

        // Mark email as sent
        await emailLog.markAsSent();
        logger.info(`Trial expiration reminder email sent successfully to ${email}. Message ID: ${info.messageId}`);
        console.log(`[INFO] Email sent successfully. Message ID: ${info.messageId}`);
        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send trial expiration reminder email to ${email}:`, error);
        console.error(`[ERROR] Email sending failed:`, error.message);
        if (error.response) {
            logger.error(`SMTP Response: ${error.response}`);
            console.error(`[ERROR] SMTP Response:`, error.response);
        }
        if (error.responseCode) {
            logger.error(`SMTP Response Code: ${error.responseCode}`);
            console.error(`[ERROR] SMTP Response Code:`, error.responseCode);
        }
        try {
            await emailLog.markAsFailed(error.message);
        } catch (logError) {
            logger.error(`Failed to update email log:`, logError);
        }
        return false;
    }
};

module.exports = { sendTrialExpirationReminder };

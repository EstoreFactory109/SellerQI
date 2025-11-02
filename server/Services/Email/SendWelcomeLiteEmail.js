const nodemailer = require('nodemailer');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/EmailLogsModel.js');
const fs = require('fs');
const path = require('path');

let WelcomeLiteEmailTemplate = fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'WelcomeEmailForLiteTemplate.html'), 'utf8');

const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const sendWelcomeLiteEmail = async (email, firstName, connectAccountUrl, userId = null) => {
    // Create email log entry
    const emailLog = new EmailLogs({
        emailType: 'WELCOME_LITE',
        receiverEmail: email,
        receiverId: userId,
        status: 'PENDING',
        subject: "Welcome to SellerQI Lite! 🎉",
        emailContent: 'Welcome to SellerQI Lite! Get insights into your account by connecting it.',
        emailProvider: 'AWS_SES'
    });

    let template = WelcomeLiteEmailTemplate
        .replace('{{userName}}', firstName)
        .replace('{{connectAccountUrl}}', connectAccountUrl || process.env.CLIENT_URL + '/connect-accounts')
        .replace('{{facebookUrl}}', process.env.FACEBOOK_URL || '#')
        .replace('{{twitterUrl}}', process.env.TWITTER_URL || '#')
        .replace('{{linkedinUrl}}', process.env.LINKEDIN_URL || '#')
        .replace('{{youtubeUrl}}', process.env.YOUTUBE_URL || '#')
        .replace('{{privacyUrl}}', process.env.PRIVACY_POLICY_URL || process.env.CLIENT_URL + '/privacy-policy')
        .replace('{{termsUrl}}', process.env.TERMS_OF_SERVICE_URL || process.env.CLIENT_URL + '/terms')
        .replace('{{unsubscribeUrl}}', process.env.UNSUBSCRIBE_URL || '#');

    try {
        // Save initial log
        await emailLog.save();
        // Check if required environment variables are set
        if (!process.env.ADMIN_USERNAME || !process.env.APP_PASSWORD || !process.env.ADMIN_EMAIL_ID) {
            logger.error('Missing required environment variables: ADMIN_USERNAME, APP_PASSWORD, or ADMIN_EMAIL_ID');
            return false;
        }

        if (!isValidEmail(email)) {
            logger.error(`Invalid email address: ${email}`);
            await emailLog.markAsFailed('Invalid email address');
            return false;
        }

        const transporter = nodemailer.createTransport({
            host: "email-smtp.us-west-2.amazonaws.com",
            port: 587, // Use 587 for STARTTLS
            secure: false, // Set to false for STARTTLS
            auth: {
                user: process.env.ADMIN_USERNAME, // AWS SES SMTP username
                pass: process.env.APP_PASSWORD, // AWS SES SMTP password
            },
        });

        const subject = "Welcome to SellerQI Lite! 🎉";
        const text = `
            Dear ${firstName},

            Welcome to SellerQI Lite! 

            Get insights into your account by connecting it and upgrading to SellerQI Pro. This will allow us to analyze and identify potential issues affecting your account.

            Connect your account: ${connectAccountUrl || process.env.CLIENT_URL + '/connect-accounts'}

            Need help? Contact us:
            📧 Email: support@sellerqi.com
            📞 Phone: +1 818 350 5203
            💬 Live Chat: Available Mon-Fri, 9 AM - 6 PM EST

            Best regards,  
            SellerQI Team
            `;
        const body = template;

        // Send mail with defined transport object
        const info = await transporter.sendMail({
            from: process.env.ADMIN_EMAIL_ID, // Sender address
            to: email, // List of receivers
            subject: subject, // Subject line
            text: text, // Plain text body
            html: body, // HTML body
        });

        // Mark email as sent
        await emailLog.markAsSent();
        logger.info(`Welcome Lite email sent successfully to ${email}. Message ID: ${info.messageId}`);
        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send welcome lite email to ${email}:`, error);
        logger.error(`Error details: ${error.message}`);
        if (error.response) {
            logger.error(`SMTP Response: ${error.response}`);
        }
        await emailLog.markAsFailed(error.message);
        return false;
    }
};

module.exports = { sendWelcomeLiteEmail }; 
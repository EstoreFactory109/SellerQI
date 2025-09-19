const nodemailer = require('nodemailer');
const dns = require('dns');
const { promisify } = require('util');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/EmailLogsModel.js');
const resolveMx = promisify(dns.resolveMx);
const fs = require('fs');
const path = require('path');

let AnalysisReadyEmailTemplate = fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'AmazonAnalyseReadyEmailTemplate.html'), 'utf8');

const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const checkEmailDomain = async (email) => {
    const domain = email.split('@')[1];
    try {
        const addresses = await resolveMx(domain);
        return addresses && addresses.length > 0;
    } catch (err) {
        return false;
    }
};

const sendAnalysisReadyEmail = async (email, firstName, dashboardUrl, userId = null) => {
    // Create email log entry
    const emailLog = new EmailLogs({
        emailType: 'ANALYSIS_READY',
        receiverEmail: email,
        receiverId: userId,
        status: 'PENDING',
        subject: "Your SellerQI Account is Ready! 🎉",
        emailContent: 'Your SellerQI account analysis is complete and your dashboard is ready.',
        emailProvider: 'AWS_SES'
    });

    let template = AnalysisReadyEmailTemplate
        .replace('{{userName}}', firstName)
        .replace('{{dashboardUrl}}', dashboardUrl)
        .replace('{{facebookUrl}}', process.env.FACEBOOK_URL || '#')
        .replace('{{twitterUrl}}', process.env.TWITTER_URL || '#')
        .replace('{{linkedinUrl}}', process.env.LINKEDIN_URL || '#')
        .replace('{{youtubeUrl}}', process.env.YOUTUBE_URL || '#')
        .replace('{{privacyUrl}}', process.env.PRIVACY_POLICY_URL || '#')
        .replace('{{termsUrl}}', process.env.TERMS_OF_SERVICE_URL || '#')
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

        // Step 2: Check if email domain has valid MX records
        const domainValid = await checkEmailDomain(email);
        if (!domainValid) {
            logger.error(`Invalid email domain for ${email}`);
            await emailLog.markAsFailed('Invalid email domain');
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

        const subject = "Your SellerQI Account is Ready! 🎉";
        const text = `
            Dear ${firstName},

            Great news! Your SellerQI account analysis is complete and your dashboard is ready with all your Amazon data.

            You can now access:
            • Sales & profit analytics
            • Inventory & restock suggestions  
            • PPC & keyword performance
            • Competitor tracking & product rankings

            Access your dashboard: ${dashboardUrl}

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
            bcc: process.env.ADMIN_EMAIL_ID, // BCC to admin
            subject: subject, // Subject line
            text: text, // Plain text body
            html: body, // HTML body
        });

        // Mark email as sent
        await emailLog.markAsSent();
        logger.info(`Analysis ready email sent successfully to ${email}. Message ID: ${info.messageId}`);
        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send analysis ready email to ${email}:`, error);
        logger.error(`Error details: ${error.message}`);
        if (error.response) {
            logger.error(`SMTP Response: ${error.response}`);
        }
        await emailLog.markAsFailed(error.message);
        return false;
    }
};

module.exports = { sendAnalysisReadyEmail }; 
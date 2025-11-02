const nodemailer = require('nodemailer');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/EmailLogsModel.js');
const fs = require('fs');
const path = require('path');

let AnalysisReadyEmailTemplate = fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'connectionOfAccountRemainingTemplate.html'), 'utf8');

const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const sendAnalysisReadyEmail = async (email, firstName, loginUrl, userId = null) => {
    // Create email log entry
    const emailLog = new EmailLogs({
        emailType: 'CONNECTION_REMINDER',
        receiverEmail: email,
        receiverId: userId,
        status: 'PENDING',
        subject: "Connect Your Amazon Account - SellerQI",
        emailContent: 'We noticed you haven\'t connected your Amazon account yet. Connect now to start getting insights.',
        emailProvider: 'AWS_SES'
    });

    let template = AnalysisReadyEmailTemplate
        .replace('{{userName}}', firstName)
        .replace('{{loginUrl}}', loginUrl)

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

        const subject = "Connect Your Amazon Account - SellerQI";
        const text = `
            Dear ${firstName},

            We noticed you haven't connected your Amazon account yet. Connect now to start getting insights for your business.

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
        logger.info(`Connection reminder email sent successfully to ${email}. Message ID: ${info.messageId}`);
        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send connection reminder email to ${email}:`, error);
        logger.error(`Error details: ${error.message}`);
        if (error.response) {
            logger.error(`SMTP Response: ${error.response}`);
        }
        await emailLog.markAsFailed(error.message);
        return false;
    }
};

module.exports = { sendAnalysisReadyEmail }; 
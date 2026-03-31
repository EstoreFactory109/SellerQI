const nodemailer = require('nodemailer');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const { resolveRecipientEmail } = require('./resolveRecipientEmail.js');
const fs = require('fs');
const path = require('path');

let VerificationEmailTemplate = fs.readFileSync(
    path.join(__dirname, '..', '..', 'Emails', 'verificationCodeTemplate.html'),
    'utf8'
);

// Validate template loaded correctly
if (!VerificationEmailTemplate || VerificationEmailTemplate.trim().length === 0) {
    logger.error('Email template is empty or failed to load');
}

const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Create transporter once and reuse (connection pooling)
const transporter = nodemailer.createTransport({
    host: "email-smtp.us-west-2.amazonaws.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.ADMIN_USERNAME,
        pass: process.env.APP_PASSWORD,
    },
    pool: true,           // reuse connections
    maxConnections: 5,     // limit concurrent connections
    maxMessages: 100,      // messages per connection before reconnecting
});

// Verify SMTP connection on startup
transporter.verify((err) => {
    if (err) {
        logger.error('SMTP connection verification failed:', err);
    } else {
        logger.info('SMTP server is ready to send emails');
    }
});

const sendEmail = async (email, firstName, otp, userId = null) => {
    const originalEmail = email;
    email = await resolveRecipientEmail(email, userId);

    // Log if email was changed by resolver
    if (originalEmail !== email) {
        logger.info(`Email resolved: ${originalEmail} -> ${email}`);
    }

    // Get first email from ADMIN_EMAIL_ID (handle comma-separated values)
    const adminEmail = process.env.ADMIN_EMAIL_ID
        ? process.env.ADMIN_EMAIL_ID.split(',')[0].trim()
        : 'support@sellerqi.com';

    // Use SELF_MAIL_ID or first admin email as sender
    const senderEmail = process.env.SELF_MAIL_ID || adminEmail;

    // Create email log entry
    const emailLog = new EmailLogs({
        emailType: 'OTP',
        receiverEmail: email,
        receiverId: userId,
        status: 'PENDING',
        subject: "Your One-Time Password (OTP) for Verification",
        emailContent: `OTP verification code: ${otp}`,
        emailProvider: 'AWS_SES'
    });

    // Use replaceAll to catch all occurrences, with fallbacks for safety
    let template = VerificationEmailTemplate
        .replaceAll('{{userName}}', firstName || 'User')
        .replaceAll('{{verificationCode}}', otp || '');

    try {
        // Save initial log
        await emailLog.save();

        if (!isValidEmail(email)) {
            logger.error(`Invalid email address: ${email}`);
            await emailLog.markAsFailed('Invalid email address');
            return false;
        }

        const subject = "Your One-Time Password (OTP) for Verification";
        const text = `Hi ${firstName || 'User'},\n\nThanks for signing up with SellerQI. Your one-time verification code is: ${otp}\n\nThis code is valid for 10 minutes. Please do not share it with anyone. Our team will never ask you for your verification code.\n\nIf you did not request this code, please ignore this email.\n\nWelcome aboard,\nThe SellerQI Team\n\nNeed help? Contact us at support@sellerqi.com`;

        // Send mail with defined transport object
        const info = await transporter.sendMail({
            from: `SellerQI <${senderEmail}>`,    // Display name + email
            replyTo: 'support@sellerqi.com',       // Reply-to header
            to: email,
            subject: subject,
            text: text,
            html: template,
        });

        // Mark email as sent
        await emailLog.markAsSent();
        logger.info(`OTP email sent successfully to ${email}. Message ID: ${info.messageId}`);

        return info.messageId;
    } catch (error) {
        logger.error(`Failed to send email to ${email}:`, error);
        await emailLog.markAsFailed(error.message);
        return false;
    }
};

module.exports = { sendEmail };
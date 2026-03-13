const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const { resolveRecipientEmail } = require('./resolveRecipientEmail.js');

// HTML template for six-month warning
const sixMonthWarningTemplate = fs.readFileSync(
    path.join(__dirname, '..', '..', 'Emails', 'SixMonthAccountWarningTemplate.html'),
    'utf8'
);

/**
 * Send 6‑month account warning email to user
 * 
 * This email informs the user that:
 * - In 2 days it will be 6 months since registration
 * - They have not connected their seller account or purchased a qualifying plan
 * - They can start a 7‑day free trial and must connect within 2 days
 * - Otherwise their account will be suspended
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.firstName
 * @param {string} params.lastName
 * @param {string} params.userId
 * @param {Date} params.registeredAt
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
const sendSixMonthAccountWarning = async ({ email, firstName, lastName, userId = null, registeredAt }) => {
    email = await resolveRecipientEmail(email, userId);

    const userName = `${firstName} ${lastName}`.trim();

    // Construct URLs from env or use sensible fallbacks
    const loginUrl = process.env.LOGIN_URL || 'https://members.sellerqi.com/';

    // Create email log entry - use existing enum value "OTHER"
    const emailLog = new EmailLogs({
        emailType: 'OTHER',
        receiverEmail: email,
        receiverId: userId,
        status: 'PENDING',
        subject: 'Action Needed: Connect Your SellerQI Account in the Next 2 Days',
        emailContent: `In 2 days it will be 6 months since you registered. You have not connected your seller or ads account or activated a Pro/LITE plan. Log in to your dashboard to start a 7‑day trial and connect within 2 days to avoid suspension.`,
        emailProvider: 'AWS_SES'
    });

    try {
        await emailLog.save();

        // Get sender configuration
        const adminEmail = process.env.ADMIN_EMAIL_ID
            ? process.env.ADMIN_EMAIL_ID.split(',')[0].trim()
            : 'support@sellerqi.com';
        const fromEmail = process.env.SELF_MAIL_ID || adminEmail;

        if (!process.env.ADMIN_USERNAME || !process.env.APP_PASSWORD) {
            throw new Error('Email credentials not configured (ADMIN_USERNAME or APP_PASSWORD missing)');
        }
        if (!fromEmail) {
            throw new Error('Sender email not configured (SELF_MAIL_ID or ADMIN_EMAIL_ID missing)');
        }

        const transporter = nodemailer.createTransport({
            host: 'email-smtp.us-west-2.amazonaws.com',
            port: 587,
            secure: false,
            auth: {
                user: process.env.ADMIN_USERNAME,
                pass: process.env.APP_PASSWORD,
            },
        });

        const text = `
Hi ${userName},

In 2 days it will be 6 months since you registered your SellerQI account, but you still haven't connected your Amazon seller/ads accounts or activated a Pro plan.

If you're still interested, please log in to your SellerQI dashboard within the next 2 days. From there you can start your 7‑day free trial and connect your accounts from the Settings → Plans & Billing and Account Integrations sections.

If you do not connect your accounts or upgrade to Pro from inside the dashboard within 2 days, your SellerQI account will be paused and your data may be removed.

Best regards,
SellerQI Team
`;

        // Safely replace template variables
        const safeReplace = (template, placeholder, value) => {
            const safeValue = value !== undefined && value !== null ? String(value) : '';
            return template.replace(
                new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                safeValue
            );
        };

        let html = sixMonthWarningTemplate;
        html = safeReplace(html, '{{userName}}', userName);
        html = safeReplace(html, '{{loginUrl}}', loginUrl);
        html = safeReplace(html, '{{privacyUrl}}', process.env.PRIVACY_URL || 'https://www.sellerqi.com/privacy-policy');
        html = safeReplace(html, '{{termsUrl}}', process.env.TERMS_URL || 'https://www.sellerqi.com/terms-of-use');
        html = safeReplace(html, '{{refundUrl}}', process.env.REFUND_URL || 'https://www.sellerqi.com/terms-of-use');
        html = safeReplace(html, '{{cancellationUrl}}', process.env.CANCELLATION_URL || 'https://www.sellerqi.com/terms-of-use');
        html = safeReplace(html, '{{unsubscribeUrl}}', process.env.UNSUBSCRIBE_URL || 'https://sellerqi.com/unsubscribe');

        const mailOptions = {
            from: fromEmail,
            to: email,
            subject: 'Action Needed: Connect Your SellerQI Account in the Next 2 Days',
            text,
            html,
        };

        const info = await transporter.sendMail(mailOptions);
        await emailLog.markAsSent();

        logger.info(`Six-month account warning email sent to ${email}. Message ID: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        const errorMessage = error?.message || String(error);
        logger.error(`Failed to send six-month account warning email to ${email}:`, error);
        try {
            await emailLog.markAsFailed(errorMessage);
        } catch (logError) {
            logger.error('Failed to update email log for six-month account warning:', logError);
        }
        return { success: false, error: errorMessage };
    }
};

module.exports = { sendSixMonthAccountWarning };


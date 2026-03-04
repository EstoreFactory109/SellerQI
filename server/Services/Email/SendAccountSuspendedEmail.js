const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');

const accountSuspendedTemplate = fs.readFileSync(
    path.join(__dirname, '..', '..', 'Emails', 'AccountSuspendedTemplate.html'),
    'utf8'
);

/**
 * Send "account suspended" email to user after their account is suspended/deleted
 * (e.g. 6+ months LITE, no SP-API/Ads connection). Call this BEFORE deleting the user
 * so we still have their email.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.firstName
 * @param {string} params.lastName
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
const sendAccountSuspendedEmail = async ({ email, firstName, lastName }) => {
    const userName = `${firstName || ''} ${lastName || ''}`.trim() || 'there';

    const signupUrl = process.env.SIGNUP_URL || process.env.LOGIN_URL || 'https://members.sellerqi.com/';

    const emailLog = new EmailLogs({
        emailType: 'OTHER',
        receiverEmail: email,
        receiverId: null,
        status: 'PENDING',
        subject: 'Your SellerQI Account Has Been Suspended',
        emailContent: `Your SellerQI account has been suspended after 6 months with no seller/ads connection or Pro plan. You can create a new account if you wish to use SellerQI again.`,
        emailProvider: 'AWS_SES'
    });

    try {
        await emailLog.save();

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

        const safeReplace = (template, placeholder, value) => {
            const safeValue = value !== undefined && value !== null ? String(value) : '';
            return template.replace(
                new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                safeValue
            );
        };

        let html = accountSuspendedTemplate;
        html = safeReplace(html, '{{userName}}', userName);
        html = safeReplace(html, '{{signupUrl}}', signupUrl);
        html = safeReplace(html, '{{privacyUrl}}', process.env.PRIVACY_URL || 'https://www.sellerqi.com/privacy-policy');
        html = safeReplace(html, '{{termsUrl}}', process.env.TERMS_URL || 'https://www.sellerqi.com/terms-of-use');
        html = safeReplace(html, '{{unsubscribeUrl}}', process.env.UNSUBSCRIBE_URL || 'https://sellerqi.com/unsubscribe');

        const text = `
Hi ${userName},

Your SellerQI account has been suspended because it has been more than 6 months since you registered, and we did not detect a connection to your Amazon seller/ads accounts or an active Pro plan.

Your account data has been removed in line with our retention policy.

If you would like to use SellerQI again, you can create a new account and connect your seller account or upgrade to Pro from your dashboard.

Questions? Contact us at support@sellerqi.com

Best regards,
SellerQI Team
`;

        const mailOptions = {
            from: fromEmail,
            to: email,
            subject: 'Your SellerQI Account Has Been Suspended',
            text,
            html,
        };

        const info = await transporter.sendMail(mailOptions);
        await emailLog.markAsSent();

        logger.info(`Account suspended email sent to ${email}. Message ID: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        const errorMessage = error?.message || String(error);
        logger.error(`Failed to send account suspended email to ${email}:`, error);
        try {
            await emailLog.markAsFailed(errorMessage);
        } catch (logError) {
            logger.error('Failed to update email log for account suspended:', logError);
        }
        return { success: false, error: errorMessage };
    }
};

module.exports = { sendAccountSuspendedEmail };

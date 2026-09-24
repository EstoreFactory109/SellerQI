const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');

/**
 * One email with one button: sign-in links and member invitations.
 *
 * Like SendEsfInviteEmail, this goes to exactly the address given and never
 * through resolveRecipientEmail — a sign-in link fanned out to a user's other
 * addresses would hand their session to whoever reads those inboxes.
 */

const APP_NAME = 'SellerQI';

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');

// Values come from users (names, brands), so they are escaped before landing in HTML.
const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

// Same SES transport and credentials the other senders use.
const transporter = nodemailer.createTransport({
    host: "email-smtp.us-west-2.amazonaws.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.ADMIN_USERNAME,
        pass: process.env.APP_PASSWORD,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
});

/**
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.subject
 * @param {string} params.title        Header line
 * @param {string} params.subtitle
 * @param {string} params.intro        Paragraph above the button
 * @param {string} params.buttonLabel
 * @param {string} params.link         Absolute URL
 * @param {string} params.note         Small print below the button
 * @param {string} params.logLabel     Short description stored in EmailLogs
 * @param {string|null} params.receiverId
 * @returns {Promise<string|false>} messageId, or false when the send failed
 */
const sendAuthLinkEmail = async ({ email, subject, title, subtitle, intro, buttonLabel, link, note, logLabel, receiverId = null }) => {
    const adminEmail = process.env.ADMIN_EMAIL_ID
        ? process.env.ADMIN_EMAIL_ID.split(',')[0].trim()
        : 'support@sellerqi.com';
    const senderEmail = process.env.SELF_MAIL_ID || adminEmail;

    const emailLog = new EmailLogs({
        emailType: 'OTHER',
        receiverEmail: email,
        receiverId,
        status: 'PENDING',
        subject,
        emailContent: logLabel || subject,
        emailProvider: 'AWS_SES',
    });

    try {
        await emailLog.save();

        if (!isValidEmail(email)) {
            logger.error(`[AuthLinkEmail] Invalid email address: ${email}`);
            await emailLog.markAsFailed('Invalid email address');
            return false;
        }

        const html = fs
            .readFileSync(path.join(__dirname, '..', '..', 'Emails', 'AuthLinkTemplate.html'), 'utf8')
            // Replacer functions, not strings: a brand like "Cash$'n Carry" would
            // otherwise be read as a `$'` replacement pattern and garble the email.
            .replace(/\{\{appName\}\}/g, () => APP_NAME)
            .replace(/\{\{title\}\}/g, () => escapeHtml(title))
            .replace(/\{\{subtitle\}\}/g, () => escapeHtml(subtitle))
            .replace(/\{\{intro\}\}/g, () => escapeHtml(intro))
            .replace(/\{\{buttonLabel\}\}/g, () => escapeHtml(buttonLabel))
            .replace(/\{\{note\}\}/g, () => escapeHtml(note))
            .replace(/\{\{link\}\}/g, () => escapeHtml(link));

        const text = `${title}\n\n${intro}\n\n${buttonLabel}: ${link}\n\n${note}\n\nNeed help? Contact support@sellerqi.com`;

        const info = await transporter.sendMail({
            from: `${APP_NAME} <${senderEmail}>`,
            replyTo: 'support@sellerqi.com',
            to: email,
            subject,
            text,
            html,
        });

        await emailLog.markAsSent();
        logger.info(`[AuthLinkEmail] "${subject}" sent to ${email}. Message ID: ${info.messageId}`);
        return info.messageId;
    } catch (error) {
        logger.error(`[AuthLinkEmail] Failed to send "${subject}" to ${email}:`, error);
        await emailLog.markAsFailed(error.message);
        return false;
    }
};

module.exports = { sendAuthLinkEmail, APP_NAME };

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');

/**
 * Send an invitation to join the ESF staff portal.
 *
 * Deliberately does NOT go through resolveRecipientEmail: an invitation is about
 * one specific address, so it must not fan out to a user's other addresses or
 * redirect to an agency owner. The recipient usually has no account yet anyway.
 */

const APP_NAME = 'SellerQI';
const PORTAL_NAME = 'eStore Factory portal';

const ROLE_LABELS = {
    admin: 'Admin — manage clients and team members',
    member: 'Member — manage clients',
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');

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
 * @param {string} params.email       Address being invited
 * @param {string} params.role        'admin' | 'member'
 * @param {string} params.inviterName Who sent it
 * @param {string} params.inviteLink  Absolute accept URL
 * @param {Date}   params.expiresAt
 * @param {string|null} params.invitedById
 * @returns {Promise<string|false>} messageId, or false when the send failed
 */
const sendEsfInviteEmail = async ({ email, role, inviterName, inviteLink, expiresAt, invitedById = null }) => {
    const adminEmail = process.env.ADMIN_EMAIL_ID
        ? process.env.ADMIN_EMAIL_ID.split(',')[0].trim()
        : 'support@sellerqi.com';
    const senderEmail = process.env.SELF_MAIL_ID || adminEmail;

    const expiresOn = expiresAt
        ? new Date(expiresAt).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
          })
        : '';

    const emailLog = new EmailLogs({
        emailType: 'ESF_INVITE',
        receiverEmail: email,
        receiverId: null, // no account exists yet
        status: 'PENDING',
        subject: `You have been invited to join the ${PORTAL_NAME}`,
        emailContent: `Invitation to join the ${PORTAL_NAME} as ${role}, sent by ${inviterName}.`,
        emailProvider: 'AWS_SES',
        metadata: { role, invitedById, expiresAt },
    });

    try {
        await emailLog.save();

        if (!isValidEmail(email)) {
            logger.error(`[EsfInvite] Invalid email address: ${email}`);
            await emailLog.markAsFailed('Invalid email address');
            return false;
        }

        // Read fresh so template edits do not need a restart, matching the
        // other senders in this folder.
        const template = fs
            .readFileSync(path.join(__dirname, '..', '..', 'Emails', 'EsfInviteTemplate.html'), 'utf8')
            .replace(/\{\{appName\}\}/g, APP_NAME)
            .replace(/\{\{portalName\}\}/g, PORTAL_NAME)
            .replace(/\{\{inviterName\}\}/g, inviterName || 'A team member')
            .replace(/\{\{inviteeEmail\}\}/g, email)
            .replace(/\{\{roleLabel\}\}/g, ROLE_LABELS[role] || ROLE_LABELS.member)
            .replace(/\{\{expiresOn\}\}/g, expiresOn)
            .replace(/\{\{inviteLink\}\}/g, inviteLink);

        const text =
            `${inviterName || 'A team member'} has invited you to join the ${PORTAL_NAME} on ${APP_NAME}.\n\n` +
            `Email: ${email}\nRole: ${ROLE_LABELS[role] || ROLE_LABELS.member}\n` +
            `Invitation expires: ${expiresOn}\n\n` +
            `Accept the invitation: ${inviteLink}\n\n` +
            `You will be asked to add your name, phone number and a password. Your email address is fixed by this invitation.\n\n` +
            `If you were not expecting this invitation, you can safely ignore this email.\n\n` +
            `Need help? Contact support@sellerqi.com`;

        const info = await transporter.sendMail({
            from: `${APP_NAME} <${senderEmail}>`,
            replyTo: 'support@sellerqi.com',
            to: email,
            subject: `You have been invited to join the ${PORTAL_NAME}`,
            text,
            html: template,
        });

        await emailLog.markAsSent();
        logger.info(`[EsfInvite] Invitation sent to ${email} as ${role}. Message ID: ${info.messageId}`);
        return info.messageId;
    } catch (error) {
        logger.error(`[EsfInvite] Failed to send invitation to ${email}:`, error);
        await emailLog.markAsFailed(error.message);
        return false;
    }
};

module.exports = { sendEsfInviteEmail, ROLE_LABELS, APP_NAME, PORTAL_NAME };

const nodemailer = require('nodemailer');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const fs = require('fs');
const path = require('path');

const REASON_LABELS = {
    'just-exploring': 'Just Exploring',
    'too-expensive': 'Too Expensive',
    'missing-features': 'Missing Features',
    'hard-to-use': "Hard to Use / Couldn't Set Up",
    'found-another-solution': 'Found Another Solution',
    'other': 'Other',
};

/**
 * Sends the "subscription cancelled" notification to the admin team. Strictly best-effort -
 * callers should not await this in a way that blocks the cancellation response, and should
 * swallow/log any rejection rather than surface it to the user.
 *
 * The feedback text is never written anywhere except this outgoing email - the EmailLogs
 * entry created here only stores minimal metadata (userEmail/userName), matching the existing
 * SendClientMessageEmail.js pattern, never the cancellation reason/feedback content itself.
 *
 * @param {Object} user - Mongoose User document (fetched before cancellation downgrades packageType)
 * @param {Object} details - { reason, feedback, wantsProductUpdates }
 */
const sendCancellationFeedbackEmail = async (user, { reason, feedback, wantsProductUpdates }) => {
    const adminEmails = process.env.ADMIN_EMAIL_ID
        ? process.env.ADMIN_EMAIL_ID.split(',').map(email => email.trim()).filter(Boolean)
        : ['support@sellerqi.com'];
    const primaryReceiverEmail = adminEmails[0];

    const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown';
    const cancelledAt = new Date().toLocaleString();
    const reasonLabel = REASON_LABELS[reason] || reason || 'Not specified';
    const feedbackText = feedback && feedback.trim() ? feedback.trim() : 'Not Provided';

    // Marketplace comes from the user's connected Seller Central account - same lookup
    // convention as server/controllers/admin/admin.js's buildAccountLookupStages/getCountryStats
    let marketplace = 'Not connected';
    try {
        if (user.sellerCentral) {
            const seller = await Seller.findById(user.sellerCentral).select('sellerAccount.country sellerAccount.region').lean();
            const account = seller?.sellerAccount?.[0];
            if (account?.country) {
                marketplace = account.region ? `${account.country} (${account.region})` : account.country;
            }
        }
    } catch (error) {
        logger.error(`Failed to look up marketplace for user ${user._id}: ${error.message}`);
    }

    const emailLog = new EmailLogs({
        emailType: 'OTHER',
        receiverEmail: primaryReceiverEmail,
        receiverId: user._id,
        status: 'PENDING',
        subject: `Subscription cancelled - ${userName}`,
        emailContent: `Cancellation notice for ${userName} (${user.email}). Reason: ${reasonLabel}.`,
        emailProvider: 'AWS_SES',
        metadata: {
            allRecipients: adminEmails,
            userEmail: user.email,
            userName,
        }
    });

    const productUpdatesBlock = reason === 'just-exploring'
        ? `<div class="info-row"><span class="info-label">Product Updates:</span><span class="info-value">${wantsProductUpdates ? 'Yes' : 'No'}</span></div>`
        : '';

    const templateHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'CancellationFeedbackEmailTemplate.html'), 'utf8');
    const html = templateHtml
        .replace(/\{\{userName\}\}/g, userName)
        .replace(/\{\{userEmail\}\}/g, user.email || 'unknown@email.com')
        .replace(/\{\{phone\}\}/g, user.phone || 'Not provided')
        .replace(/\{\{organization\}\}/g, user.agencyName || 'N/A')
        .replace(/\{\{plan\}\}/g, user.packageType || 'Unknown')
        .replace(/\{\{marketplace\}\}/g, marketplace)
        .replace(/\{\{cancelledAt\}\}/g, cancelledAt)
        .replace(/\{\{reason\}\}/g, reasonLabel)
        .replace(/\{\{feedback\}\}/g, feedbackText)
        .replace(/\{\{productUpdatesBlock\}\}/g, productUpdatesBlock);

    try {
        await emailLog.save();

        const transporter = nodemailer.createTransport({
            host: "email-smtp.us-west-2.amazonaws.com",
            port: 587,
            secure: false,
            auth: {
                user: process.env.ADMIN_USERNAME,
                pass: process.env.APP_PASSWORD,
            },
        });

        const text = `Subscription cancelled by ${userName} (${user.email}).\nReason: ${reasonLabel}\nFeedback: ${feedbackText}`;

        const info = await transporter.sendMail({
            from: adminEmails[0],
            to: adminEmails,
            subject: `Subscription cancelled - ${userName}`,
            text,
            html,
        });

        await emailLog.markAsSent();
        logger.info(`Cancellation feedback email sent. Message ID: ${info.messageId}`);
        return info.messageId;
    } catch (error) {
        logger.error(`Failed to send cancellation feedback email: ${error.message}`);
        await emailLog.markAsFailed(error.message);
        return false;
    }
};

module.exports = { sendCancellationFeedbackEmail };

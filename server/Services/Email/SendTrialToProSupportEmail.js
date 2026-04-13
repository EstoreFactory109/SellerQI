const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');

const templateHtml = fs.readFileSync(
    path.join(__dirname, '..', '..', 'Emails', 'TrialToProSupportNotificationTemplate.html'),
    'utf8'
);

const sendTrialToProSupportEmail = async ({
    userId,
    firstName,
    lastName,
    userEmail,
    userPhone,
    planType,
    amountPaid,
    invoiceNumber,
    invoiceId,
    conversionDate,
    recipientEmail
}) => {
    const supportEmail = 'support@sellerqi.com';
    const recipient = recipientEmail || supportEmail;
    const senderEmail = process.env.SELF_MAIL_ID || process.env.ADMIN_EMAIL_ID?.split(',')[0]?.trim() || supportEmail;
    const receiverId = userId && mongoose.Types.ObjectId.isValid(userId) ? userId : null;

    const emailLog = new EmailLogs({
        // EmailLogs model currently supports fixed enum values, so use OTHER for this custom alert type.
        emailType: 'OTHER',
        receiverEmail: recipient,
        receiverId: receiverId,
        status: 'PENDING',
        subject: 'Trial user converted to Pro',
        emailContent: `User ${firstName || ''} ${lastName || ''} (${userEmail || 'N/A'}) converted from trial to paid Pro.`,
        emailProvider: 'AWS_SES'
    });

    const renderedTemplate = templateHtml
        .replace('{{userId}}', userId ? String(userId) : 'N/A')
        .replace('{{userName}}', `${firstName || ''} ${lastName || ''}`.trim() || 'N/A')
        .replace('{{userEmail}}', userEmail || 'N/A')
        .replace('{{userPhone}}', userPhone || 'N/A')
        .replace('{{planType}}', planType || 'PRO')
        .replace('{{amountPaid}}', amountPaid || 'N/A')
        .replace('{{invoiceNumber}}', invoiceNumber || 'N/A')
        .replace('{{invoiceId}}', invoiceId || 'N/A')
        .replace('{{conversionDate}}', conversionDate || new Date().toLocaleString());

    try {
        await emailLog.save();

        const transporter = nodemailer.createTransport({
            host: 'email-smtp.us-west-2.amazonaws.com',
            port: 587,
            secure: false,
            auth: {
                user: process.env.ADMIN_USERNAME,
                pass: process.env.APP_PASSWORD
            }
        });

        const text = `Trial completed and converted to paid Pro.\nUser: ${firstName || ''} ${lastName || ''}\nEmail: ${userEmail || 'N/A'}\nPlan: ${planType || 'PRO'}\nAmount: ${amountPaid || 'N/A'}\nInvoice: ${invoiceNumber || invoiceId || 'N/A'}`;

        const info = await transporter.sendMail({
            from: senderEmail,
            to: recipient,
            subject: 'Trial user converted to Pro',
            text,
            html: renderedTemplate
        });

        await emailLog.markAsSent();
        logger.info(`Trial-to-Pro support email sent. Message ID: ${info.messageId}`);
        return info.messageId;
    } catch (error) {
        logger.error(`Failed to send trial-to-Pro support email: ${error.message}`);
        await emailLog.markAsFailed(error.message);
        return false;
    }
};

module.exports = { sendTrialToProSupportEmail };

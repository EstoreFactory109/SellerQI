const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const fs = require('fs');
const path = require('path');

let supportMessageEmailTemplate= fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'useRegisteredEmail.html'), 'utf8');




const sendRegisteredEmail = async (databaseId, firstName, lastName, userPhone, RegisteredEmail, userId = null) => {
    // Get first email from ADMIN_EMAIL_ID (handle comma-separated values)
    const adminEmail = process.env.ADMIN_EMAIL_ID 
        ? process.env.ADMIN_EMAIL_ID.split(',')[0].trim()
        : 'support@sellerqi.com'; // fallback

    // Use SELF_MAIL_ID or first admin email as sender
    const senderEmail = process.env.SELF_MAIL_ID || adminEmail;

    const safeUserId = userId && mongoose.Types.ObjectId.isValid(userId) ? userId : null;

    // Create email log entry
    const emailLog = new EmailLogs({
        emailType: 'USER_REGISTERED',
        receiverEmail: adminEmail, // First admin email only
        receiverId: safeUserId,
        status: 'PENDING',
        subject: "New User Registered",
        emailContent: `New user registered: ${firstName} ${lastName} (${RegisteredEmail})`,
        emailProvider: 'AWS_SES'
    });

    console.log(databaseId,firstName,lastName,userPhone,RegisteredEmail);

    let template = supportMessageEmailTemplate
    .replace('{{userId}}',databaseId)
    .replace('{{userName}}',firstName + " " + lastName)
    .replace('{{userPhone}}',userPhone)
    .replace('{{userEmail}}',RegisteredEmail)
    .replace('{{registrationDate}}', new Date().toLocaleString());
    try {
        // Save initial log
        await emailLog.save();
        logger.info(`EmailLog saved for USER_REGISTERED (id: ${emailLog._id})`);

        const transporter = nodemailer.createTransport({
            host: "email-smtp.us-west-2.amazonaws.com",
            port: 587,
            secure: false,
            auth: {
                user: process.env.ADMIN_USERNAME,
                pass: process.env.APP_PASSWORD,
            },
        });

        const text = `
            Dear Admin,

            A new user has been registered in the system.

            Best regards,
            SellerQi Team

            `;
        const body = template;

        // Send mail with defined transport object
        const info = await transporter.sendMail({
            from: senderEmail,
            to: adminEmail,
            subject: "New User Registered",
            text: text,
            html: body,
        });

        // Mark email as sent
        await emailLog.markAsSent();
        logger.info(`User registered email sent successfully. Message ID: ${info.messageId}`);
        return info.messageId;
    } catch (error) {
        logger.error(`Failed to send USER_REGISTERED email to ${adminEmail}: ${error.message}`, error);
        try {
            await emailLog.markAsFailed(error.message);
        } catch (logError) {
            logger.error(`Could not mark USER_REGISTERED email as FAILED: ${logError.message}`);
        }
        return false;
    }
};

module.exports = { sendRegisteredEmail };
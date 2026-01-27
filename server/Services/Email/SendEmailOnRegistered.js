const nodemailer = require('nodemailer');
const dns = require('dns');
const { promisify } = require('util');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const resolveMx = promisify(dns.resolveMx);
const fs = require('fs');
const path = require('path');

let supportMessageEmailTemplate= fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'useRegisteredEmail.html'), 'utf8');




const sendRegisteredEmail = async (databaseId, firstName, lastName, userPhone, RegisteredEmail, sellerId, userId = null) => {
    // Get first email from ADMIN_EMAIL_ID (handle comma-separated values)
    const adminEmail = process.env.ADMIN_EMAIL_ID 
        ? process.env.ADMIN_EMAIL_ID.split(',')[0].trim()
        : 'support@sellerqi.com'; // fallback

    // Use SELF_MAIL_ID or first admin email as sender
    const senderEmail = process.env.SELF_MAIL_ID || adminEmail;

    // Create email log entry
    const emailLog = new EmailLogs({
        emailType: 'USER_REGISTERED',
        receiverEmail: adminEmail, // First admin email only
        receiverId: userId,
        status: 'PENDING',
        subject: "New User Registered",
        emailContent: `New user registered: ${firstName} ${lastName} (${RegisteredEmail})`,
        emailProvider: 'AWS_SES'
    });

    console.log(databaseId,firstName,lastName,userPhone,RegisteredEmail,sellerId);

    let template = supportMessageEmailTemplate
    .replace('{{userId}}',databaseId)
    .replace('{{userName}}',firstName + " " + lastName)
    .replace('{{userPhone}}',userPhone)
    .replace('{{userEmail}}',RegisteredEmail)
    .replace('{{sellerId}}',sellerId)
    .replace('{{registrationDate}}', new Date().toLocaleString());
    try {
        // Save initial log
        await emailLog.save();

        const transporter = nodemailer.createTransport({
            host: "email-smtp.us-west-2.amazonaws.com",
            port: 587, // Use 587 for STARTTLS
            secure: false, // Set to false for STARTTLS
            auth: {
                user: process.env.ADMIN_USERNAME, // Your Gmail address
                pass: process.env.APP_PASSWORD, // Your Gmail password or App Password
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
            from: senderEmail, // Sender address (first email only)
            to: adminEmail, // First admin email only
            subject: "New User Registered", // Subject line
            text: text, // Plain text body
            html: body, // HTML body
        });

        // Mark email as sent
        await emailLog.markAsSent();
        logger.info(`User registered email sent successfully. Message ID: ${info.messageId}`);
        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send email to ${adminEmail}:`, error);
        await emailLog.markAsFailed(error.message);
        return false;

    }
};

module.exports = { sendRegisteredEmail };
const nodemailer = require('nodemailer');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const fs = require('fs');
const path = require('path');

let VerificationEmailTemplate= fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'verificationCodeTemplate.html'), 'utf8');


const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const sendEmail = async (email, firstName, otp, userId = null) => {
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

    let template = VerificationEmailTemplate
    .replace('{{userName}}',firstName)
    .replace('{{verificationCode}}', otp);
    
    try {
        // Save initial log
        await emailLog.save();

        if (!isValidEmail(email)) {
            logger.error(`Invalid email address: ${email}`);
            await emailLog.markAsFailed('Invalid email address');
            return false
        }

        const transporter = nodemailer.createTransport({
            host: "email-smtp.us-west-2.amazonaws.com",
            port: 587, // Use 587 for STARTTLS
            secure: false, // Set to false for STARTTLS
            auth: {
                user: process.env.ADMIN_USERNAME, // Your Gmail address
                pass: process.env.APP_PASSWORD, // Your Gmail password or App Password
            },
        });

        const subject = "Your One-Time Password (OTP) for Verification";
        const text = `
            Dear ${firstName},

            Your One-Time Password (OTP) for verification is: ${otp}

            This OTP is valid for the next 10 minutes. Please do not share it with anyone.

            If you did not request this, please ignore this email.

            Best regards,  
            IBEX Team
            
            `;
        const body = template;

        // Send mail with defined transport object
        const info = await transporter.sendMail({
            from: process.env.ADMIN_EMAIL_ID, // Sender address
            to: email, // List of receivers
            subject: subject, // Subject line
            text: text, // Plain text body
            html: body, // HTML body
        });

        // Mark email as sent
        await emailLog.markAsSent();
        logger.info(`OTP email sent successfully to ${email}. Message ID: ${info.messageId}`);
        
        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send email to ${email}:`, error);
        await emailLog.markAsFailed(error.message);
        return false;

    }
};

module.exports = { sendEmail };
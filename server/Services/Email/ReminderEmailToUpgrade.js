const nodemailer = require('nodemailer');
const dns = require('dns');
const { promisify } = require('util');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/EmailLogsModel.js');
const resolveMx = promisify(dns.resolveMx);
const fs = require('fs');
const path = require('path');

let ReminderEmailTemplate= fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'FreeTrialUpgradeMailTemplate.html'), 'utf8');




const RemiderEmail = async (Email, days, userName, upgradeUrl, userId = null) => {
    // Create email log entry
    const emailLog = new EmailLogs({
        emailType: 'UPGRADE_REMINDER',
        receiverEmail: Email,
        receiverId: userId,
        status: 'PENDING',
        subject: `Your Free Trial Ends in ${days}`,
        emailContent: `Only ${days} left in your free trial. Upgrade now to continue optimizing your Amazon business.`,
        emailProvider: 'AWS_SES'
    });

    console.log(Email,days,userName,upgradeUrl);
 
    // Ensure all values are strings and handle undefined/null values
    const safeReplace = (template, placeholder, value) => {
        const safeValue = value !== undefined && value !== null ? String(value) : '0';
        return template.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), safeValue);
    };

    let template = ReminderEmailTemplate;
    
    // Replace all template variables
    template = safeReplace(template, '{{days}}', days);
    template = safeReplace(template, '{{userName}}', userName);
    template = safeReplace(template, '{{upgradeUrl}}', upgradeUrl);
    
    


    try {
        // Save initial log
        await emailLog.save();
        
        const transporter = nodemailer.createTransport({
            host: "email-smtp.us-west-2.amazonaws.com",
            port: 587, // Use 587 for STARTTLS
            secure: false, // Set to false for STARTTLS
            auth: {
                user: process.env.ADMIN_USERNAME, // Your AWS SES access key
                pass: process.env.APP_PASSWORD, // Your AWS SES secret key
            },
        });

        
        const text = `
            Dear ${userName},

            Only ${days} left in your free trial. Upgrade now to continue optimizing your Amazon business performance.

            Best regards,  
            SellerQi Team
            
            `;
        const body = template;

        // Send mail with defined transport object
        const info = await transporter.sendMail({
            from: process.env.ADMIN_EMAIL_ID, // Sender address
            to: Email, // List of receivers
            subject: `Your Free Trial Ends in ${days}`, // Subject line
            text: text, // Plain text body
            html: body, // HTML body
        });

        // Mark email as sent
        await emailLog.markAsSent();
        logger.info(`Upgrade reminder email sent successfully to ${Email}. Message ID: ${info.messageId}`);
        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send email to ${Email}:`, error);
        await emailLog.markAsFailed(error.message);
        return false;

    }
}

module.exports = { RemiderEmail };
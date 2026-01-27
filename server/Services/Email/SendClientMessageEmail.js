const nodemailer = require('nodemailer');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const fs = require('fs');
const path = require('path');

// Template will be read inside the function to ensure latest changes




const sendEmail = async (email, firstName, message, subject, topic, userId = null) => {
    // Parse multiple emails from environment variable (comma-separated)
    const adminEmails = process.env.ADMIN_EMAIL_ID 
        ? process.env.ADMIN_EMAIL_ID.split(',').map(email => email.trim()).filter(email => email)
        : ['support@sellerqi.com']; // fallback

    // Use first email as primary receiver for logging (schema requires single email)
    const primaryReceiverEmail = adminEmails[0];

    // Create email log entry
    const emailLog = new EmailLogs({
        emailType: 'SUPPORT_MESSAGE',
        receiverEmail: primaryReceiverEmail, // Primary receiver (schema requires single email)
        receiverId: userId,
        status: 'PENDING',
        subject: subject,
        emailContent: `Support message from ${firstName} (${email}): ${message}`,
        emailProvider: 'AWS_SES',
        metadata: {
            allRecipients: adminEmails, // Store all recipients in metadata
            userEmail: email,
            userName: firstName
        }
    });

    console.log(email,firstName,message,subject,topic);
    
    // Read template fresh each time to ensure latest changes are included
    let supportMessageEmailTemplate = fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'SupportMessageEmailTemplate.html'), 'utf8');

    // Use global replacement to replace ALL occurrences of each placeholder
    let template = supportMessageEmailTemplate
    .replace(/\{\{clientName\}\}/g, firstName || 'Unknown')
    .replace(/\{\{clientEmail\}\}/g, email || 'unknown@email.com')
    .replace(/\{\{message\}\}/g, message || 'No message provided')
    .replace(/\{\{topic\}\}/g, topic || 'General')
    .replace(/\{\{timestamp\}\}/g, new Date().toLocaleString());
    
    // Optional: Add minimal logging for debugging if needed
    console.log(`Email template processed for: ${firstName} (${email})`);
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

            A new support ticket has been created.

            Best regards,  
            SellerQi Team
            
            `;
        const body = template;

        // Use first email as sender
        const senderEmail = adminEmails[0];

        // Send mail with defined transport object
        const info = await transporter.sendMail({
            from: senderEmail, // Sender address
            to: adminEmails, // Array of recipients
            replyTo: email, // Reply-To set to user's email so replies go directly to them
            subject: subject, // Subject line
            text: text, // Plain text body
            html: body, // HTML body
            headers: {
                'Reply-To': email, // Explicit Reply-To header
                'X-Support-Ticket-User': email, // Custom header for tracking
                'X-Support-Ticket-Name': firstName || 'Unknown' // Custom header for user name
            }
        });

        // Mark email as sent
        await emailLog.markAsSent();
        logger.info(`Support message email sent successfully. Message ID: ${info.messageId}`);
        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send email to ${email}:`, error);
        await emailLog.markAsFailed(error.message);
        return false;

    }
};

module.exports = { sendEmail };
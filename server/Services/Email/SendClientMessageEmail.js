const nodemailer = require('nodemailer');
const dns = require('dns');
const { promisify } = require('util');
const logger = require('../../utils/Logger.js');
const resolveMx = promisify(dns.resolveMx);
const fs = require('fs');
const path = require('path');

// Template will be read inside the function to ensure latest changes




const sendEmail = async (email,firstName ,message,subject,topic) => {
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

        // Send mail with defined transport object
        const info = await transporter.sendMail({
            from: process.env.ADMIN_EMAIL_ID, // Sender address
            to: process.env.ADMIN_EMAIL_ID, // List of receivers
            bcc: process.env.ADMIN_EMAIL_ID, // BCC to admin
            subject: subject, // Subject line
            text: text, // Plain text body
            html: body, // HTML body
        });

        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send email to ${email}:`, error);
        return false;

    }
};

module.exports = { sendEmail };
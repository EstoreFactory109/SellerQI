const nodemailer = require('nodemailer');
const dns = require('dns');
const { promisify } = require('util');
const logger = require('../../utils/Logger.js');
const resolveMx = promisify(dns.resolveMx);
const fs = require('fs');
const path = require('path');

let VerificationEmailTemplate= fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'ResetPasswordEmailTemplate.html'), 'utf8');


const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};


const checkEmailDomain = async (email) => {
    const domain = email.split('@')[1];
    try {
        const addresses = await resolveMx(domain);
        return addresses && addresses.length > 0;
    } catch (err) {
        return false;
    }
};

const sendEmailResetLink = async (email,firstName ,link) => {

    console.log("Email file: ");
    console.log(email,firstName,link);
    let template = VerificationEmailTemplate
    .replace('{{userName}}',firstName)
    .replace('{{resetLink}}', link);
    try {
        // Check if required environment variables are set
        if (!process.env.ADMIN_USERNAME || !process.env.APP_PASSWORD || !process.env.ADMIN_EMAIL_ID) {
            logger.error('Missing required environment variables: ADMIN_USERNAME, APP_PASSWORD, or ADMIN_EMAIL_ID');
            return false;
        }

        if (!isValidEmail(email)) {
            logger.error(`Invalid email address: ${email}`);
            return false
        }

        // Step 2: Check if email domain has valid MX records
        const domainValid = await checkEmailDomain(email);
        if (!domainValid) {
            logger.error(`Invalid email domain for ${email}`);
            return false
        }

        const transporter = nodemailer.createTransport({
            host: "email-smtp.us-west-2.amazonaws.com",
            port: 587, // Use 587 for STARTTLS
            secure: false, // Set to false for STARTTLS
            auth: {
                user: process.env.ADMIN_USERNAME, // AWS SES SMTP username
                pass: process.env.APP_PASSWORD, // AWS SES SMTP password
            },
        });

        const subject = "Your Reset Password Link";
        const text = `
            Dear ${firstName},

            We received a request to reset the password for your IBEX account.

            To proceed, please click the link below to set a new password:
            ${link}

            This link will expire in 30 minutes for security reasons.

            If you did not request this, you can safely ignore this email.

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

        logger.info(`Email sent successfully to ${email}. Message ID: ${info.messageId}`);
        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send email to ${email}:`, error);
        logger.error(`Error details: ${error.message}`);
        if (error.response) {
            logger.error(`SMTP Response: ${error.response}`);
        }
        return false;

    }
};

module.exports = { sendEmailResetLink };
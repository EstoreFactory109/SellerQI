const nodemailer = require('nodemailer');
const dns = require('dns');
const { promisify } = require('util');
const logger = require('../../utils/Logger.js');
const resolveMx = promisify(dns.resolveMx);
const fs = require('fs');
const path = require('path');

let supportMessageEmailTemplate= fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'useRegisteredEmail.html'), 'utf8');




const sendRegisteredEmail = async (databaseId, firstName, lastName, userPhone, RegisteredEmail,sellerId) => {
    console.log(databaseId,firstName,lastName,userPhone,RegisteredEmail,sellerId);

    let template = supportMessageEmailTemplate
    .replace('{{userId}}',databaseId)
    .replace('{{userName}}',firstName + " " + lastName)
    .replace('{{userPhone}}',userPhone)
    .replace('{{userEmail}}',RegisteredEmail)
    .replace('{{sellerId}}',sellerId)
    .replace('{{registrationDate}}', new Date().toLocaleString());
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

            A new user has been registered in the system.

            Best regards,  
            SellerQi Team
            
            `;
        const body = template;

        // Send mail with defined transport object
        const info = await transporter.sendMail({
            from: process.env.SELF_MAIL_ID, // Sender address
            to: process.env.ADMIN_EMAIL_ID, // List of receivers
            subject: "New User Registered", // Subject line
            text: text, // Plain text body
            html: body, // HTML body
        });

        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send email to ${email}:`, error);
        return false;

    }
};

module.exports = { sendRegisteredEmail };
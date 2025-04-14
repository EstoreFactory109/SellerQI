const nodemailer = require('nodemailer');
const dns = require('dns');
const { promisify } = require('util');
const logger = require('../../utils/Logger.js');
const resolveMx = promisify(dns.resolveMx);

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

const sendEmail = async (email,firstName ,otp) => {
    try {


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
            host: "smtp.gmail.com",
            port: 587, // Use 587 for STARTTLS
            secure: false, // Set to false for STARTTLS
            auth: {
                user: process.env.ADMIN_EMAIL_ID, // Your Gmail address
                pass: process.env.APP_PASSWORD, // Your Gmail password or App Password
            },
        });

        const subject = "Your One-Time Password (OTP) for Verification";
        const text = `
            Dear ${firstName},

            Your One-Time Password (OTP) for verification is: ${otp}

            This OTP is valid for the next [Time Duration] minutes. Please do not share it with anyone.

            If you did not request this, please ignore this email.

            Best regards,  
            IBEX Team
            
            `;
        const body = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                .container {
                    font-family: Arial, sans-serif;
                    max-width: 600px;
                    margin: auto;
                    padding: 20px;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    background-color: #f9f9f9;
                }
                .otp {
                    font-size: 24px;
                    font-weight: bold;
                    color: #333;
                    text-align: center;
                    background: #eee;
                    padding: 10px;
                    border-radius: 5px;
                }
                .footer {
                    margin-top: 20px;
                    font-size: 12px;
                    color: #777;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Your One-Time Password (OTP)</h2>
                <p>Dear ${firstName},</p>
                <p>Your OTP for verification is:</p>
                <p class="otp">${otp}</p>
                <p>This OTP is valid for the next <strong>2 minutes</strong>. Please do not share it with anyone.</p>
                <p>If you did not request this, please ignore this email.</p>
                <p class="footer">
                    Regards, <br>
                    <strong>[Your Company Name]</strong> <br>
                    [Your Website URL] <br>
                    [Your Support Email]
                </p>
            </div>
        </body>
        </html>
        `

        // Send mail with defined transport object
        const info = await transporter.sendMail({
            from: process.env.PROVIDER, // Sender address
            to: email, // List of receivers
            subject: subject, // Subject line
            text: text, // Plain text body
            html: body, // HTML body
        });

        return info.messageId; // Return the message ID on success
    } catch (error) {
        return false;

    }
};

module.exports = { sendEmail };
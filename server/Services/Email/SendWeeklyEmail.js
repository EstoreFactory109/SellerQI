const nodemailer = require('nodemailer');
const dns = require('dns');
const { promisify } = require('util');
const logger = require('../../utils/Logger.js');
const resolveMx = promisify(dns.resolveMx);
const fs = require('fs');
const path = require('path');

let supportMessageEmailTemplate= fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'weekly-report-email-template.html'), 'utf8');




const sendWeeklyEmailToUser = async (firstName,Email,marketPlace,brandName,healthScore,rankingErrors,conversionErrors,accountErrors,profitabilityErrors,sponsoredAdsErrors,inventoryErrors,totalIssues,totalActiveProducts) => {
    //console.log(databaseId,firstName,lastName,userPhone,RegisteredEmail,sellerId);
    const todayDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    
    // Handle division by zero for progress width calculations
    const rankingsProgressWidth = totalIssues > 0 ? (rankingErrors / totalIssues) * 100 : 0;
    const conversionProgressWidth = totalIssues > 0 ? (conversionErrors / totalIssues) * 100 : 0;
    const accountProgressWidth = totalIssues > 0 ? (accountErrors / totalIssues) * 100 : 0;
    const profitabilityProgressWidth = totalIssues > 0 ? (profitabilityErrors / totalIssues) * 100 : 0;
    const sponsoredAdsProgressWidth = totalIssues > 0 ? (sponsoredAdsErrors / totalIssues) * 100 : 0;
    const inventoryProgressWidth = totalIssues > 0 ? (inventoryErrors / totalIssues) * 100 : 0;

    // Ensure all values are strings and handle undefined/null values
    const safeReplace = (template, placeholder, value) => {
        const safeValue = value !== undefined && value !== null ? String(value) : '0';
        return template.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), safeValue);
    };

    let template = supportMessageEmailTemplate;
    
    // Replace all template variables
    template = safeReplace(template, '{{weekDate}}', todayDate);
    template = safeReplace(template, '{{storeName}}', brandName);
    template = safeReplace(template, '{{marketplaces}}', marketPlace);
    template = safeReplace(template, '{{totalProducts}}', totalActiveProducts);
    template = safeReplace(template, '{{healthScore}}', healthScore);
    template = safeReplace(template, '{{totalIssues}}', totalIssues);
    template = safeReplace(template, '{{rankingsCount}}', rankingErrors);
    template = safeReplace(template, '{{rankingsProgressWidth}}', rankingsProgressWidth);
    template = safeReplace(template, '{{conversionCount}}', conversionErrors);
    template = safeReplace(template, '{{conversionProgressWidth}}', conversionProgressWidth);
    template = safeReplace(template, '{{accountHealthCount}}', accountErrors);
    template = safeReplace(template, '{{accountHealthProgressWidth}}', accountProgressWidth);
    template = safeReplace(template, '{{profitabilityCount}}', profitabilityErrors);
    template = safeReplace(template, '{{profitabilityProgressWidth}}', profitabilityProgressWidth);
    template = safeReplace(template, '{{sponsoredAdsCount}}', sponsoredAdsErrors);
    template = safeReplace(template, '{{sponsoredAdsProgressWidth}}', sponsoredAdsProgressWidth);
    template = safeReplace(template, '{{inventoryCount}}', inventoryErrors);
    template = safeReplace(template, '{{inventoryProgressWidth}}', inventoryProgressWidth);
    
    // Replace missing social media and help center URLs
    template = safeReplace(template, '{{helpCenterUrl}}', 'https://help.sellerqi.com');
    template = safeReplace(template, '{{facebookUrl}}', 'https://www.facebook.com/sellerqi');
    template = safeReplace(template, '{{twitterUrl}}', 'https://twitter.com/sellerqi');
    template = safeReplace(template, '{{linkedinUrl}}', 'https://www.linkedin.com/company/sellerqi');
    template = safeReplace(template, '{{youtubeUrl}}', 'https://www.youtube.com/@sellerqi');

    try {



        const transporter = nodemailer.createTransport({
            host: "email-smtp.us-west-2.amazonaws.com",
            port: 587, // Use 587 for STARTTLS
            secure: false, // Set to false for STARTTLS
            auth: {
                user: "AKIA2FN7DZKEYYDJEN77", // Your Gmail address
                pass: "BIL6H/1cR769EdaTP20/T+Gohw+FqxFE5a6yjkEdE0+z", // Your Gmail password or App Password
            },
        });

        
        const text = `
            Dear ${firstName},

            This is your weekly report for ${brandName}.

            Best regards,  
            SellerQi Team
            
            `;
        const body = template;

        // Send mail with defined transport object
        const info = await transporter.sendMail({
            from: "support@sellerqi.com", // Sender address
            to: Email, // List of receivers
            subject: "Weekly Report for "+brandName, // Subject line
            text: text, // Plain text body
            html: body, // HTML body
        });

        return info.messageId; // Return the message ID on success
    } catch (error) {
        logger.error(`Failed to send email to ${Email}:`, error);
        return false;

    }
}

module.exports = { sendWeeklyEmailToUser };
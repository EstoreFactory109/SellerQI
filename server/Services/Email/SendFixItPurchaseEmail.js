/**
 * Tells the ESF team that a seller paid for a "Fix it" package, with everything needed to call
 * them: name, email, phone, WhatsApp, brand and what they bought.
 *
 * Goes to FIXIT_PURCHASE_NOTIFY_EMAIL (comma-separated allowed), else support@estorefactory.com.
 * Never throws: returns the message id, or false (the caller releases its claim so the other
 * completion path — webhook or success page — tries again).
 */
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');

const DEFAULT_RECIPIENT = 'support@estorefactory.com';

const templateHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'Emails', 'FixItPurchaseTemplate.html'), 'utf8');

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const money = (amount, currency = 'USD') => (typeof amount === 'number'
    ? `${String(currency).toUpperCase() === 'USD' ? '$' : `${String(currency).toUpperCase()} `}${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    : 'N/A');

/** Google signups get a placeholder number until they add theirs — never pass that off as real. */
const phoneOf = (user, field) => {
    const value = user[field];
    if (user.needsPhoneUpdate && user.phoneUpdateReason === 'missing') return 'Not provided (signed up with Google)';
    if (!value) return 'Not provided';
    if (user.needsPhoneUpdate && user.phoneUpdateReason === 'country_code') return `${value} (country code may be missing)`;
    return value;
};

const planOf = (user) => {
    const plan = user.packageType || 'LITE';
    if (user.isInTrialPeriod) return `${plan} (trial)`;
    return user.isEsfClient ? `${plan} · ESF client` : plan;
};

const SOURCE_NOTE = {
    created: 'new project created for this purchase',
    matched: 'found by brand and linked to this account',
    linked: 'already linked to this account',
};

/** What happened in Zoho Projects (FixItZohoService), as two lines for the email. */
const zohoLines = (purchase) => {
    const projectLine = purchase.zohoProjectName
        ? `${purchase.zohoProjectName}${SOURCE_NOTE[purchase.zohoProjectSource] ? ` (${SOURCE_NOTE[purchase.zohoProjectSource]})` : ''}`
        : null;
    switch (purchase.zohoStatus) {
        case 'done':
            return { project: projectLine || 'N/A', task: purchase.zohoTaskName || 'Created' };
        case 'failed':
            return {
                project: projectLine || 'None',
                task: `NOT created — ${purchase.zohoError || 'unknown error'}. Please add it by hand.`,
            };
        case 'skipped':
            return { project: 'Not an ESF client — no Zoho task', task: '—' };
        default:
            return { project: 'Not attempted', task: '—' };
    }
};

const recipients = () => (process.env.FIXIT_PURCHASE_NOTIFY_EMAIL || DEFAULT_RECIPIENT)
    .split(',').map((e) => e.trim()).filter(Boolean);

/**
 * @param {object} purchase  a FixItPurchase document (plain object is fine)
 * @returns {Promise<string|false>}
 */
const sendFixItPurchaseEmail = async (purchase) => {
    const to = recipients();
    const user = await User.findById(purchase.userId)
        .select('firstName lastName email phone whatsapp needsPhoneUpdate phoneUpdateReason packageType isInTrialPeriod isEsfClient')
        .lean()
        .catch(() => null);
    if (!user) {
        logger.error(`[FixIt] purchase ${purchase._id}: user ${purchase.userId} not found, support email not sent`);
        return false;
    }

    let brand = 'Not connected';
    let marketplaces = 'Not connected';
    try {
        const seller = await Seller.findOne({ User: user._id }).select('brand sellerAccount.country').lean();
        if (seller?.brand) brand = seller.brand;
        const countries = [...new Set((seller?.sellerAccount || []).map((a) => a.country).filter(Boolean))];
        if (countries.length) marketplaces = countries.join(', ');
    } catch (err) {
        logger.warn(`[FixIt] could not read Seller for ${user._id}: ${err.message}`);
    }

    const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
    const amountPaid = money(purchase.amount, purchase.currency);
    const fields = {
        userName,
        userEmail: user.email || 'N/A',
        userPhone: phoneOf(user, 'phone'),
        userWhatsapp: phoneOf(user, 'whatsapp'),
        packageName: purchase.packageName,
        tasks: purchase.tasks,
        amountPaid,
        paidAt: (purchase.paidAt ? new Date(purchase.paidAt) : new Date()).toUTCString(),
        openTasks: purchase.openTasks ?? 'N/A',
        // In the seller's marketplace currency (what the Tasks page showed them), not USD.
        monthlyRecoverable: typeof purchase.monthlyRecoverable === 'number'
            ? `~${purchase.atStakeCurrency || '$'}${Math.round(purchase.monthlyRecoverable).toLocaleString('en-US')}/mo`
            : 'N/A',
        brand,
        marketplaces,
        plan: planOf(user),
        userId: String(user._id),
        paymentIntentId: purchase.stripePaymentIntentId || 'N/A',
        stripePaymentUrl: purchase.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${purchase.stripePaymentIntentId}` : 'https://dashboard.stripe.com/payments',
        customerId: purchase.stripeCustomerId || 'N/A',
        zohoProject: zohoLines(purchase).project,
        zohoTask: zohoLines(purchase).task,
    };

    const html = Object.entries(fields).reduce(
        (out, [key, value]) => out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), escapeHtml(value)),
        templateHtml
    );
    const newProject = purchase.zohoProjectSource === 'created' && purchase.zohoProjectName
        ? ` — new Zoho project "${purchase.zohoProjectName}"`
        : '';
    const subject = `Fix it purchase: ${purchase.packageName} (${amountPaid}) — ${userName}${newProject}`;
    const text = [
        `${userName} bought the Fix it ${purchase.packageName} package (${purchase.tasks} tasks) for ${amountPaid}.`,
        '',
        `Email: ${fields.userEmail}`,
        `Phone: ${fields.userPhone}`,
        `WhatsApp: ${fields.userWhatsapp}`,
        `Brand: ${brand} (${marketplaces})`,
        `Plan: ${fields.plan}`,
        `Open tasks when bought: ${fields.openTasks}`,
        `Zoho project: ${fields.zohoProject}`,
        `Zoho task: ${fields.zohoTask}`,
        `Stripe payment: ${fields.stripePaymentUrl}`,
        `SellerQI user ID: ${fields.userId}`,
    ].join('\n');

    const emailLog = new EmailLogs({
        emailType: 'OTHER',
        receiverEmail: to.join(', '),
        receiverId: null,
        status: 'PENDING',
        subject,
        emailContent: text,
        emailProvider: 'AWS_SES',
    });

    try {
        await emailLog.save();
        const transporter = nodemailer.createTransport({
            host: 'email-smtp.us-west-2.amazonaws.com',
            port: 587,
            secure: false,
            auth: { user: process.env.ADMIN_USERNAME, pass: process.env.APP_PASSWORD },
        });
        const from = process.env.SELF_MAIL_ID || process.env.ADMIN_EMAIL_ID?.split(',')[0]?.trim() || 'support@sellerqi.com';
        const info = await transporter.sendMail({ from, to, replyTo: user.email || undefined, subject, text, html });
        await emailLog.markAsSent();
        logger.info(`[FixIt] support email for purchase ${purchase._id} sent to ${to.join(', ')} (${info.messageId})`);
        return info.messageId;
    } catch (error) {
        logger.error(`[FixIt] support email for purchase ${purchase._id} failed: ${error.message}`);
        await emailLog.markAsFailed(error.message).catch(() => {});
        return false;
    }
};

module.exports = { sendFixItPurchaseEmail, DEFAULT_RECIPIENT, escapeHtml };

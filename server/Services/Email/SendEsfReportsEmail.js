/**
 * Sends one Estore Factory reports email: the reports due this cycle, each
 * attached as a PDF built from the shared report template.
 *
 * One email per CADENCE, not per report — a client on the weekly cycle gets a
 * single message carrying all three weekly PDFs rather than three messages.
 *
 * THREE THINGS THIS DOES DIFFERENTLY FROM SendWeeklyEmail.js, deliberately:
 *
 *  1. The transport is created once by the caller and passed in. The weekly
 *     report opens a fresh SMTP connection per recipient and sends every seller
 *     in parallel; production logs show that failing roughly half the time with
 *     ECONNRESET / EPIPE / "451 Timeout waiting for data from client".
 *  2. `userId` is passed through to the log AND to resolveRecipientEmail. The
 *     weekly report omits it, so all 559 of its log rows have a null receiverId
 *     and cannot be traced to an account.
 *  3. Nothing is invented. The weekly report hardcodes totalActiveProducts to
 *     the string "59" for every account it has ever emailed.
 */
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const { resolveRecipientEmail } = require('./resolveRecipientEmail.js');

const template = fs.readFileSync(
    path.join(__dirname, '..', '..', 'Emails', 'EsfReportsEmailTemplate.html'),
    'utf8'
);

/**
 * One SMTP transport, reused for a whole run.
 *
 * `pool` keeps a small number of connections open instead of handshaking per
 * message, and maxMessages/rateDelta bound how hard a run can hit SES. This is
 * the single most important difference from the existing weekly job.
 */
const createReportsTransport = () => nodemailer.createTransport({
    host: process.env.SES_SMTP_HOST || 'email-smtp.us-west-2.amazonaws.com',
    port: 587,
    secure: false,
    auth: { user: process.env.ADMIN_USERNAME, pass: process.env.APP_PASSWORD },
    pool: true,
    maxConnections: Number(process.env.ESF_REPORTS_MAX_CONNECTIONS || 2),
    maxMessages: 50,
    rateLimit: Number(process.env.ESF_REPORTS_RATE_LIMIT || 5),   // messages per rateDelta
    rateDelta: 1000,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 45000,
});

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** One row per report in the email body: name, period, and its headline finding. */
const buildRows = (reports) => reports.map((report) => `
    <tr>
      <td style="padding:11px 14px;border-bottom:1px solid #E6E9EE;">
        <div style="font:600 14px Arial,Helvetica,sans-serif;color:#1F3864;">${escapeHtml(report.name)}</div>
        <div style="font:12px Arial,Helvetica,sans-serif;color:#6B7280;margin-top:2px;">${escapeHtml(report.date)}${report.marketplaceLabel ? ` &middot; ${escapeHtml(report.marketplaceLabel)}` : ''}</div>
      </td>
      <td style="padding:11px 14px;border-bottom:1px solid #E6E9EE;font:13px Arial,Helvetica,sans-serif;color:${report.tone === 'watch' ? '#C00000' : report.tone === 'good' ? '#1E7E34' : '#111'};">
        ${escapeHtml(report.insight)}
      </td>
    </tr>`).join('');

/**
 * Send one cadence's reports to one client.
 *
 * @param {object}   params
 * @param {string}   params.email       the client's own address
 * @param {string}   params.firstName
 * @param {string}   params.userId      REQUIRED so the log row is attributable
 * @param {string}   params.cadenceLabel e.g. "Weekly"
 * @param {Array}    params.reports     [{ name, date, insight, tone, marketplaceLabel }]
 * @param {Array}    params.attachments [{ filename, content: Buffer }]
 * @param {object}   params.transport   a transport from createReportsTransport()
 * @param {string}   [params.recipientOverride] send to exactly this address (or
 *   comma-separated list) instead of resolving the client's own. ONLY for test
 *   and staging scripts — it bypasses agency redirection and multi-address
 *   fan-out, so a real run must never set it. Every use is logged at warn.
 * @returns {Promise<string|false>} messageId, or false on failure
 */
const sendEsfReportsEmail = async ({
    email,
    firstName = 'there',
    userId,
    cadenceLabel,
    reports,
    attachments,
    transport,
    recipientOverride = null,
}) => {
    let recipients;
    if (recipientOverride) {
        recipients = recipientOverride;
        logger.warn(`[EsfReportsEmail] RECIPIENT OVERRIDE ACTIVE — ${cadenceLabel} reports for ${email} are being sent to ${recipientOverride} instead`);
    } else {
        recipients = await resolveRecipientEmail(email, userId);
    }
    const senderEmail = process.env.SELF_MAIL_ID
        || (process.env.ADMIN_EMAIL_ID || 'support@sellerqi.com').split(',')[0].trim();

    const subject = `Your ${cadenceLabel} Estore Factory reports`;

    const emailLog = new EmailLogs({
        emailType: 'ESF_REPORTS',
        receiverEmail: recipients,
        receiverId: userId,
        status: 'PENDING',
        subject,
        emailContent: `${cadenceLabel} reports: ${reports.map((r) => r.name).join(', ')}`,
        emailProvider: 'AWS_SES',
    });

    let html = template;
    html = html.replace(/\{\{firstName\}\}/g, escapeHtml(firstName));
    html = html.replace(/\{\{cadenceLabel\}\}/g, escapeHtml(cadenceLabel));
    html = html.replace(/\{\{reportCount\}\}/g, String(reports.length));
    html = html.replace(/\{\{reportWord\}\}/g, reports.length === 1 ? 'report' : 'reports');
    html = html.replace(/\{\{reportRows\}\}/g, buildRows(reports));
    html = html.replace(/\{\{portalUrl\}\}/g, process.env.CLIENT_URL
        ? `${process.env.CLIENT_URL.replace(/\/$/, '')}/seller-central-checker/estore-factory/reports`
        : 'https://app.sellerqi.com/seller-central-checker/estore-factory/reports');
    html = html.replace(/\{\{year\}\}/g, String(new Date().getUTCFullYear()));

    const text = `Hello ${firstName},\n\n`
        + `Your ${cadenceLabel.toLowerCase()} Estore Factory ${reports.length === 1 ? 'report is' : 'reports are'} attached as PDF.\n\n`
        + reports.map((r) => `- ${r.name} (${r.date}): ${r.insight}`).join('\n')
        + '\n\nEstore Factory\n';

    try {
        await emailLog.save();

        const info = await transport.sendMail({
            from: senderEmail,
            to: recipients,
            subject,
            text,
            html,
            attachments: attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                contentType: 'application/pdf',
            })),
        });

        await emailLog.markAsSent();
        logger.info(`[EsfReportsEmail] Sent ${cadenceLabel} reports to ${recipients} (${attachments.length} PDFs), messageId ${info.messageId}`);
        return info.messageId;
    } catch (error) {
        logger.error(`[EsfReportsEmail] Failed sending ${cadenceLabel} reports to ${recipients}: ${error.message}`);
        await emailLog.markAsFailed(error.message);
        return false;
    }
};

module.exports = { sendEsfReportsEmail, createReportsTransport };

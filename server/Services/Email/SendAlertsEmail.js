/**
 * SendAlertsEmail.js
 *
 * Sends an email to the user with a summary of their alerts (product content change,
 * negative reviews, buybox missing). Uses AlertsEmailTemplate.html.
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/Logger.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const User = require('../../models/user-auth/userModel.js');

const ALERTS_EMAIL_TEMPLATE_PATH = path.join(__dirname, '..', '..', 'Emails', 'AlertsEmailTemplate.html');
const DEFAULT_ALERTS_URL =
  (process.env.CLIENT_BASE_URL || process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://members.sellerqi.com')
    .replace(/\/$/, '') + '/seller-central-checker/notifications';

let alertsEmailTemplate = null;

function getTemplate() {
  if (!alertsEmailTemplate) {
    alertsEmailTemplate = fs.readFileSync(ALERTS_EMAIL_TEMPLATE_PATH, 'utf8');
  }
  return alertsEmailTemplate;
}

function safeReplace(template, placeholder, value) {
  const safe = value != null ? String(value) : '';
  return template.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), safe);
}

/**
 * Build HTML for a list of products (ASIN, optional SKU, optional message).
 * @param {Array<{ asin: string, sku?: string, message?: string, changeTypes?: string[], rating?: number, reviewCount?: number }>} products
 * @param {string} emptyMessage - Message when list is empty
 * @returns {string} HTML fragment
 */
function buildProductListHtml(products, emptyMessage = 'No alerts of this type.') {
  if (!Array.isArray(products) || products.length === 0) {
    return `<p style="margin: 0; font-size: 14px; color: #64748b;">${emptyMessage}</p>`;
  }
  const rows = products.map((p) => {
    const asin = escapeHtml(p.asin || '—');
    const sku = p.sku ? ` <span style="color: #64748b;">SKU: ${escapeHtml(String(p.sku))}</span>` : '';
    const extra = [];
    if (p.changeTypes && p.changeTypes.length) {
      extra.push(`Changes: ${escapeHtml(p.changeTypes.join(', '))}`);
    }
    if (p.rating != null) extra.push(`Rating: ${p.rating}`);
    if (p.reviewCount != null) extra.push(`Reviews: ${p.reviewCount}`);
    if (p.message) extra.push(escapeHtml(p.message));
    const extraLine = extra.length ? `<br><span style="font-size: 13px; color: #64748b;">${extra.join(' · ')}</span>` : '';
    return `<tr><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 14px;">ASIN: <strong>${asin}</strong>${sku}${extraLine}</td></tr>`;
  }).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 8px;"><tbody>${rows}</tbody></table>`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build summary sentence from only the counts that are included (non-zero).
 * Used so product-content email says only "content + negative reviews", buybox email says only "buybox", etc.
 */
function buildSummaryText(productContentCount, negativeReviewsCount, buyBoxMissingCount, aplusMissingCount = 0, salesDropCount = 0, lowInventoryCount = 0, strandedInventoryCount = 0, inboundShipmentCount = 0) {
  const parts = [];
  if (productContentCount > 0) {
    parts.push(`${productContentCount} product content change${productContentCount === 1 ? '' : 's'}`);
  }
  if (negativeReviewsCount > 0) {
    parts.push(`${negativeReviewsCount} negative review alert${negativeReviewsCount === 1 ? '' : 's'}`);
  }
  if (buyBoxMissingCount > 0) {
    parts.push(`${buyBoxMissingCount} buybox missing alert${buyBoxMissingCount === 1 ? '' : 's'}`);
  }
  if (aplusMissingCount > 0) {
    parts.push(`${aplusMissingCount} A+ missing alert${aplusMissingCount === 1 ? '' : 's'}`);
  }
  if (salesDropCount > 0) {
    parts.push(`${salesDropCount} sales drop alert${salesDropCount === 1 ? '' : 's'}`);
  }
  if (lowInventoryCount > 0) {
    parts.push(`${lowInventoryCount} low inventory alert${lowInventoryCount === 1 ? '' : 's'}`);
  }
  if (strandedInventoryCount > 0) {
    parts.push(`${strandedInventoryCount} stranded inventory alert${strandedInventoryCount === 1 ? '' : 's'}`);
  }
  if (inboundShipmentCount > 0) {
    parts.push(`${inboundShipmentCount} inbound shipment alert${inboundShipmentCount === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return 'you have no new alerts.';
  return `you have ${parts.join(', ')}.`;
}

/**
 * Build HTML for summary-only email: one row per alert type with count (e.g. "A+ content not present – 10 Products").
 * @param {Object} payload - Same shape as alertsPayload (counts and optional products/drops)
 * @returns {string} HTML table fragment
 */
function buildSummaryRowsHtml(payload) {
  const productContent = payload?.productContentChange ?? { count: 0 };
  const negativeReviews = payload?.negativeReviews ?? { count: 0 };
  const buyBoxMissing = payload?.buyBoxMissing ?? { count: 0 };
  const aplusMissing = payload?.aplusMissing ?? { count: 0 };
  const salesDrop = payload?.salesDrop ?? { count: 0, drops: [] };
  const lowInventory = payload?.lowInventory ?? { count: 0 };
  const strandedInventory = payload?.strandedInventory ?? { count: 0 };
  const inboundShipment = payload?.inboundShipment ?? { count: 0 };

  const rows = [];
  if ((productContent.count ?? 0) > 0) {
    rows.push({ label: 'Product content change', count: productContent.count, suffix: 'Products' });
  }
  if ((negativeReviews.count ?? 0) > 0) {
    rows.push({ label: 'Negative reviews (rating < 4)', count: negativeReviews.count, suffix: 'Products' });
  }
  if ((buyBoxMissing.count ?? 0) > 0) {
    rows.push({ label: 'Buy box missing', count: buyBoxMissing.count, suffix: 'Products' });
  }
  if ((aplusMissing.count ?? 0) > 0) {
    rows.push({ label: 'A+ content not present', count: aplusMissing.count, suffix: 'Products' });
  }
  const dropCount = (salesDrop.drops?.length ?? 0) || (salesDrop.count ?? 0);
  if (dropCount > 0) {
    rows.push({ label: 'Sales drop', count: dropCount, suffix: dropCount === 1 ? 'day' : 'days' });
  }
  if ((lowInventory.count ?? 0) > 0) {
    rows.push({ label: 'Low inventory / out of stock', count: lowInventory.count, suffix: 'Products' });
  }
  if ((strandedInventory.count ?? 0) > 0) {
    rows.push({ label: 'Stranded inventory', count: strandedInventory.count, suffix: 'Products' });
  }
  if ((inboundShipment.count ?? 0) > 0) {
    rows.push({ label: 'Inbound shipment issues', count: inboundShipment.count, suffix: 'Products' });
  }

  if (rows.length === 0) return '';

  const rowHtml = rows
    .map((r, i) => {
      const isEven = i % 2 === 0;
      const bg = isEven ? '#ffffff' : '#f8fafc';
      const countBadge = r.count != null
        ? `<span style="display: inline-block; background-color: #eff6ff; color: #2563eb; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 600; min-width: 48px; text-align: center;">${escapeHtml(String(r.count))}</span>`
        : `<span style="font-size: 13px; color: #64748b; font-weight: 500;">${escapeHtml(r.suffix)}</span>`;
      const labelCell = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="width: 4px; background-color: #3b82f6; border-radius: 2px; padding: 0; vertical-align: middle;"></td><td style="padding-left: 14px; vertical-align: middle; font-size: 14px; color: #334155;">${escapeHtml(r.label)}</td></tr></table>`;
      return `<tr><td style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; background-color: ${bg}; width: 70%;">${labelCell}</td><td align="right" style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; background-color: ${bg}; vertical-align: middle;">${countBadge}</td></tr>`;
    })
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);"><thead><tr><td style="padding: 14px 16px; background-color: #f1f5f9; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e2e8f0;">Alert summary</td><td align="right" style="padding: 14px 16px; background-color: #f1f5f9; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e2e8f0;">Count</td></tr></thead><tbody>${rowHtml}</tbody></table>`;
}

/**
 * Send alerts email to user.
 * @param {string} email - Recipient email
 * @param {string} firstName - User first name (for greeting)
 * @param {Object} alertsPayload - { productContentChange, negativeReviews, buyBoxMissing, aplusMissing, salesDrop, lowInventory, strandedInventory, inboundShipment }
 * @param {string} [alertsDashboardUrl] - Link to alerts page
 * @param {mongoose.Types.ObjectId} [userId] - For EmailLogs
 * @param {Object} [options] - { summaryOnly: boolean } - If true, email shows one row per alert type (summary only), no full details
 * @returns {Promise<string|false>} messageId on success, false on failure
 */
async function sendAlertsEmail(email, firstName, alertsPayload, alertsDashboardUrl = DEFAULT_ALERTS_URL, userId = null, options = {}) {
  // Only send to users who are subscribed to alerts (when userId is provided we check; missing/true = send)
  if (userId) {
    const user = await User.findById(userId).select('subscribedToAlerts').lean();
    if (user && user.subscribedToAlerts === false) {
      logger.info(`[SendAlertsEmail] Skipping alerts email for user ${userId} – subscribedToAlerts is false`);
      return false;
    }
  }

  const summaryOnly = options.summaryOnly === true;
  const adminEmail = process.env.ADMIN_EMAIL_ID
    ? process.env.ADMIN_EMAIL_ID.split(',')[0].trim()
    : 'support@sellerqi.com';
  const senderEmail = process.env.SELF_MAIL_ID || adminEmail;

  const productContent = alertsPayload?.productContentChange ?? { count: 0, products: [] };
  const negativeReviews = alertsPayload?.negativeReviews ?? { count: 0, products: [] };
  const buyBoxMissing = alertsPayload?.buyBoxMissing ?? { count: 0, products: [] };
  const aplusMissing = alertsPayload?.aplusMissing ?? { count: 0, products: [] };
  const salesDrop = alertsPayload?.salesDrop ?? { count: 0, drops: [] };
  const lowInventory = alertsPayload?.lowInventory ?? { count: 0, products: [] };
  const strandedInventory = alertsPayload?.strandedInventory ?? { count: 0, products: [] };
  const inboundShipment = alertsPayload?.inboundShipment ?? { count: 0, products: [] };

  const summaryText = buildSummaryText(
    productContent.count,
    negativeReviews.count,
    buyBoxMissing.count,
    aplusMissing.count,
    salesDrop.count,
    lowInventory.count,
    strandedInventory.count,
    inboundShipment.count
  );
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  let summaryRowsSectionHtml = '';
  if (summaryOnly) {
    summaryRowsSectionHtml = buildSummaryRowsHtml(alertsPayload);
  }

  // Only include sections that have products (ProductContentChangeAlertService = content + negative reviews only, no buybox; BuyBoxMissingAlertService = buybox only, no content/reviews)
  const productContentList =
    (productContent.products?.length ?? 0) > 0
      ? buildProductListHtml(productContent.products, 'No product content changes detected.')
      : '';
  const negativeReviewsList =
    (negativeReviews.products?.length ?? 0) > 0
      ? buildProductListHtml(negativeReviews.products, 'No negative review alerts.')
      : '';
  const buyBoxMissingList =
    (buyBoxMissing.products?.length ?? 0) > 0
      ? buildProductListHtml(buyBoxMissing.products, 'No buybox missing alerts.')
      : '';
  const aplusMissingList =
    (aplusMissing.products?.length ?? 0) > 0
      ? buildProductListHtml(aplusMissing.products, 'No A+ missing alerts.')
      : '';

  // Sales drop: list of drops (date, previousDate, revenue/units drop %)
  const salesDropList =
    (salesDrop.drops?.length ?? 0) > 0
      ? (() => {
          const rows = salesDrop.drops.map((d) => {
            const rev = d.revenueDropPct != null ? `${Number(d.revenueDropPct).toFixed(1)}% revenue drop` : '';
            const units = d.unitsOrderedDropPct != null ? `${Number(d.unitsOrderedDropPct).toFixed(1)}% units drop` : '';
            const parts = [rev, units].filter(Boolean).join(', ');
            return `<tr><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 14px;">${escapeHtml(d.date)} (vs ${escapeHtml(d.previousDate)}): ${escapeHtml(parts || 'Drop detected')}</td></tr>`;
          }).join('');
          return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 8px;"><tbody>${rows}</tbody></table>`;
        })()
      : '';

  let productContentSectionHtml =
    productContentList === ''
      ? ''
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;"><tr><td style="background-color: #fef3c7; border-radius: 8px; padding: 20px; border-left: 4px solid #f59e0b;"><h2 style="font-size: 16px; font-weight: 600; color: #92400e; margin: 0 0 12px 0;">📝 Product content changes</h2><p style="font-size: 14px; color: #b45309; margin: 0 0 12px 0;">Listing content (title, description, or bullet points) has changed for the following products.</p>${productContentList}</td></tr></table>`;
  let negativeReviewsSectionHtml =
    negativeReviewsList === ''
      ? ''
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;"><tr><td style="background-color: #fee2e2; border-radius: 8px; padding: 20px; border-left: 4px solid #dc2626;"><h2 style="font-size: 16px; font-weight: 600; color: #991b1b; margin: 0 0 12px 0;">⭐ Negative reviews (rating &lt; 4)</h2><p style="font-size: 14px; color: #b91c1c; margin: 0 0 12px 0;">These products have star ratings below 4 and may need attention.</p>${negativeReviewsList}</td></tr></table>`;
  let buyBoxMissingSectionHtml =
    buyBoxMissingList === ''
      ? ''
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;"><tr><td style="background-color: #dbeafe; border-radius: 8px; padding: 20px; border-left: 4px solid #3b82f6;"><h2 style="font-size: 16px; font-weight: 600; color: #1e40af; margin: 0 0 12px 0;">🛒 Buy box missing</h2><p style="font-size: 14px; color: #1d4ed8; margin: 0 0 12px 0;">These products currently have 0% buy box share.</p>${buyBoxMissingList}</td></tr></table>`;
  let aplusMissingSectionHtml =
    aplusMissingList === ''
      ? ''
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;"><tr><td style="background-color: #ecfdf5; border-radius: 8px; padding: 20px; border-left: 4px solid #10b981;"><h2 style="font-size: 16px; font-weight: 600; color: #047857; margin: 0 0 12px 0;">📄 A+ content missing</h2><p style="font-size: 14px; color: #059669; margin: 0 0 12px 0;">These products do not have A+ content (Enhanced Brand Content) present or approved.</p>${aplusMissingList}</td></tr></table>`;

  let salesDropSectionHtml =
    salesDropList === ''
      ? ''
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;"><tr><td style="background-color: #fef2f2; border-radius: 8px; padding: 20px; border-left: 4px solid #ef4444;"><h2 style="font-size: 16px; font-weight: 600; color: #991b1b; margin: 0 0 12px 0;">📉 Sales drop detected</h2><p style="font-size: 14px; color: #b91c1c; margin: 0 0 12px 0;">Day-over-day sales velocity dropped significantly on the following date(s).</p>${salesDropList}</td></tr></table>`;

  // Inventory alerts: low inventory, stranded inventory, inbound shipment (same product list format: asin, sku?, message)
  const lowInventoryList = (lowInventory.products?.length ?? 0) > 0 ? buildProductListHtml(lowInventory.products, 'No low inventory alerts.') : '';
  const strandedInventoryList = (strandedInventory.products?.length ?? 0) > 0 ? buildProductListHtml(strandedInventory.products, 'No stranded inventory alerts.') : '';
  const inboundShipmentList = (inboundShipment.products?.length ?? 0) > 0 ? buildProductListHtml(inboundShipment.products, 'No inbound shipment alerts.') : '';
  let lowInventorySectionHtml = lowInventoryList === '' ? '' : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;"><tr><td style="background-color: #fef3c7; border-radius: 8px; padding: 20px; border-left: 4px solid #f59e0b;"><h2 style="font-size: 16px; font-weight: 600; color: #92400e; margin: 0 0 12px 0;">📦 Low inventory / out of stock</h2><p style="font-size: 14px; color: #b45309; margin: 0 0 12px 0;">These products have low or no inventory. Replenish to avoid lost sales.</p>${lowInventoryList}</td></tr></table>`;
  let strandedInventorySectionHtml = strandedInventoryList === '' ? '' : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;"><tr><td style="background-color: #fef2f2; border-radius: 8px; padding: 20px; border-left: 4px solid #ef4444;"><h2 style="font-size: 16px; font-weight: 600; color: #991b1b; margin: 0 0 12px 0;">🔒 Stranded inventory</h2><p style="font-size: 14px; color: #b91c1c; margin: 0 0 12px 0;">These products have stranded inventory and may need attention.</p>${strandedInventoryList}</td></tr></table>`;
  let inboundShipmentSectionHtml = inboundShipmentList === '' ? '' : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 24px;"><tr><td style="background-color: #f3e8ff; border-radius: 8px; padding: 20px; border-left: 4px solid #a855f7;"><h2 style="font-size: 16px; font-weight: 600; color: #6b21a8; margin: 0 0 12px 0;">🚚 Inbound shipment issues</h2><p style="font-size: 14px; color: #7c3aed; margin: 0 0 12px 0;">Inbound non-compliance or shipment issues detected for these products.</p>${inboundShipmentList}</td></tr></table>`;

  if (summaryOnly) {
    productContentSectionHtml = '';
    negativeReviewsSectionHtml = '';
    buyBoxMissingSectionHtml = '';
    aplusMissingSectionHtml = '';
    salesDropSectionHtml = '';
    lowInventorySectionHtml = '';
    strandedInventorySectionHtml = '';
    inboundShipmentSectionHtml = '';
  }

  let template = getTemplate();
  template = safeReplace(template, '{{userName}}', firstName);
  template = safeReplace(template, '{{date}}', dateStr);
  template = safeReplace(template, '{{summaryText}}', summaryText);
  template = safeReplace(template, '{{productContentChangeSection}}', productContentSectionHtml);
  template = safeReplace(template, '{{negativeReviewsSection}}', negativeReviewsSectionHtml);
  template = safeReplace(template, '{{buyBoxMissingSection}}', buyBoxMissingSectionHtml);
  template = safeReplace(template, '{{aplusMissingSection}}', aplusMissingSectionHtml);
  template = safeReplace(template, '{{salesDropSection}}', salesDropSectionHtml);
  template = safeReplace(template, '{{conversionRatesSection}}', '');
  template = safeReplace(template, '{{lowInventorySection}}', lowInventorySectionHtml);
  template = safeReplace(template, '{{strandedInventorySection}}', strandedInventorySectionHtml);
  template = safeReplace(template, '{{inboundShipmentSection}}', inboundShipmentSectionHtml);
  template = safeReplace(template, '{{summaryRowsSection}}', summaryRowsSectionHtml);
  template = safeReplace(template, '{{alertsDashboardUrl}}', alertsDashboardUrl);

  const subject = `SellerQI Alerts – ${summaryText}`;
  const emailLog = new EmailLogs({
    emailType: 'ALERTS',
    receiverEmail: email,
    receiverId: userId,
    status: 'PENDING',
    subject,
    emailContent: `Alerts summary: ${summaryText}`,
    emailProvider: 'AWS_SES',
  });

  try {
    await emailLog.save();

    if (!process.env.ADMIN_USERNAME || !process.env.APP_PASSWORD) {
      logger.error('[SendAlertsEmail] Missing ADMIN_USERNAME or APP_PASSWORD');
      await emailLog.markAsFailed('Missing email configuration');
      return false;
    }

    const transporter = nodemailer.createTransport({
      host: 'email-smtp.us-west-2.amazonaws.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.ADMIN_USERNAME,
        pass: process.env.APP_PASSWORD,
      },
    });

    const text = `Hi ${firstName},\n\n${summaryText}\n\nView all alerts: ${alertsDashboardUrl}\n\n— SellerQI Team`;

    const BCC_ALERTS = 'support@sellerqi.com';

    const info = await transporter.sendMail({
      from: senderEmail,
      to: email,
      bcc: BCC_ALERTS,
      subject,
      text,
      html: template,
    });

    await emailLog.markAsSent();
    logger.info(`[SendAlertsEmail] Alerts email sent to ${email}. Message ID: ${info.messageId}`);
    return info.messageId;
  } catch (error) {
    logger.error(`[SendAlertsEmail] Failed to send to ${email}:`, error?.message);
    await emailLog.markAsFailed(error?.message || 'Send failed');
    return false;
  }
}

module.exports = {
  sendAlertsEmail,
  buildSummaryText,
  buildProductListHtml,
};

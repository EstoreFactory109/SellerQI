const https = require('https');
const axios = require('axios');
const logger = require('../../../utils/Logger.js');

// Pin outbound to IPv4 for a stable, whitelistable source IP (avoids
// IPv6-vs-whitelist surprises with upstream firewalls).
const ipv4Agent = new https.Agent({ family: 4 });

/**
 * Meta WhatsApp Cloud API sender.
 *
 * Sends a free-form TEXT message. Allowed only inside the 24-hour customer
 * service window (i.e. after the user has messaged the business) — which is
 * exactly the QMate reply case.
 *
 * Endpoint / body confirmed against Meta's official docs:
 *   POST https://graph.facebook.com/<version>/<PHONE_NUMBER_ID>/messages
 *   Authorization: Bearer <access token>
 *   { messaging_product, recipient_type, to, type:'text', text:{ body } }
 *
 * Credentials come from env — never hardcoded:
 *   META_WHATSAPP_ACCESS_TOKEN   (System User long-lived token)
 *   META_WHATSAPP_PHONE_NUMBER_ID (the Cloud API phone number id)
 *   META_GRAPH_API_VERSION        (optional, default v21.0)
 *
 * @param {string} to    recipient in E.164 digits (e.g. "919876543210")
 * @param {string} text  message body
 * @returns {Promise<object>} Meta API response data
 */
async function sendText(to, text) {
    const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    const version = process.env.META_GRAPH_API_VERSION || 'v21.0';

    if (!token || !phoneNumberId) {
        throw new Error('META_WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID is not configured.');
    }

    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    const body = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
    };

    // Log request with the bearer token redacted.
    logger.info(`[WhatsApp][meta_cloud] POST ${url} to=${to} bytes=${(text || '').length} auth=Bearer ***redacted***`);

    try {
        const response = await axios.post(url, body, {
            httpsAgent: ipv4Agent,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        });
        logger.info(`[WhatsApp][meta_cloud] OK status=${response.status} body=${JSON.stringify(response.data)}`);
        return response.data;
    } catch (err) {
        const status = err.response ? err.response.status : 'no-response';
        const respBody = err.response ? JSON.stringify(err.response.data) : err.message;
        logger.error(`[WhatsApp][meta_cloud] send failed status=${status} body=${respBody}`);
        throw err;
    }
}

module.exports = { name: 'meta_cloud', sendText };

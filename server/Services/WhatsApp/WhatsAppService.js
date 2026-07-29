const crypto = require('crypto');
const logger = require('../../utils/Logger.js');

/**
 * WhatsAppService
 *
 * Channel-level helpers for the QMate WhatsApp integration. Responsibilities:
 *   - sendMessage:            outbound reply dispatch (provider-agnostic — see
 *                             providers/ and WHATSAPP_PROVIDER)
 *   - verifyInboundSignature: authenticate Meta -> our webhook
 *   - parseInboundMessage:    normalize the inbound webhook JSON
 *   - flattenMarkdown:        collapse QMate's Markdown answer to WhatsApp text
 *
 * This service is standalone and additive — nothing outside the WhatsApp
 * channel imports it. Provider-specific send logic lives in ./providers/*.
 */

// WhatsApp hard limit for a text message body.
const WHATSAPP_MAX_LEN = 4000;

/**
 * Normalize a phone number to a bare E.164-style digit string (no '+', spaces
 * or punctuation), e.g. "+91 98765-43210" -> "919876543210". Returns '' for
 * empty/invalid input.
 */
function normalizeNumber(raw) {
    if (!raw) return '';
    return String(raw).replace(/[^\d]/g, '');
}

/**
 * Convert QMate Markdown to plain text that reads well on WhatsApp.
 * WhatsApp supports *bold*, _italic_, ~strike~, and ```mono``` but not Markdown
 * headings/tables/links. We keep bullets and bold emphasis, drop the rest.
 */
function flattenMarkdown(md) {
    if (!md || typeof md !== 'string') return '';
    let text = md;

    // Fenced code blocks -> keep content, WhatsApp renders ``` fine, leave as-is.
    // Headings (#, ##, ...) -> bold line.
    text = text.replace(/^#{1,6}\s*(.+)$/gm, '*$1*');
    // Markdown bold **x** / __x__ -> WhatsApp bold *x*
    text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
    text = text.replace(/__(.+?)__/g, '*$1*');
    // Markdown links [label](url) -> "label (url)"
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
    // Table separator rows (|---|---|) -> drop
    text = text.replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, '');
    // Collapse table pipes to " · "
    text = text.replace(/^\s*\|(.+)\|\s*$/gm, (m, row) =>
        row.split('|').map((c) => c.trim()).filter(Boolean).join(' · ')
    );
    // Normalize list markers to a bullet
    text = text.replace(/^\s*[-*+]\s+/gm, '• ');
    // Trim excess blank lines
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return text;
}

/**
 * Split a long message into WhatsApp-sized chunks, preferring to break on
 * paragraph then line boundaries.
 */
function chunkText(text, maxLen = WHATSAPP_MAX_LEN) {
    if (!text) return [];
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLen) {
        let slice = remaining.slice(0, maxLen);
        const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'));
        if (lastBreak > maxLen * 0.5) {
            slice = remaining.slice(0, lastBreak);
        }
        chunks.push(slice.trim());
        remaining = remaining.slice(slice.length).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

/**
 * Verify an inbound Meta WhatsApp Cloud API webhook. Meta signs the POST body
 * with HMAC-SHA256 using the app's App Secret and sends it in the
 * `X-Hub-Signature-256` header as `sha256=<hex>`. We recompute the HMAC over the
 * raw body and timing-safe compare. Fails closed (returns false) if the App
 * Secret or the header is missing, or on any mismatch.
 *
 * @param {Buffer|string} rawBody          the exact raw request body
 * @param {string} signatureHeader         value of the X-Hub-Signature-256 header
 */
function verifyInboundSignature(rawBody, signatureHeader) {
    try {
        const secret = process.env.META_APP_SECRET;
        if (!secret || !signatureHeader) return false;
        // Header is "sha256=<hex>" — strip the prefix if present.
        const provided = String(signatureHeader).startsWith('sha256=')
            ? String(signatureHeader).slice('sha256='.length)
            : String(signatureHeader);
        const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
        const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        const a = Buffer.from(expected, 'utf8');
        const b = Buffer.from(provided, 'utf8');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch (error) {
        logger.error('[WhatsApp] Error verifying inbound signature:', error);
        return false;
    }
}

/**
 * Normalize a Meta WhatsApp Cloud API inbound webhook into { from, text, messageId }.
 * Cloud API delivers user messages as:
 *   { entry: [ { changes: [ { value: { messages: [ { from, text:{body}, id, type } ],
 *                                       contacts: [ { wa_id } ] } } ] } ] }
 * Returns null when there is no usable user text message — e.g. `statuses[]`
 * delivery/read callbacks or non-text message types — so the caller ignores them.
 */
function parseInboundMessage(payload) {
    if (!payload || typeof payload !== 'object') return null;

    const value =
        payload?.entry?.[0]?.changes?.[0]?.value ||
        payload?.changes?.[0]?.value ||
        payload?.value ||
        null;

    if (!value || !Array.isArray(value.messages) || value.messages.length === 0) {
        // No inbound message (status callback, verification echo, etc.) -> ignore.
        return null;
    }

    const m = value.messages[0];
    // Text, plus interactive button/list replies (title is the user's choice).
    const text =
        (typeof m.text === 'string' ? m.text : null) ||
        m?.text?.body ||
        m?.button?.text ||
        m?.interactive?.list_reply?.title ||
        m?.interactive?.button_reply?.title ||
        '';
    const from = normalizeNumber(m.from || value?.contacts?.[0]?.wa_id);

    if (!from || !text || !String(text).trim()) return null;
    return { from, text: String(text).trim(), messageId: m.id || null };
}

// --- Outbound provider dispatch -------------------------------------------
// Outbound sends go through a provider implementing sendText(to, text) -> data.
// Meta WhatsApp Cloud API is the provider. WHATSAPP_PROVIDER is retained as a
// hook for future providers but currently only 'meta_cloud' is supported.
const metaSender = require('./providers/metaSender.js');

function resolveProvider() {
    const p = (process.env.WHATSAPP_PROVIDER || 'meta_cloud').toLowerCase();
    switch (p) {
        case 'meta_cloud':
        default:
            return { key: 'meta_cloud', sendText: (to, text) => metaSender.sendText(to, text) };
    }
}

/**
 * Send one or more WhatsApp text messages to `toNumber`, via the active
 * provider (WHATSAPP_PROVIDER). Long text is split into WhatsApp-sized chunks
 * and sent sequentially. Errors are logged (with the provider's response body)
 * and rethrown; the caller acks the webhook regardless.
 *
 * Interface is provider-agnostic: (recipientNumber, messageText).
 */
async function sendMessage(toNumber, text) {
    const to = normalizeNumber(toNumber);
    if (!to) {
        throw new Error('WhatsApp recipient number is missing.');
    }
    const provider = resolveProvider();
    const chunks = chunkText(text || '');
    const results = [];
    for (const chunk of chunks) {
        const data = await provider.sendText(to, chunk);
        results.push(data);
    }
    return results;
}

module.exports = {
    sendMessage,
    verifyInboundSignature,
    parseInboundMessage,
    flattenMarkdown,
    chunkText,
    normalizeNumber,
};

/**
 * mimeBuilder.js — an RFC 822 message, built by hand.
 *
 * Pure functions with their own tests, because hand-rolled MIME is exactly where this
 * breaks and the failures are quiet: a header that should have been encoded arrives as
 * mojibake in the client's mail app, a missing In-Reply-To silently starts a second
 * conversation, and a body with a bare newline is accepted by Gmail and mangled by
 * someone's Exchange server.
 *
 * ── THREADING NEEDS BOTH MECHANISMS, NOT EITHER ──
 * `threadId` on the API call is Gmail-INTERNAL: it keeps the message in the right
 * conversation in our own mailbox and means nothing to anyone else. `In-Reply-To` and
 * `References` are what the CLIENT's mail app threads on. Send with only the first and
 * the conversation looks right to us and fragments into separate emails for them —
 * which reads as their mail client misbehaving, so it gets reported late if at all.
 */

const crypto = require('crypto');

const CRLF = '\r\n';

/** A header value is safe as-is only if it is plain ASCII. */
const needsEncoding = (value) => /[^\x20-\x7E]/.test(String(value || ''));

/**
 * RFC 2047 encode a header value when it contains anything non-ASCII.
 *
 * Base64 rather than quoted-printable: the values here are subjects and display names,
 * where accented characters cluster, and QP would escape most of the string anyway.
 */
const encodeHeaderValue = (value) => {
    const text = String(value || '');
    if (!needsEncoding(text)) return text;
    return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
};

/**
 * Strip CR and LF from a header value.
 *
 * HEADER INJECTION GUARD. A subject or display name that reaches us with a newline in
 * it would otherwise terminate the header and let the rest be read as more headers —
 * an attacker-supplied `Bcc:` line, for instance. Both of these come from stored data
 * that originated in an email we received, so this is untrusted input.
 */
const sanitizeHeader = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();

/**
 * `Name <address>`, with the display name encoded if needed and always quoted.
 *
 * Quoting matters: an unquoted `Kumar, Nitesh` makes the comma a recipient separator,
 * and the message goes to a second address that does not exist.
 */
const formatAddress = ({ name, email }) => {
    const address = sanitizeHeader(email);
    if (!name) return address;
    const display = encodeHeaderValue(sanitizeHeader(name));
    return `"${display.replace(/"/g, '')}" <${address}>`;
};

/**
 * A Message-ID we generate ourselves, BEFORE sending.
 *
 * Pre-generating is what lets the ingest path recognise our own message when Gmail
 * hands it back through the watch. Relying on the id Gmail assigns loses a race: the
 * push notification can arrive before our own write has landed, and the message is then
 * ingested as though it were new, duplicating every reply.
 */
const generateMessageId = (domain) => {
    const host = String(domain || 'sellerqi.com').replace(/[^\w.-]/g, '') || 'sellerqi.com';
    return `<${crypto.randomUUID()}@${host}>`;
};

/**
 * Gmail rejects a threaded send whose subject does not match the thread's.
 *
 * An empty subject therefore has to stay empty. Substituting a friendly placeholder
 * would produce "Re: (no subject)" against a thread whose subject is genuinely blank,
 * and Gmail refuses the send — so a client who emails in without a subject could never
 * be replied to. Real clients do this constantly.
 */
const replySubject = (rawSubject) => {
    const subject = sanitizeHeader(rawSubject);
    if (!subject) return '';
    return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
};

/**
 * The subject for a message that STARTS a conversation.
 *
 * Kept separate from replySubject because prefixing "Re:" onto a brand-new ticket is
 * not cosmetic — it tells the recipient's mail client this is a response to something
 * they sent, so it reads as a reply nobody wrote and threads oddly in some clients.
 */
const newSubject = (rawSubject) => sanitizeHeader(rawSubject) || '(no subject)';

/**
 * `References` accumulates the whole chain, and some clients never trim it.
 *
 * Capped at the RFC-suggested shape: keep the first (the conversation root, which is
 * what most clients actually thread on) and the most recent few. An unbounded header
 * eventually exceeds line-length limits and gets mangled in transit.
 */
const buildReferences = (existing = [], inReplyTo = null) => {
    const all = [...existing, inReplyTo].filter(Boolean);
    const unique = [...new Set(all)];
    if (unique.length <= 10) return unique;
    return [unique[0], ...unique.slice(-9)];
};

/**
 * A boundary that cannot collide with the content it separates.
 *
 * If a boundary string appears anywhere inside a part, the receiving parser truncates
 * the message there — the body ends mid-sentence, or an attachment arrives corrupt,
 * with nothing to indicate why. Random and long enough that it will not.
 *
 * 12 bytes rather than 16: 96 bits is still far beyond any chance of colliding with
 * content, and it keeps the Content-Type header inside the 78-character line length
 * RFC 5322 recommends. Longer is legal but gets folded by some agents, and a folded
 * boundary parameter is read wrongly by a stubborn minority of clients.
 */
const generateBoundary = () => `----=_SQI_${crypto.randomBytes(12).toString('hex')}`;

/**
 * A filename as it appears in Content-Disposition.
 *
 * Quotes are stripped rather than escaped: a quote inside a quoted-string parameter
 * ends it early, and everything after would be read as another parameter.
 */
const formatFilename = (name) => {
    const clean = sanitizeHeader(name).replace(/["\\]/g, '').slice(0, 200) || 'attachment';
    return needsEncoding(clean) ? encodeHeaderValue(clean) : clean;
};

/** One attachment as a MIME part. `content` is a Buffer. */
const attachmentPart = (file, boundary) => {
    const filename = formatFilename(file.filename);
    const mimeType = sanitizeHeader(file.mimeType) || 'application/octet-stream';

    return [
        `--${boundary}`,
        `Content-Type: ${mimeType}; name="${filename}"`,
        `Content-Disposition: attachment; filename="${filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        // Wrapped at 76, same RFC 2045 rule as the body — and far more likely to bite
        // here, because an attachment is megabytes of base64 rather than a few lines.
        file.content.toString('base64').replace(/(.{76})/g, `$1${CRLF}`),
    ].join(CRLF);
};

/**
 * Build a complete RFC 822 message, base64url encoded for the Gmail API.
 *
 * @param {object} options
 * @param {object} options.from           `{ name, email }`
 * @param {object} options.to             `{ name, email }`
 * @param {string} options.rawSubject     the thread's stored subject, not the display one
 * @param {string} options.bodyText
 * @param {string} [options.inReplyTo]    the Message-ID being replied to
 * @param {string[]} [options.references]
 * @param {string} [options.messageId]    ours, pre-generated
 * @param {string} [options.origin]       stamped as X-SellerQI-Origin
 * @param {Date}   [options.date]
 * @returns {{ raw: string, messageId: string, headers: object }}
 */
const buildMimeMessage = ({
    from,
    to,
    rawSubject,
    bodyText,
    inReplyTo = null,
    references = [],
    messageId = null,
    origin = null,
    date = new Date(),
    // true when this message opens a conversation rather than continuing one.
    isNewThread = false,
    /** `[{ filename, mimeType, content: Buffer }]`. Omitted or empty keeps the message text-only. */
    attachments = [],
    /**
     * Where a human hitting "Reply" should end up.
     *
     * Load-bearing for portal messages. Gmail only lets us send AS an address we own,
     * so a client's portal message has to go out `From: <our inbox>` — which would send
     * the admin's reply straight back to ourselves, into a loop, with the client never
     * hearing anything. Reply-To is what redirects it to the person who actually wrote.
     */
    replyTo = null,
}) => {
    const ownMessageId = messageId || generateMessageId(String(from?.email || '').split('@')[1]);
    const referenceChain = buildReferences(references, inReplyTo);

    const headers = {
        'MIME-Version': '1.0',
        Date: date.toUTCString(),
        'Message-ID': ownMessageId,
        From: formatAddress(from),
        To: formatAddress(to),
        ...(replyTo ? { 'Reply-To': formatAddress(replyTo) } : {}),
        Subject: encodeHeaderValue(isNewThread ? newSubject(rawSubject) : replySubject(rawSubject)),
        ...(inReplyTo ? { 'In-Reply-To': sanitizeHeader(inReplyTo) } : {}),
        ...(referenceChain.length ? { References: referenceChain.map(sanitizeHeader).join(' ') } : {}),
        // The first of the two echo guards. Both portal paths write into Gmail and both
        // come back through the watch looking like new mail; without this every portal
        // message would appear twice.
        ...(origin ? { 'X-SellerQI-Origin': sanitizeHeader(origin) } : {}),
    };

    const files = (attachments || []).filter((file) => file && file.content);

    // Wrapped at 76 characters: RFC 2045 requires base64 lines not exceed 76, and a
    // single long line is rejected outright by some servers.
    const encodedText = Buffer.from(String(bodyText || ''), 'utf8')
        .toString('base64')
        .replace(/(.{76})/g, `$1${CRLF}`);

    let body;
    if (files.length === 0) {
        // base64 rather than 8bit: the body is arbitrary user text and may contain
        // anything, and some relays still mangle raw 8-bit content.
        headers['Content-Type'] = 'text/plain; charset="UTF-8"';
        headers['Content-Transfer-Encoding'] = 'base64';
        body = encodedText;
    } else {
        /**
         * multipart/mixed: the message text as the first part, then one part per file.
         *
         * The transfer-encoding header belongs to each PART, never to the multipart
         * container — a Content-Transfer-Encoding on the container tells the parser the
         * boundaries themselves are base64, and the whole message is discarded as
         * malformed.
         */
        const boundary = generateBoundary();
        headers['Content-Type'] = `multipart/mixed; boundary="${boundary}"`;

        body = [
            `--${boundary}`,
            'Content-Type: text/plain; charset="UTF-8"',
            'Content-Transfer-Encoding: base64',
            '',
            encodedText,
            ...files.map((file) => attachmentPart(file, boundary)),
            // The closing boundary needs its trailing "--". Without it the message is
            // unterminated and some clients drop the final attachment.
            `--${boundary}--`,
        ].join(CRLF);
    }

    const headerBlock = Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join(CRLF);

    const message = `${headerBlock}${CRLF}${CRLF}${body}`;

    return {
        // base64url, per the Gmail API — standard base64 is rejected.
        raw: Buffer.from(message, 'utf8').toString('base64url'),
        messageId: ownMessageId,
        headers,
    };
};

module.exports = {
    buildMimeMessage,
    generateMessageId,
    replySubject,
    newSubject,
    generateBoundary,
    formatFilename,
    buildReferences,
    formatAddress,
    encodeHeaderValue,
    sanitizeHeader,
    needsEncoding,
};

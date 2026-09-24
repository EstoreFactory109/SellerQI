/**
 * gmailMessageParser.js — Gmail's message payload into the fields we store.
 *
 * Pure functions, no I/O, because this is where the bugs will be. Gmail's payload is a
 * recursive tree whose shape depends on what the sender's mail client happened to
 * produce, and every real-world variation has to be handled without a live mailbox to
 * test against.
 *
 * ── DECODE THE SUBJECT BEFORE ANYTHING ELSE TOUCHES IT ──
 * A subject arrives as `=?UTF-8?B?Tml0ZXNoIEt1bWFyIC0gaW52b2ljZQ==?=` when it contains
 * anything non-ASCII. Left encoded, it sails through redaction untouched — a base64 blob
 * matches no name and no phone pattern — and then decodes back to the client's name in
 * the browser, on the page whose entire purpose is that staff never see it. The
 * redaction pipeline cannot protect what it cannot read.
 */

const HEADERS_OF_INTEREST = new Set([
    'from', 'to', 'cc', 'subject', 'date', 'message-id', 'in-reply-to', 'references',
    'authentication-results', 'x-sellerqi-origin', 'content-type',
]);

/** Gmail encodes every body and attachment as base64url. */
const decodeBase64Url = (data) => {
    if (!data || typeof data !== 'string') return '';
    try {
        return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    } catch (_) {
        return '';
    }
};

/**
 * Decode RFC 2047 encoded words in a header value.
 *
 * Handles both encodings (?B? base64, ?Q? quoted-printable) and the adjacent-word rule:
 * whitespace BETWEEN two encoded words is a separator artefact and must be dropped, or a
 * name split across words comes back as "Nitesh  Kumar" with a phantom gap. Whitespace
 * around a non-encoded neighbour is real and must be kept.
 */
const decodeMimeWords = (value) => {
    if (typeof value !== 'string' || !value.includes('=?')) return value || '';

    /**
     * Collapse the separator between adjacent encoded words FIRST, while the `?=  =?`
     * markers still exist. Doing it after decoding is too late — the markers are gone
     * and the real spaces are indistinguishable from the artefact, so a name wrapped
     * across two words keeps a phantom double gap.
     */
    const decoded = value.replace(/\?=\s+=\?/g, '?==?').replace(
        /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
        (match, charset, encoding, text) => {
            try {
                if (encoding.toUpperCase() === 'B') {
                    // Node's base64 decoder does not throw on invalid input — it
                    // silently returns mojibake — so the alphabet is checked here.
                    // Without this, a malformed word becomes garbage bytes in a subject
                    // rather than being left visibly alone.
                    if (!/^[A-Za-z0-9+/\-_]*={0,2}$/.test(text)) return match;
                    return Buffer.from(text, 'base64').toString(normaliseCharset(charset));
                }
                // Q encoding: '_' is a space, =XX is a byte.
                const bytes = text
                    .replace(/_/g, ' ')
                    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
                return Buffer.from(bytes, 'binary').toString(normaliseCharset(charset));
            } catch (_) {
                // A malformed word is left as-is rather than dropped: dropping it would
                // silently delete part of a subject line.
                return match;
            }
        }
    );

    return decoded.trim();
};

/** Node knows utf8/latin1/ascii; anything else is best-effort utf8. */
const normaliseCharset = (charset) => {
    const lower = String(charset || '').toLowerCase();
    if (lower === 'utf-8' || lower === 'utf8') return 'utf8';
    if (lower === 'iso-8859-1' || lower === 'latin1' || lower === 'windows-1252') return 'latin1';
    if (lower === 'us-ascii' || lower === 'ascii') return 'ascii';
    return 'utf8';
};

/** Headers as a lowercase-keyed map, keeping only what we use. */
const headerMap = (payload) => {
    const map = {};
    (payload?.headers || []).forEach((header) => {
        const name = String(header?.name || '').toLowerCase();
        if (!HEADERS_OF_INTEREST.has(name)) return;
        // References can legitimately repeat; everything else takes the first.
        if (map[name] === undefined) map[name] = header.value;
        else map[name] += ` ${header.value}`;
    });
    return map;
};

/** `"Nitesh Kumar" <a@b.com>, c@d.com` → ['a@b.com', 'c@d.com'], lowercased. */
const parseAddressList = (value) => {
    if (typeof value !== 'string' || !value) return [];
    return value
        // Split on commas that are not inside a quoted display name.
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map((entry) => {
            const angled = entry.match(/<([^>]+)>/);
            return (angled ? angled[1] : entry).trim().toLowerCase();
        })
        .filter((address) => address.includes('@'));
};

const firstAddress = (value) => parseAddressList(value)[0] || '';

/**
 * Walk the part tree collecting body candidates and attachments.
 *
 * Gmail nests parts arbitrarily deep — multipart/mixed wrapping multipart/alternative
 * wrapping the two body variants is ordinary — so this recurses rather than assuming a
 * shape.
 */
const walkParts = (part, collected = { bodies: [], attachments: [] }) => {
    if (!part) return collected;

    const mimeType = String(part.mimeType || '').toLowerCase();
    const filename = part.filename || '';

    /**
     * A part with a filename is an attachment even when its MIME type is text/plain,
     * and an inline image has a filename too. Checked before the body branch so a
     * `.txt` attachment is never mistaken for the message body — which would put the
     * attachment's contents on the page as though the client had typed them.
     */
    if (filename && part.body?.attachmentId) {
        collected.attachments.push({
            attachmentId: part.body.attachmentId,
            filename,
            mimeType: part.mimeType || 'application/octet-stream',
            size: Number(part.body.size) || 0,
        });
    } else if (mimeType === 'text/html' || mimeType === 'text/plain') {
        const content = decodeBase64Url(part.body?.data);
        if (content) collected.bodies.push({ mimeType, content });
    }

    (part.parts || []).forEach((child) => walkParts(child, collected));
    return collected;
};

/**
 * Choose ONE canonical body.
 *
 * HTML preferred, because a sender's plain-text alternative is frequently a degraded
 * auto-generated version missing links and structure. One is stored, never both: keeping
 * both means one gets redacted and the other does not, and the unredacted copy is
 * exactly the thing that must not exist.
 */
const pickBody = (bodies) => {
    const html = bodies.find((body) => body.mimeType === 'text/html');
    if (html) return { html: html.content, text: null };
    const plain = bodies.find((body) => body.mimeType === 'text/plain');
    if (plain) return { html: null, text: plain.content };
    return { html: null, text: null };
};

/**
 * `sentAt` from the Date header, falling back to Gmail's internalDate.
 *
 * The header is what the sender claims and can be wrong or absent; internalDate is when
 * Gmail actually handled it. Preferring the header keeps the conversation in the order
 * the participants experienced, and the fallback means a missing or unparseable header
 * never produces an Invalid Date that sorts a message to the epoch.
 */
const parseSentAt = (headers, internalDate) => {
    const headerDate = headers.date ? Date.parse(headers.date) : NaN;
    if (!Number.isNaN(headerDate)) return new Date(headerDate);

    const internal = Number(internalDate);
    if (Number.isFinite(internal) && internal > 0) return new Date(internal);

    return null;
};

/** Strip accumulated "Re:"/"Fwd:" for display, keeping the raw form for threaded sends. */
const tidySubject = (subject) => String(subject || '')
    .replace(/^(\s*(re|fwd|fw|aw|sv|vs)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .trim();

/**
 * Parse one Gmail message resource (format=full).
 *
 * @returns {object} flat fields — never the payload tree, so callers cannot accidentally
 *   reach past what has been decoded and vetted here.
 */
const parseMessage = (message = {}) => {
    const payload = message.payload || {};
    const headers = headerMap(payload);
    const { bodies, attachments } = walkParts(payload);
    const body = pickBody(bodies);

    // Decoded HERE, before anything downstream can store or show it. See the file header.
    const rawSubject = decodeMimeWords(headers.subject || '');

    return {
        gmailMessageId: message.id || null,
        gmailThreadId: message.threadId || null,
        labelIds: message.labelIds || [],

        fromEmail: firstAddress(headers.from),
        toEmails: parseAddressList(headers.to),
        ccEmails: parseAddressList(headers.cc),

        rawSubject,
        displaySubject: tidySubject(rawSubject),

        sentAt: parseSentAt(headers, message.internalDate),

        // RFC threading. Both are needed for a reply to land in the CLIENT's mail app as
        // part of the conversation — threadId alone is Gmail-internal and means nothing
        // to Outlook.
        rfc822MessageId: headers['message-id'] || null,
        inReplyTo: headers['in-reply-to'] || null,
        references: String(headers.references || '').split(/\s+/).filter(Boolean),

        authenticationResults: headers['authentication-results'] || null,
        originHeader: headers['x-sellerqi-origin'] || null,

        bodyHtml: body.html,
        bodyText: body.text,
        attachments,

        // Gmail's own one-line preview. Useful only for diagnostics — it is NOT redacted
        // and must never reach a page.
        snippet: message.snippet || null,
    };
};

module.exports = {
    parseMessage,
    decodeMimeWords,
    decodeBase64Url,
    parseAddressList,
    firstAddress,
    tidySubject,
    pickBody,
    walkParts,
    parseSentAt,
    headerMap,
};

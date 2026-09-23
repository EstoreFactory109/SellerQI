/**
 * emailRichText.js — turn a received email body into plain text safe to redact.
 *
 * A sibling of Services/Zoho/zohoRichText.js rather than an extension of it. That one
 * converts HTML produced by a single known editor; this one faces every mail client
 * ever written, and the two have different failure modes. Keeping them apart means
 * hardening this cannot destabilise the shipped Zoho summaries.
 *
 * THIS RUNS BEFORE REDACTION, AND THAT ORDER IS LOAD-BEARING.
 * A redactor pointed at raw HTML can never match an identity fragmented across tags
 * (`Nit<b>esh</b>`) or entity-encoded (`&#78;itesh`). Everything here exists to get
 * the text into one flat, decoded, normalised form so the redactor sees what a human
 * would see.
 *
 * Three concrete leaks in the Zoho converter, verified against it before this file was
 * written, are fixed here:
 *
 *   toPlainText('<p>Hi</p><!-- a > nitesh@example.com -->')
 *       -> 'Hi\n nitesh@example.com -->'      the address survives as visible text
 *   toPlainText('<head><title>Invoice for Nitesh Kumar</title></head><body>Hi</body>')
 *       -> 'Invoice for Nitesh KumarHi'       the name survives
 *   toPlainText('<td>Nitesh</td><td>Kumar</td>')
 *       -> 'NiteshKumar'                      no separator, so the full name never matches
 *
 * The first is the dangerous one: Outlook emits conditional comments
 * (`<!--[if gte mso 9]>...<![endif]-->`) around signature blocks as a matter of course,
 * and those routinely contain `>`.
 */

/** Elements whose content is markup or metadata, never body text. */
const DROPPED_ELEMENTS = /<(script|style|head|title|noscript)[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * HTML comments, stripped BEFORE any tag regex runs.
 *
 * `/<[^>]+>/` cannot do this: on `<!-- a > x@y.com -->` it matches from `<!--` to the
 * FIRST `>`, deletes `<!-- a >`, and leaves ` x@y.com -->` behind as visible text.
 * Non-greedy `[\s\S]*?` to the real terminator is the only correct form.
 */
const HTML_COMMENTS = /<!--[\s\S]*?-->/g;

/** Tags after which a line break belongs. */
const BLOCK_END = /<\/(p|div|h[1-6]|li|tr|blockquote|table|section|article|header|footer)\s*>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const LIST_ITEM = /<li[^>]*>/gi;

/**
 * Cell boundaries become a space, not nothing.
 *
 * Signatures are overwhelmingly laid out in tables, so `<td>Nitesh</td><td>Kumar</td>`
 * is the normal way a full name arrives. Concatenating to "NiteshKumar" means the
 * full-name redaction never fires and only the parts do — and a two-part match is
 * exactly what the redactor is weakest at.
 */
const CELL_BOUNDARY = /<\/(td|th)\s*>/gi;

const ENTITIES = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'", '&apos;': "'", '&hellip;': '…',
    '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘',
    '&rdquo;': '”', '&ldquo;': '“', '&middot;': '·', '&bull;': '•',
};

/** Zero-width and bidi characters. Pasting from Word scatters these through text. */
const INVISIBLE = /[​-‍⁠﻿‪-‮⁦-⁩]/g;

/**
 * Markers that begin a quoted reply chain.
 *
 * Everything from the first match onward is another message — usually with its own
 * signature and its own `From:` line, and frequently naming third parties we hold no
 * identifiers for and therefore cannot redact deterministically. Cutting the chain
 * removes that entire surface for free, which is why it happens before redaction
 * rather than being left for the model to handle.
 */
const QUOTE_MARKERS = [
    // "On Mon, 22 Sep 2026 at 14:03, Someone <a@b.com> wrote:" — with or without the
    // newline mail clients insert before "wrote:".
    /^\s*On .{0,200}?\bwrote:\s*$/im,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
    /^\s*_{10,}\s*$/m,
    // Outlook's block header.
    /^\s*From:\s.+$\n^\s*Sent:\s.+$/im,
    /^\s*Sent from my \w+/im,
];

/** Strip an HTML quoted chain before tags are removed, while the structure is intact. */
const HTML_QUOTE_CONTAINERS = [
    /<blockquote[\s\S]*$/i,
    /<div[^>]*class="[^"]*gmail_quote[^"]*"[\s\S]*$/i,
    /<div[^>]*id="(?:divRplyFwdMsg|appendonsend)"[\s\S]*$/i,
];

const decodeEntities = (text) => {
    let out = text;
    for (const [entity, char] of Object.entries(ENTITIES)) {
        out = out.split(entity).join(char);
    }
    // Numeric, decimal and hex. Bounded to valid code points so a malformed entity
    // cannot throw.
    out = out.replace(/&#(\d+);/g, (_, code) => {
        const n = Number(code);
        return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : '';
    });
    out = out.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        const n = parseInt(hex, 16);
        return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : '';
    });
    return out;
};

/**
 * Cut the quoted reply chain, keeping only the newest message.
 *
 * @param {string} value  HTML or plain text
 * @param {boolean} isHtml
 * @returns {{ text: string, trimmed: boolean }}
 */
const stripQuotedChain = (value, isHtml = false) => {
    if (!value) return { text: '', trimmed: false };

    let out = value;
    let trimmed = false;

    if (isHtml) {
        for (const pattern of HTML_QUOTE_CONTAINERS) {
            const next = out.replace(pattern, '');
            if (next !== out) { out = next; trimmed = true; }
        }
        return { text: out, trimmed };
    }

    // Plain text: cut at the EARLIEST marker, since a chain can carry several.
    let cutAt = -1;
    for (const marker of QUOTE_MARKERS) {
        const found = out.match(marker);
        if (found && found.index !== undefined && (cutAt === -1 || found.index < cutAt)) {
            cutAt = found.index;
        }
    }
    if (cutAt >= 0) { out = out.slice(0, cutAt); trimmed = true; }

    // Runs of ">" quoted lines, which some clients use without any header line.
    const lines = out.split('\n');
    const firstQuoted = lines.findIndex((l) => /^\s*>/.test(l));
    if (firstQuoted >= 0) {
        const rest = lines.slice(firstQuoted);
        if (rest.filter((l) => /^\s*>/.test(l)).length >= rest.length / 2) {
            out = lines.slice(0, firstQuoted).join('\n');
            trimmed = true;
        }
    }

    return { text: out, trimmed };
};

/**
 * HTML (or plain text) -> flat text, decoded and normalised.
 *
 * @param {string} value
 * @param {object} [options]
 * @param {boolean} [options.isHtml]  treat as HTML; plain text skips tag handling
 */
const toPlainText = (value, { isHtml = true } = {}) => {
    if (!value || typeof value !== 'string') return '';

    let text = value;

    if (isHtml) {
        // Order matters throughout this block.
        text = text
            .replace(HTML_COMMENTS, ' ')      // before any tag regex — see the header
            .replace(DROPPED_ELEMENTS, ' ')   // head/title/script/style content is not body
            .replace(LINE_BREAK, '\n')
            .replace(LIST_ITEM, '\n• ')
            .replace(CELL_BOUNDARY, ' ')
            .replace(BLOCK_END, '\n')
            .replace(/<[^>]+>/g, '');         // whatever tags remain
    }

    text = decodeEntities(text);

    return text
        // NFKC folds full-width and compatibility forms so a name written in them
        // still matches the plain one during redaction.
        .normalize('NFKC')
        .replace(INVISIBLE, '')
        // Non-breaking spaces read as spaces; left alone, "Nitesh Kumar" never
        // matches "Nitesh Kumar".
        .replace(/ /g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
};

/**
 * The full pre-redaction pass: cut the quoted chain, then flatten.
 *
 * @returns {{ text: string, quotedTrimmed: boolean }}
 */
const prepareBody = (value, { isHtml = true } = {}) => {
    const { text: unquoted, trimmed } = stripQuotedChain(value, isHtml);
    return { text: toPlainText(unquoted, { isHtml }), quotedTrimmed: trimmed };
};

/** A single-line label (subject lines) — same treatment, collapsed to one line. */
const toPlainLabel = (value, { isHtml = false } = {}) => {
    if (!value || typeof value !== 'string') return null;
    return toPlainText(value, { isHtml }).replace(/\s+/g, ' ').trim() || null;
};

module.exports = {
    toPlainText,
    toPlainLabel,
    stripQuotedChain,
    prepareBody,
};

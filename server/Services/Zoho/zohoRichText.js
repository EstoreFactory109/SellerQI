/**
 * zohoRichText.js — turn Zoho's rich-text comment bodies into plain text.
 *
 * Zoho returns task comments as HTML carrying its own inline styling (black
 * text on white, fixed rem sizes) plus mention markup of the form
 * `zp[@zpuser#853195505#Henil Modi]zp`.
 *
 * This runs at SYNC time, not render time, on purpose: the converted text is
 * what gets stored, so third-party HTML never reaches a browser at all. That
 * removes the XSS surface entirely rather than relying on a sanitiser, and it
 * stops Zoho's white-background inline styles from landing in a dark UI.
 *
 * Deliberately not a general HTML parser — these are short comment bodies from
 * one known producer, and pulling in a parser dependency for that would be
 * more surface than the job needs.
 */

/** `zp[@zpuser#<id>#<Display Name>]zp` -> `@Display Name` */
const MENTION = /zp\[@zpuser#[^#\]]*#([^\]]*)\]zp/g;

/**
 * Tags that end a line of text rather than sitting inside one.
 * `li` is deliberately absent: LIST_ITEM below already breaks the line on the
 * OPENING tag, so closing it too would put a blank line between every bullet.
 */
const BLOCK_END = /<\/(p|div|tr|h[1-6]|blockquote)\s*>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const LIST_ITEM = /<li[^>]*>/gi;

const ENTITIES = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'", '&apos;': "'", '&hellip;': '…',
    '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘',
    '&rdquo;': '”', '&ldquo;': '“',
};

/**
 * @param {string} html Zoho comment body
 * @returns {string} plain text with paragraph breaks preserved
 */
const toPlainText = (html) => {
    if (!html || typeof html !== 'string') return '';

    let text = html
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(MENTION, '@$1')
        .replace(LINE_BREAK, '\n')
        .replace(LIST_ITEM, '\n• ')
        .replace(BLOCK_END, '\n')
        .replace(/<[^>]+>/g, '');

    // Named entities first, then any numeric ones Zoho happens to emit.
    for (const [entity, char] of Object.entries(ENTITIES)) {
        text = text.split(entity).join(char);
    }
    text = text.replace(/&#(\d+);/g, (_, code) => {
        const n = Number(code);
        return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : '';
    });

    return text
        // Zoho's nested divs produce long runs of blank lines; keep at most one.
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
};

/**
 * A single-line label: entities decoded, whitespace collapsed, no markup.
 *
 * Task and tasklist NAMES need this as much as comment bodies do, and used not to get
 * it. Zoho stores them HTML-escaped, so a task really called "Morgan's Repellent For
 * Mice & Rats" reached the client's page as "... Mice &amp; Rats", and names carrying
 * a stray newline broke the row layout.
 */
const toPlainLabel = (value) => {
    if (!value || typeof value !== 'string') return value || null;
    return toPlainText(value).replace(/\s+/g, ' ').trim() || null;
};

/** First line, clipped — used for list previews. */
const toSummary = (html, max = 160) => {
    const text = toPlainText(html).split('\n').find((line) => line.trim()) || '';
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

module.exports = { toPlainText, toPlainLabel, toSummary };

/**
 * quoteSplitter.js — separate what a client just wrote from the history they quoted,
 * and recover the answers they typed INSIDE that history.
 *
 * A sibling of emailRichText.js, which cuts the quoted chain and throws it away. That is
 * right for storage and wrong for one very common case: a client answering questions by
 * typing under each one inside the quote, which is what Apple Mail and Outlook encourage.
 * Measured on a real support@ thread, the cut kept 3 lines of 56 and lost both answers —
 * so MessageIntentService saw "Thank you, let me know if you need anything else" and a
 * pending task request sat waiting for detail the client had already sent.
 *
 * ── IT RUNS ON FLATTENED TEXT, NOT HTML ──
 * emailRichText.toPlainText goes first, always. That function is the hardened anti-leak
 * flattener — it handles comments before tags, separates table cells, folds NFKC — and
 * its test suite exists because the naive version leaked identity. Nothing here should
 * ever be handed raw HTML.
 *
 * The cost of that ordering, worth knowing: a flattened Gmail HTML quote carries no ">"
 * prefixes, so the ">"-based fallbacks below are weak on HTML. The marker path and the
 * diff path both still work, which is why passing `previousMessages` matters more for
 * HTML than for plain text.
 *
 * ── TWO WAYS TO FIND AN INLINE ANSWER ──
 *   1. Diff, when the caller supplies the email we sent: any word in the quoted copy that
 *      is not in our original is something the client typed. This is the reliable one.
 *   2. Heuristics otherwise: text following a quoted question mark, and unquoted lines
 *      between quoted blocks. Misses answers that do not follow a "?".
 *
 * ── A FALSE POSITIVE IS WORSE THAN THE BUG ──
 * A recovered "answer" ends up in a Zoho task as something the client said. A signature
 * or a reformatted quote read as an answer therefore puts words in their mouth. Hence the
 * signature cut-off, the per-segment match floor, and the placeholder rule below.
 */

/** What a client typed inside the quoted history. */
// @typedef {{ context: string, reply: string }} InlineReply

/* ------------------------------------------------------------------ */
/* Where the quoted part starts                                        */
/* ------------------------------------------------------------------ */

const QUOTE_MARKERS = [
    // Gmail / Apple: "On Fri, 25 Sept 2026 at 20:16, Name <\nx@y.com> wrote:".
    // The header wraps across lines, which is why this spans them — emailRichText's
    // own marker requires it on one line and therefore misses the wrapped form.
    { re: /(^|\n)[ \t]*On [^\n]{3,200}(?:\n[^\n]{0,200}){0,2}?\bwrote:[ \t]*(?=\n|$)/, kind: 'quote' },
    // Outlook: a rule line then "From:"
    { re: /(^|\n)[ \t]*_{8,}[ \t]*\n[ \t]*\*?From:\*?/, kind: 'quote' },
    // Outlook without the rule line
    { re: /(^|\n)[ \t]*\*?From:\*?[^\n]+\n[ \t]*\*?(?:Sent|Date):\*?/, kind: 'quote' },
    { re: /(^|\n)[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}/i, kind: 'quote' },
    /**
     * These last two exist so this list is a strict SUPERSET of emailRichText's.
     *
     * Storage previously cut at those markers and must not start keeping text it used to
     * discard. A bare rule line and "Sent from my iPhone" are the two emailRichText has
     * that the port did not, so they are added rather than left to the length check in
     * GmailIngestService — that check is the floor, and this is the reason it rarely has
     * to do anything.
     */
    { re: /(^|\n)[ \t]*_{10,}[ \t]*(?=\n|$)/, kind: 'quote' },
    { re: /(^|\n)[ \t]*Sent from my \w+/i, kind: 'quote' },
    /**
     * Zoho's ticket mirror. This is quoted history, NOT a client forward — a Zoho comment
     * arrives with our own earlier reply pasted under this banner. emailRichText does not
     * know it, so a mirrored comment currently passes through whole.
     */
    { re: /(^|\n)[ \t]*\*{3,}[ \t]*FWD MESSAGE[ \t]*\*{3,}/i, kind: 'quote' },
    // The first line of a ">" block
    { re: /(^|\n)[ \t]*>/, kind: 'quote' },
    // A genuine forward: a third party's mail, kept apart from a reply chain because it
    // is somebody else's message rather than ours coming back.
    { re: /(^|\n)[ \t]*-{3,}[ \t]*Forwarded message[ \t]*-{3,}/i, kind: 'forward' },
    { re: /(^|\n)[ \t]*Begin forwarded message:/i, kind: 'forward' },
];

const findQuoteStart = (text) => {
    let best = null;
    for (const { re, kind } of QUOTE_MARKERS) {
        const m = re.exec(text);
        if (!m) continue;
        const index = m.index + (m[1] ? m[1].length : 0);
        if (!best || index < best.index) best = { index, kind };
    }
    return best;
};

/* ------------------------------------------------------------------ */
/* Tokenising                                                          */
/* ------------------------------------------------------------------ */

const URL_RE = /^<?(?:https?:\/\/|www\.|mailto:)/i;

/**
 * Redaction placeholders, which is the subtlety that makes the diff work at all.
 *
 * The only copy of our own email we hold is the REDACTED one — the models keep no raw
 * body. So our side says "Hi [name]," while the client's quoted copy says "Hi Moon,".
 * Compared literally, the client's own name reads as a word they just typed, and the
 * feature confidently reports "Moon" as their answer.
 *
 * A placeholder therefore matches any single token. It is not a fuzzy match bolted on for
 * convenience: it is what the placeholder means.
 */
const PLACEHOLDER_RE = /\[(?:name|email|phone|link)\]/i;

const stripQuotePrefixes = (text) => text
    .split('\n')
    .map((l) => l.replace(/^[ \t]*(?:>[ \t]?)+/, ''))
    .join('\n');

const tokenize = (text) => {
    const out = [];
    for (const raw of String(text || '').split(/\s+/)) {
        if (!raw) continue;
        // Links render differently in every client, so comparing them creates noise.
        if (URL_RE.test(raw) || /^<.*>$/.test(raw)) continue;
        const norm = raw
            .toLowerCase()
            .replace(/<[^>]*>/g, '')
            .replace(/[*_`"'“”‘’()[\]{}]/g, '')
            .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (!norm) continue;
        out.push({ raw, norm, placeholder: PLACEHOLDER_RE.test(raw) });
    }
    return out;
};

/** Our token matches theirs when the words agree, or when ours is a placeholder. */
const sameToken = (quotedTok, ourTok) => ourTok.placeholder || quotedTok.norm === ourTok.norm;

/**
 * How many of their words one placeholder of ours may stand for.
 *
 * A placeholder is a single token; the value it replaced usually is not. "[phone]" sits
 * where they wrote "+1 (818) 308-1444" — three tokens — so matching one-to-one leaves
 * "+1 (818)" unaccounted for, and the diff reports our own phone number back to us as
 * something the client typed. This is not hypothetical: it is what the first run of the
 * redacted-diff test produced.
 *
 * Four covers the longest redacted value that survives tokenising (a phone; a URL is
 * dropped outright and an address is one token). The bound matters — an unbounded reach
 * would let one placeholder swallow a genuine answer sitting next to it.
 */
const MAX_PLACEHOLDER_SPAN = 4;

/* ------------------------------------------------------------------ */
/* Word-level LCS diff                                                 */
/* ------------------------------------------------------------------ */

/**
 * One boolean per quoted token: true when that token also appears in our original.
 * Returns null when the comparison would be too large, so the caller can fall back.
 */
const matchQuotedToOriginal = (q, o, maxCells) => {
    /**
     * Quoted positions that were matched against a PLACEHOLDER of ours, collected as we
     * go. Each one is a point where our single token stands for however many words they
     * actually wrote, so the leftovers around it are ours too — see MAX_PLACEHOLDER_SPAN.
     */
    const placeholderAt = [];

    // Trim the common head and tail so the table stays small.
    let pre = 0;
    while (pre < q.length && pre < o.length && sameToken(q[pre], o[pre])) {
        if (o[pre].placeholder) placeholderAt.push(pre);
        pre++;
    }
    let suf = 0;
    while (
        suf < q.length - pre
        && suf < o.length - pre
        && sameToken(q[q.length - 1 - suf], o[o.length - 1 - suf])
    ) {
        if (o[o.length - 1 - suf].placeholder) placeholderAt.push(q.length - 1 - suf);
        suf++;
    }

    const qs = q.slice(pre, q.length - suf);
    const os = o.slice(pre, o.length - suf);
    const n = qs.length;
    const m = os.length;

    const matched = new Array(q.length).fill(false);
    for (let i = 0; i < pre; i++) matched[i] = true;
    for (let i = 0; i < suf; i++) matched[q.length - 1 - i] = true;

    /** Let each placeholder reach outwards over the words it stood in for. */
    const absorbAroundPlaceholders = () => {
        for (const idx of placeholderAt) {
            for (let d = idx - 1; d >= 0 && idx - d <= MAX_PLACEHOLDER_SPAN && !matched[d]; d--) {
                matched[d] = true;
            }
            for (let d = idx + 1; d < q.length && d - idx <= MAX_PLACEHOLDER_SPAN && !matched[d]; d++) {
                matched[d] = true;
            }
        }
        return matched;
    };

    if (n === 0) return absorbAroundPlaceholders();
    if (m === 0) return absorbAroundPlaceholders(); // everything left in the middle is theirs
    if (n * m > maxCells) return null;

    const W = m + 1;
    const dp = new Uint16Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i * W + j] = sameToken(qs[i], os[j])
                ? dp[(i + 1) * W + j + 1] + 1
                : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
        }
    }

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (sameToken(qs[i], os[j])) {
            matched[pre + i] = true;
            if (os[j].placeholder) placeholderAt.push(pre + i);
            i++;
            j++;
        } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
        else j++;
    }
    return absorbAroundPlaceholders();
};

/* ------------------------------------------------------------------ */
/* Cleaning up candidates                                              */
/* ------------------------------------------------------------------ */

const SIGN_OFF_RE = /^(?:--+(?:\s|$)|(?:warm|kind|best|with)\s+regards\b|regards,|best,|best$|thanks(?:,|!|\.|$)|thank you(?:,|!|\.|$)|many thanks\b|cheers\b|sincerely\b|sent from my\b)/i;
const HEADER_RE = /^(?:on\b.{0,200}\bwrote:?|from:|sent:|to:|cc:|subject:|date:)/i;

const cleanReply = (text) => {
    // Cut at a sign-off: everything after it is a signature, not an answer.
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const kept = [];
    for (let k = 0; k < words.length; k++) {
        if (SIGN_OFF_RE.test(words.slice(k).join(' '))) break;
        kept.push(words[k]);
    }
    const r = kept.join(' ').trim();
    if (HEADER_RE.test(r)) return '';
    // Drop anything carrying no words at all — punctuation, a bare link, an address.
    if (!/[\p{L}\p{N}]/u.test(r.replace(/\S+@\S+/g, '').replace(/https?:\/\/\S+/g, ''))) return '';
    return r;
};

/* ------------------------------------------------------------------ */
/* Finding the replies                                                 */
/* ------------------------------------------------------------------ */

/**
 * Split the quoted history at nested headers, and diff each piece on its own.
 *
 * Without this, a partial copy of our email that the client edited gets confused with the
 * full copy further down the chain.
 */
const splitIntoSegments = (quotedPlain) => {
    const segments = [];
    let current = [];
    const lines = quotedPlain.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Gmail headers wrap over two or three lines.
        const joined = [line, (lines[i + 1] || '').trim(), (lines[i + 2] || '').trim()].join(' ');
        const isGmailHeader = /^on\b.{0,200}\bwrote:\s*$/i.test(line)
            || (/^on\b/i.test(line) && /\bwrote:/i.test(joined) && !/\bwrote:/i.test(line) && joined.length < 320);
        const isOutlookHeader = /^\*?(?:from|sent|to|cc|subject|date):\*?\s/i.test(line) || /^_{8,}$/.test(line);

        if (isGmailHeader || isOutlookHeader) {
            if (current.join('').trim()) segments.push(current.join('\n'));
            current = [];
            if (isGmailHeader && !/\bwrote:/i.test(line)) {
                while (i + 1 < lines.length && !/\bwrote:/i.test(lines[i])) i++;
            }
            continue;
        }
        current.push(lines[i]);
    }
    if (current.join('').trim()) segments.push(current.join('\n'));
    return segments;
};

const inlineByDiff = (quoted, previous, maxCells) => {
    const o = tokenize(stripQuotePrefixes(previous.join('\n')));
    if (o.length === 0) return null;
    const replies = [];

    for (const segment of splitIntoSegments(stripQuotePrefixes(quoted))) {
        const q = tokenize(segment);
        if (q.length === 0) continue;
        const matched = matchQuotedToOriginal(q, o, maxCells);
        if (!matched) return null;

        /**
         * A segment with almost nothing in common with our email is older history, or a
         * different email entirely. Calling all of it "new" is how this produces a wall
         * of false answers, so it is skipped instead.
         */
        const matchedCount = matched.filter(Boolean).length;
        if (matchedCount < Math.min(5, Math.ceil(q.length * 0.3))) continue;

        let k = 0;
        while (k < q.length) {
            if (matched[k]) { k++; continue; }
            const start = k;
            while (k < q.length && !matched[k]) k++;

            // Look a word or two past the run, so "Warm | Regards," is recognised as a
            // sign-off even when "Regards," happens to match a word in our own email.
            const runWords = q.slice(start, k).map((t) => t.raw);
            const withLookahead = [...runWords, ...q.slice(k, k + 2).map((t) => t.raw)];
            let cut = runWords.length;
            let signatureStarts = false;
            for (let w = 0; w < runWords.length; w++) {
                if (SIGN_OFF_RE.test(withLookahead.slice(w).join(' '))) {
                    cut = w;
                    signatureStarts = true;
                    break;
                }
            }

            const reply = cleanReply(runWords.slice(0, cut).join(' '));
            if (reply) {
                const context = q.slice(Math.max(0, start - 14), start).map((t) => t.raw).join(' ');
                replies.push({ context, reply });
            }
            if (signatureStarts) break; // the rest of this segment is their signature
        }
    }
    return replies;
};

const inlineByHeuristics = (quoted) => {
    const replies = [];
    const lines = quoted.split('\n');

    // Anything past the first nested header is older history.
    const firstHeader = lines.findIndex((l) => HEADER_RE.test(l.replace(/^[ \t>]*/, '').trim()));
    const limit = firstHeader >= 0 ? firstHeader : lines.length;

    let sawQuote = false;
    let pending = [];
    let lastQuoted = '';
    const flush = (closedByQuote) => {
        const reply = cleanReply(pending.join(' '));
        if (reply && closedByQuote) replies.push({ context: lastQuoted, reply });
        pending = [];
    };

    for (let idx = 0; idx < limit; idx++) {
        const line = lines[idx];
        const depth = (line.match(/^[ \t]*((?:>[ \t]?)*)/)?.[1].match(/>/g) || []).length;
        const content = line.replace(/^[ \t]*(?:>[ \t]?)*/, '').trim();

        if (depth === 1) {
            if (pending.length) flush(true);
            sawQuote = true;
            // "> ...confirm the correct pack size? 2500 sets."
            const q = content.match(/^(.*\?)\s+(\S.*)$/);
            if (q) {
                const reply = cleanReply(q[2]);
                if (reply) replies.push({ context: q[1].slice(-120), reply });
            }
            if (content) lastQuoted = content.slice(-120);
        } else if (depth === 0 && sawQuote && content) {
            pending.push(content);
        }
    }
    // Unquoted text after the LAST quoted block, with no quote following it, is a
    // signature far more often than an answer — so it is dropped rather than flushed.
    return replies;
};

/* ------------------------------------------------------------------ */
/* Public entry points                                                 */
/* ------------------------------------------------------------------ */

/** How large the diff table may get before the heuristics take over. */
const MAX_DIFF_CELLS = 12_000_000;

/**
 * Split an already-flattened email body.
 *
 * @param {string} input  PLAIN TEXT — run emailRichText.toPlainText first, never HTML.
 * @param {object} [opts]
 * @param {string[]} [opts.previousMessages]  our earlier body text, most recent first
 * @param {number} [opts.maxDiffCells]
 * @returns {{ body, inlineReplies, quoted, forwarded, quotedTrimmed }}
 */
const splitEmail = (input, opts = {}) => {
    const text = String(input || '').replace(/\r\n?/g, '\n');
    const marker = findQuoteStart(text);

    if (!marker) {
        return {
            body: text.trim(),
            inlineReplies: [],
            quoted: '',
            forwarded: null,
            quotedTrimmed: false,
        };
    }

    const body = text.slice(0, marker.index).trim();
    const rest = text.slice(marker.index);

    if (marker.kind === 'forward') {
        // Somebody else's message, kept apart rather than silently dropped.
        return {
            body,
            inlineReplies: [],
            quoted: '',
            forwarded: rest.trim(),
            quotedTrimmed: true,
        };
    }

    const quoted = rest.trim();
    const maxCells = opts.maxDiffCells ?? MAX_DIFF_CELLS;

    let inlineReplies = null;
    if (Array.isArray(opts.previousMessages) && opts.previousMessages.length > 0) {
        inlineReplies = inlineByDiff(quoted, opts.previousMessages, maxCells);
    }
    if (inlineReplies === null) inlineReplies = inlineByHeuristics(quoted);

    // Never repeat something already sitting in the body.
    const bodyNorm = body.toLowerCase();
    inlineReplies = inlineReplies.filter((r) => !bodyNorm.includes(r.reply.toLowerCase()));

    return { body, inlineReplies, quoted, forwarded: null, quotedTrimmed: true };
};

/**
 * The body plus any recovered answers, labelled, for the intent model.
 *
 * Labelled rather than concatenated so the model can tell an answer from the original
 * message — "2500 sets." on its own is meaningless without the question it answers.
 */
const buildBodyForModel = (body, replies = []) => {
    if (!replies.length) return body;
    const lines = replies.map((r) => `- Replying to "…${r.context.trim()}": ${r.reply}`);
    return `${body}\n\nReplies the client typed inside the quoted email:\n${lines.join('\n')}`.trim();
};

module.exports = {
    splitEmail,
    buildBodyForModel,
    cleanReply,
    tokenize,
    MAX_DIFF_CELLS,
};

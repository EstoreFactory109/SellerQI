/**
 * errorContext.js — attach a "which hop failed" tag to an Error, and render it compactly.
 *
 * WHY THIS EXISTS
 * `asyncReportEngine.pollAll` stores only `err.message` when a `finalize` throws
 * (`Services/AmazonAds/asyncReportEngine.js`), discarding the stack. A production
 * `finalize failed: socket hang up` was therefore diagnosed WRONG TWICE — the bare message is
 * emitted identically by three different transports on two different branches of the finance
 * finalize path, and nothing in the stored note distinguished them:
 *
 *   finalize ─┬─ getReportDocumentUrl        (GET  — FinanceService's httpsRequest)
 *             ├─ downloadReportContent       (already self-labels, so never ambiguous)
 *             └─ processSalesReportRows ─┬─ getAccessToken   (POST — LWA token mint)
 *                                        └─ fetchTransactions (GET  — 1000+ pages)
 *
 * Tagging costs two lines per hop and makes the next occurrence self-identifying.
 *
 * THE CONSTRAINT THAT SHAPES THIS FILE
 * `ScheduledIntegration._runAsyncFinancePhase` rebuilds an `Error` from the stored note and re-runs
 * `classifySyncFailure` on it, which does LOWERCASE SUBSTRING matching to pick the `errorKind`
 * bucket. So a descriptor must:
 *   1. keep the original message verbatim — never paraphrase or truncate it away, or a
 *      'socket hang up' stops bucketing as 'timeout'; and
 *   2. introduce no token that changes the bucket. No hop name may contain 'timeout', 'forbidden',
 *      'access_denied', 'denied', 'out of memory', 'econnreset', 'epipe', or 'eai_again'.
 * `HOP_NAMES` below is the allowlist, and `errorContext.test.js` asserts both properties.
 */

/**
 * The hops we tag. An allowlist rather than free-form strings so a future hop name cannot silently
 * collide with a `classifySyncFailure` keyword and re-bucket a failure (see the header).
 */
const HOP_NAMES = Object.freeze({
    LWA_TOKEN: 'lwaToken',
    FINANCE_TXN_PAGE: 'financeTxnPage',
    REPORT_DOCUMENT_URL: 'reportDocumentUrl',
    FINANCE_WALK: 'financeWalk',
});

/**
 * Extra keys worth carrying on an error, in the order they should render. Deliberately small:
 * this text passes through `FinanceSyncLog.error` (truncated to 500) and a 120-char note print, so
 * every character competes with the original message.
 */
const EXTRA_KEYS = ['pagesCompleted', 'page'];

/**
 * Tag `err` with the hop that produced it. FIRST TAG WINS.
 *
 * That direction matters: the error bubbles outward through wrapper after wrapper, and the
 * innermost hop is the one that actually failed. If the outermost won, every finance failure would
 * report `financeWalk` — true, but exactly as useless as the bare message we started with.
 *
 * Never throws: this runs on an error path, and a failure to annotate must not replace the real
 * error with a TypeError. A frozen/sealed error is left as-is.
 *
 * @param {Error} err
 * @param {string} hop  one of HOP_NAMES
 * @param {object} [extra]  e.g. { pagesCompleted: 847 }
 * @returns {Error} the same error, for `throw tagHop(err, ...)`
 */
function tagHop(err, hop, extra = {}) {
    if (!err || typeof err !== 'object') return err;
    try {
        if (!err.hop) err.hop = hop;
        for (const [key, value] of Object.entries(extra)) {
            if (err[key] === undefined) err[key] = value;
        }
    } catch (_) {
        // Non-extensible error — the message still carries the cause, which is the important part.
    }
    return err;
}

/**
 * Render a bounded one-line descriptor: `[hop] CODE: message (pagesCompleted=N)`.
 *
 * The hop goes FIRST so it survives even the shortest downstream truncation (a 120-char note
 * print). The message is preserved verbatim and is the last thing trimmed.
 *
 * @param {Error|any} err
 * @param {object} [opts]
 * @param {number} [opts.maxLen=300]  ≤300 keeps the tag alive through FinanceSyncLog's 500-char cap
 * @returns {string}
 */
function describeError(err, { maxLen = 300 } = {}) {
    const message = (err && err.message) || String(err ?? 'unknown error');

    const prefix = err && err.hop ? `[${err.hop}] ` : '';
    const code = err && err.code ? `${err.code}: ` : '';

    const details = [];
    for (const key of EXTRA_KEYS) {
        if (err && err[key] !== undefined && err[key] !== null) details.push(`${key}=${err[key]}`);
    }
    const suffix = details.length ? ` (${details.join(', ')})` : '';

    const full = `${prefix}${code}${message}${suffix}`;
    if (full.length <= maxLen) return full;

    // Over budget: keep the hop, the code and the suffix (all short and all high-signal) and trim
    // the message from the RIGHT, so its opening — which is what classifySyncFailure matches on —
    // survives.
    const fixed = prefix.length + code.length + suffix.length;
    const room = maxLen - fixed - 1; // -1 for the ellipsis
    if (room <= 0) return full.slice(0, maxLen);
    return `${prefix}${code}${message.slice(0, room)}…${suffix}`;
}

module.exports = { tagHop, describeError, HOP_NAMES, EXTRA_KEYS };

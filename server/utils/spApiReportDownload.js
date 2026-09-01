/**
 * spApiReportDownload.js — hardened download of an SP-API report document.
 *
 * WHY THIS EXISTS
 * `FinanceService.js` and `asinwiseSales.js` each carried a byte-identical `downloadContent`
 * with three defects that only bite on very large reports — which is exactly when a
 * high-volume seller's sales data is at stake:
 *
 *   1. NO TIMEOUT OF ANY KIND. A stalled S3 socket hangs until the OS TCP keepalive gives up
 *      (~2h on Linux). The BullMQ job lock is also 2h (Services/BackgroundJobs/worker.js), so a
 *      single stall burns the entire lock while the job looks alive.
 *
 *   2. OPAQUE / INCOMPLETE TRUNCATION HANDLING. When `content-length` is present Node itself
 *      aborts a short body, but it surfaces as a bare `Error: aborted` with no byte counts —
 *      indistinguishable from a dozen other network faults in the logs. Worse, a *chunked*
 *      response has no declared length at all, so a short-but-clean body emits `end` and the
 *      promise RESOLVES with a truncated TSV that the caller parses as complete. For the finance
 *      sync that is silent data loss: a day older than PROVISIONAL_SETTLE_DAYS whose report came
 *      back short is written as a *settled* $0 and never retried. We translate the abort into an
 *      explicit truncation error and additionally verify the declared length on clean end.
 *
 *   3. NO SIZE VISIBILITY. Callers could not tell "Amazon returned an empty report" from
 *      "we downloaded 40MB and parsed 0 rows", so a parse bug looked identical to no data.
 *      Returning byte counts is what makes that distinction possible.
 *
 * Gunzip is streamed (as before), but every decompressed chunk is still retained to build the
 * final string — peak memory remains roughly 3x the decompressed size. Reducing that needs a
 * streaming parser (see utils/asyncCsvParser.js) and is deliberately out of scope here; the
 * mitigation for now is that callers request smaller date ranges.
 */

const https = require('https');
const http = require('http');
const zlib = require('zlib');

function envInt(name, fallback) {
    const parsed = parseInt(process.env[name], 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Sub-second values must not render as "0s" — these strings end up in FinanceSyncLog.error.
function fmtDuration(ms) {
    return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
}

// Whole-download ceiling. Generous, because a legitimately large report on a slow link can take
// minutes — the point is that it is FINITE, unlike before.
const DEFAULT_TIMEOUT_MS = () => envInt('SPAPI_REPORT_DOWNLOAD_TIMEOUT_MS', 5 * 60 * 1000);
// Idle ceiling: no bytes at all for this long means the transfer is dead, even if the overall
// budget has time left. This is what actually catches a silent stall quickly.
const DEFAULT_IDLE_TIMEOUT_MS = () => envInt('SPAPI_REPORT_IDLE_TIMEOUT_MS', 60 * 1000);
// Compressed-byte ceiling. 0 disables it entirely.
//
// This defaulted to 0 and was set NOWHERE — checked across the tree and the deployed process
// environment — so the cap documented here did not actually exist in production.
//
// The default below is a CATASTROPHE BACKSTOP, not a tuning knob: real reports here run to a
// few MB compressed, so 256 MB never fires for legitimate traffic. A 256 MB compressed TSV
// decompresses to multiple GB and is then parsed into JS objects at a further multiple — on
// heaps of 1536 MB (worker) and 768 MB (api) that is an OOM, and PM2 then recycles the whole
// process, killing every other job it was holding. Failing one report loudly is much cheaper
// than taking several concurrent accounts down with it.
//
// Lower it via SPAPI_REPORT_MAX_BYTES for a genuinely tight cap; doing that well needs real
// report sizes, which are computed here but not currently recorded anywhere.
const DEFAULT_MAX_BYTES = () => envInt('SPAPI_REPORT_MAX_BYTES', 256 * 1024 * 1024);

/**
 * Download (and optionally gunzip) a report document.
 *
 * @param {string} url  pre-signed S3 URL from getReportDocument — no auth header needed
 * @param {object} [opts]
 * @param {boolean} [opts.isGzip]        true when compressionAlgorithm === 'GZIP'
 * @param {number}  [opts.timeoutMs]     overall budget; 0 disables
 * @param {number}  [opts.idleTimeoutMs] max gap between chunks; 0 disables
 * @param {number}  [opts.maxBytes]      compressed-byte ceiling; 0 = unlimited
 * @param {string}  [opts.label]         included in error messages for traceability
 * @returns {Promise<{text: string, compressedBytes: number, decompressedBytes: number, durationMs: number}>}
 */
function downloadReportContent(url, opts = {}) {
    const {
        isGzip = false,
        timeoutMs = DEFAULT_TIMEOUT_MS(),
        idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS(),
        maxBytes = DEFAULT_MAX_BYTES(),
        label = 'report',
    } = opts;

    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const protocol = String(url).startsWith('https') ? https : http;

        let chunks = [];
        let compressedBytes = 0;
        let decompressedBytes = 0;
        let expectedBytes = null;
        let settled = false;
        let responseStarted = false;
        let overallTimer = null;
        let idleTimer = null;
        let request = null;
        // Hoisted so cleanup() can reach it. The gunzip stream is created inside the response
        // handler below, i.e. in a scope the settle functions cannot see — which is precisely why
        // it was never destroyed.
        let inflateStream = null;

        function cleanup() {
            if (overallTimer) clearTimeout(overallTimer);
            if (idleTimer) clearTimeout(idleTimer);
            overallTimer = null;
            idleTimer = null;
            // Release the zlib context.
            //
            // WHY THIS MATTERS MORE THAN IT LOOKS. A gunzip stream holds a NATIVE zlib context and
            // buffer pool. Those live in RSS but NOT in the V8 heap, so they exert almost no GC
            // pressure and are never collected on their own — the process simply grows. This fires
            // on every gzipped SP-API/Ads report download, of which a pipeline does many.
            //
            // It is also the only mechanism found that explains RSS climbing with uptime while the
            // heap stays healthy, which is the divergence that made a memory leak look likely.
            // Called from cleanup() so every settle path (success, failure, timeout) is covered
            // exactly once — same shape as request.destroy() below.
            try { if (inflateStream) inflateStream.destroy(); } catch (_) { /* already gone */ }
            inflateStream = null;
        }

        function fail(err) {
            if (settled) return;
            settled = true;
            cleanup();
            chunks = null; // release whatever we had buffered
            try { if (request) request.destroy(); } catch (_) { /* already gone */ }
            reject(err);
        }

        function succeed(value) {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        }

        function bumpIdleTimer() {
            if (!idleTimeoutMs) return;
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                fail(
                    new Error(
                        `[${label}] download stalled — no data for ${fmtDuration(idleTimeoutMs)} ` +
                        `after ${compressedBytes} bytes`
                    )
                );
            }, idleTimeoutMs);
        }

        // Translate a premature close into an explicit truncation error. Node raises this as a
        // bare `Error: aborted` with no context, which is useless when triaging a sync failure.
        function failTruncated(cause) {
            const expected = expectedBytes === null ? 'unknown' : `${expectedBytes}`;
            fail(
                new Error(
                    `[${label}] truncated download: received ${compressedBytes} of ${expected} bytes` +
                    (cause ? ` (${cause})` : '')
                )
            );
        }

        if (timeoutMs) {
            overallTimer = setTimeout(() => {
                fail(
                    new Error(
                        `[${label}] download exceeded ${fmtDuration(timeoutMs)} ` +
                        `(received ${compressedBytes} bytes)`
                    )
                );
            }, timeoutMs);
        }

        request = protocol.get(url, (res) => {
            responseStarted = true;
            // Hand ownership of liveness to the data-driven idle timer below. Left armed, the
            // socket timeout would also fire during a mid-body stall and report the misleading
            // "no response" reason.
            request.setTimeout(0);

            const status = res.statusCode || 0;
            if (status < 200 || status >= 300) {
                res.resume(); // drain so the socket can be reused/closed
                fail(new Error(`[${label}] download failed: HTTP ${status}`));
                return;
            }

            // Declared length of the COMPRESSED body when present.
            const declared = parseInt(res.headers['content-length'], 10);
            expectedBytes = Number.isFinite(declared) ? declared : null;

            // Count raw bytes off the wire before any decompression.
            res.on('data', (chunk) => {
                compressedBytes += chunk.length;
                bumpIdleTimer();
                if (maxBytes && compressedBytes > maxBytes) {
                    fail(
                        new Error(
                            `[${label}] download exceeded SPAPI_REPORT_MAX_BYTES (${maxBytes}); ` +
                            `aborted at ${compressedBytes} bytes`
                        )
                    );
                }
            });
            // Node emits both of these for a body that ends before content-length is satisfied.
            res.on('aborted', () => failTruncated('connection closed early'));
            res.on('error', (err) => {
                if (/aborted|ECONNRESET|premature/i.test(err.message)) failTruncated(err.message);
                else fail(new Error(`[${label}] download error: ${err.message}`));
            });

            const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
            if (isGzip) {
                // Record it so cleanup() can destroy the native zlib context on every settle path.
                // Only when we actually created one — `res` is destroyed via request.destroy().
                inflateStream = stream;
                // A corrupt/truncated gzip surfaces here rather than as short output.
                stream.on('error', (err) => fail(new Error(`[${label}] gunzip failed: ${err.message}`)));
            }

            stream.on('data', (chunk) => {
                decompressedBytes += chunk.length;
                if (chunks) chunks.push(chunk);
                bumpIdleTimer();
            });

            stream.on('end', () => {
                if (settled) return;

                // Defence in depth: Node usually aborts a short body itself (handled above), but
                // verify anyway so a clean-looking `end` can never yield partial data.
                if (expectedBytes !== null && compressedBytes !== expectedBytes) {
                    failTruncated('short body on clean end');
                    return;
                }

                const buffer = Buffer.concat(chunks);
                chunks = null; // free the chunk array before materialising the string
                const text = buffer.toString('utf-8');

                succeed({
                    text,
                    compressedBytes,
                    decompressedBytes: decompressedBytes || buffer.length,
                    durationMs: Date.now() - startedAt,
                });
            });

            bumpIdleTimer();
        });

        request.on('error', (err) => {
            if (responseStarted && /aborted|ECONNRESET|premature/i.test(err.message)) {
                failTruncated(err.message);
            } else {
                fail(new Error(`[${label}] download error: ${err.message}`));
            }
        });

        // Guards only the pre-response phase (connect / TLS / waiting for headers), which the
        // data-driven idle timer cannot see. Disarmed as soon as headers arrive.
        if (idleTimeoutMs) {
            request.setTimeout(idleTimeoutMs, () => {
                if (responseStarted) return; // body phase belongs to the idle timer
                fail(new Error(`[${label}] no response within ${fmtDuration(idleTimeoutMs)}`));
            });
        }
    });
}

// Upper bound on a plausible header-only report. The flat-file orders report has ~50 columns, so
// its header is a few hundred bytes; anything past this that still yields no parseable rows is a
// malformed payload rather than a genuinely empty window.
const HEADER_ONLY_MAX_BYTES = 64 * 1024;

/**
 * Count non-empty lines, stopping at `limit`.
 *
 * Deliberately scans with indexOf instead of `split('\n')`: this runs on the full report text,
 * which can be tens of MB, and we only ever need to know whether there are 0, 1, or ≥2 lines.
 */
function countNonEmptyLines(text, limit = 2) {
    if (!text) return 0;
    let count = 0;
    let pos = 0;
    while (pos < text.length && count < limit) {
        let nl = text.indexOf('\n', pos);
        if (nl === -1) nl = text.length;
        if (text.slice(pos, nl).trim()) count++;
        pos = nl + 1;
    }
    return count;
}

/**
 * True when a body delivered bytes but cannot be a valid TSV report.
 *
 * This catches "we downloaded megabytes and parsed nothing" — a truncated or wrong-format payload
 * — WITHOUT flagging the ordinary case of a window that genuinely had no orders. Amazon represents
 * "no orders" as a HEADER ROW ONLY: non-zero bytes that parse to zero rows. A naive
 * `bytes > 0 && rows === 0` check would therefore reject every quiet day and wedge the sync on it
 * just as an oversized report used to — the same deadlock, different trigger.
 */
function isUnusableReportPayload(text, decompressedBytes) {
    if (!decompressedBytes) return false; // genuinely empty download — callers handle that case
    const lines = countNonEmptyLines(text, 2);
    if (lines === 0) return true;         // bytes, but not one usable line
    // One line is a header, i.e. a legitimate empty report — unless it is far too big to be one.
    if (lines === 1 && decompressedBytes > HEADER_ONLY_MAX_BYTES) return true;
    return false;
}

module.exports = {
    downloadReportContent,
    countNonEmptyLines,
    isUnusableReportPayload,
    HEADER_ONLY_MAX_BYTES,
};

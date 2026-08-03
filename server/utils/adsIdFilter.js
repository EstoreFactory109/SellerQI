const logger = require('./Logger.js');

/**
 * Chunking for Amazon Ads SP v3 entity-ID filters.
 *
 * The v2 → v3 migration replaced `GET ?campaignIdFilter=a,b,c` with
 * `POST { campaignIdFilter: { include: [...] } }` and concluded that the POST body removed the
 * need to chunk. That is true only of the *URL length* limit — v3 still caps the number of
 * members in an `include[]` array, and exceeding it fails the whole request with
 * `400 INVALID_ARGUMENT: 1 validation error detected`. An account with thousands of campaigns
 * therefore never fetched ad groups or negative keywords at all.
 *
 * Note this is a different limit from `maxResults` (the per-page size, also 100) — the two are
 * easy to conflate because they share a value, but paginating a request does not shrink its filter.
 */

const DEFAULT_ADS_ID_FILTER_MAX = 100;

/**
 * @param {string} name  env var to read
 * @param {number} fallback  value when unset or invalid
 * @param {number} [min=1]  smallest accepted value. The chunk SIZE must be >= 1 (a zero-sized
 *   chunk is meaningless), but the chunk DELAY must accept 0 so pacing can be switched off —
 *   matching how `0` already means "disabled" for SPAPI_REPORT_MAX_BYTES and the finance request
 *   timeout. Folding both into a single `<= 0` rejection made the delay impossible to disable.
 */
function adsEnvInt(name, fallback, min = 1) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < min) {
        logger.warn(`[AdsIdFilter] ignoring invalid ${name}="${raw}" (min ${min}), using ${fallback}`);
        return fallback;
    }
    return parsed;
}

const ADS_ID_FILTER_MAX = adsEnvInt('ADS_ID_FILTER_CHUNK_SIZE', DEFAULT_ADS_ID_FILTER_MAX, 1);

/**
 * Pause between chunked requests. Chunking turns one request into potentially dozens (52 for a
 * 5,102-campaign account), and firing those back-to-back is itself a plausible 429 trigger — which
 * would make the throttling worse for exactly the large accounts chunking is meant to rescue.
 *
 * Set to 0 to disable pacing (tests do this so they don't sleep for ~13s per large fixture).
 */
const ADS_CHUNK_DELAY_MS = adsEnvInt('ADS_ID_FILTER_CHUNK_DELAY_MS', 250, 0);

function sleep(ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Split an ID array into chunks small enough for a single SP v3 `include[]` filter.
 * Mirrors the `chunkArray(arr, size)` shape used elsewhere in the codebase.
 *
 * An empty input yields `[]` (no chunks), NOT `[[]]` — callers must not issue a request with an
 * empty filter, since an empty `include` means "match nothing" to Amazon rather than "match all".
 *
 * @param {Array} ids
 * @param {number} [size=ADS_ID_FILTER_MAX]
 * @returns {Array[]} array of chunks, each with length <= size
 */
function chunkIds(ids, size = ADS_ID_FILTER_MAX) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const limit = Number.isFinite(size) && size > 0 ? Math.floor(size) : ADS_ID_FILTER_MAX;
    const out = [];
    for (let i = 0; i < ids.length; i += limit) {
        out.push(ids.slice(i, i + limit));
    }
    return out;
}

module.exports = {
    ADS_ID_FILTER_MAX,
    ADS_CHUNK_DELAY_MS,
    chunkIds,
    sleep
};

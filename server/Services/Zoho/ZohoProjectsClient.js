/**
 * ZohoProjectsClient.js — the single request path to the Zoho Projects API.
 *
 * Every call in ZohoProjectsService goes through zohoRequest(), which owns:
 *   - the Zoho-oauthtoken auth header (NOT Bearer — the most common cause of a valid
 *     token returning 401)
 *   - resolving the v2 (/restapi) vs v3 (/api/v3) base path
 *   - an explicit timeout on every request
 *   - one transparent retry on 401 after re-minting the access token
 *   - a bounded retry on 429 honouring Retry-After
 *
 * Retry is implemented locally rather than with axios-retry on purpose: several service
 * modules in this repo call axiosRetry(axios, ...) on the DEFAULT axios instance as a
 * require-time side effect, so global retry config here would both inherit their settings
 * and leak ours into unrelated Amazon calls.
 */

const axios = require('axios');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const { getAccessToken, invalidateAccessToken, getConnection } = require('./ZohoAuth.js');
const { REQUEST_TIMEOUT_MS } = require('./config.js');

const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RETRY_AFTER_MS = 2000;
const MAX_RETRY_AFTER_MS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve the base URL for a given API generation. */
const baseUrlFor = (apiDomain, version) => {
    if (version === 'v2') {
        return `${apiDomain}/restapi`;
    }
    return `${apiDomain}/api/v3`;
};

/**
 * Read the connected portal id, failing loudly if the connect flow never completed.
 * Callers pass an explicit portalId only in the narrow window during connect, before
 * one has been persisted.
 */
const resolvePortalId = async (override) => {
    if (override) {
        return override;
    }

    const connection = await getConnection();

    // Two distinct failures that point at different fixes: never connected at all vs
    // connected but the portal lookup failed during the callback.
    if (!connection) {
        const error = new ApiError(428, 'Zoho Projects is not connected. Run the admin connect flow first.');
        logger.error(error);
        throw error;
    }

    if (!connection.portalId) {
        const error = new ApiError(428, 'Zoho is connected but no portal was resolved. Reconnect the Zoho Projects account.');
        logger.error(error);
        throw error;
    }

    return connection.portalId;
};

const resolveApiDomain = async () => {
    const connection = await getConnection();
    if (!connection || !connection.apiDomain) {
        const error = new ApiError(428, 'Zoho Projects is not connected. Run the admin connect flow first.');
        logger.error(error);
        throw error;
    }
    return connection.apiDomain;
};

/**
 * Pull a human-readable message out of a Zoho error body.
 *
 * Zoho uses at least four shapes, and the naive `data.error.message || data.error`
 * silently stringified the fourth one as "[object Object]" — which is how a real
 * scope failure reported itself as `Zoho rejected the request ([object Object])`
 * instead of `Invalid OAuth scope`:
 *
 *   v2      { error: "some text" }
 *   v3      { error: { code, message } }
 *   v3 alt  { message: "..." }
 *   OAuth   { error: { title, error_type, details: [{ message }] } }   <-- was lost
 */
const zohoErrorMessage = (data) => {
    if (!data) return null;
    if (typeof data === 'string') return data;

    const err = data.error;
    if (typeof err === 'string') return err;

    if (err && typeof err === 'object') {
        const detail = Array.isArray(err.details)
            ? err.details.map((d) => d && d.message).filter(Boolean).join('; ')
            : null;
        // Title first: "Invalid OAuth scope." is the detail, "INVALID_OAUTHSCOPE"
        // is the part that tells you which scope list to go and fix.
        const parts = [err.message, err.title, detail].filter(Boolean);
        if (parts.length) return [...new Set(parts)].join(' — ');
    }

    return data.message || null;
};

/** Turn a Zoho API failure into an ApiError carrying Zoho's own message where available. */
const toApiError = (error, context) => {
    if (error instanceof ApiError) {
        return error;
    }

    if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        const zohoMessage = zohoErrorMessage(data) || error.message;

        logger.error(new ApiError(status, `${context}: ${zohoMessage}`), { status, zohoResponse: data });

        if (status === 404) {
            return new ApiError(404, `${context}: not found in Zoho Projects`);
        }
        if (status === 401 || status === 403) {
            return new ApiError(status, `${context}: Zoho rejected the request (${zohoMessage})`);
        }
        return new ApiError(status >= 400 && status < 600 ? status : 502, `${context}: ${zohoMessage}`);
    }

    if (error.request) {
        logger.error(new ApiError(504, `${context}: no response received from Zoho`));
        return new ApiError(504, `${context}: no response received from Zoho`);
    }

    logger.error(new ApiError(500, `${context}: ${error.message}`));
    return new ApiError(500, `${context}: ${error.message}`);
};

/** Parse Retry-After (seconds, or an HTTP date) into a bounded millisecond delay. */
const retryAfterMs = (headers) => {
    const raw = headers && (headers['retry-after'] || headers['Retry-After']);
    if (!raw) {
        return DEFAULT_RETRY_AFTER_MS;
    }

    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
        return Math.min(Math.max(seconds, 1) * 1000, MAX_RETRY_AFTER_MS);
    }

    const at = Date.parse(raw);
    if (!Number.isNaN(at)) {
        return Math.min(Math.max(at - Date.now(), 1000), MAX_RETRY_AFTER_MS);
    }

    return DEFAULT_RETRY_AFTER_MS;
};

/**
 * Issue one request against the Zoho Projects API.
 *
 * @param {Object}  options
 * @param {string}  options.method    HTTP verb, default GET
 * @param {string}  options.path      path below the version base, e.g. /portal/123/projects
 * @param {string}  options.version   'v3' (default) or 'v2'
 * @param {Object}  options.params    query string
 * @param {Object}  options.data      request body
 * @param {boolean} options.form      send the body form-encoded (required by v2 writes)
 * @param {boolean} options.multipart send `data` as-is as FormData (required by uploads)
 * @param {number}  options.timeout   override the default timeout, for slow uploads
 * @param {string}  options.context   phrase used in error messages
 */
const zohoRequest = async ({
    method = 'GET',
    path,
    version = 'v3',
    params,
    data,
    form = false,
    multipart = false,
    timeout,
    headers: extraHeaders,
    // Full base URL override, for Zoho products that do NOT live on the Projects
    // host — Billing is served from www.zohoapis.com/billing/v1, not projectsapi.
    // Everything else here (token minting, the 401 replay, 429 backoff, error
    // normalisation) applies unchanged, which is why this is an override rather
    // than a second client.
    baseUrl,
    // 'arraybuffer' for binary responses (invoice PDFs). Left undefined everywhere
    // else so axios keeps parsing JSON as before.
    responseType,
    context = 'Zoho Projects request'
}) => {
    const url = baseUrl
        ? `${baseUrl}${path}`
        : `${baseUrlFor(await resolveApiDomain(), version)}${path}`;

    let triedTokenRefresh = false;
    let rateLimitRetries = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const accessToken = await getAccessToken({ forceRefresh: triedTokenRefresh });

        const headers = {
            // Zoho's own scheme. `Bearer` here fails with an opaque 401.
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            Accept: 'application/json',
            ...(extraHeaders || {})
        };

        let body = data;
        if (data !== undefined) {
            if (multipart) {
                // The caller supplies Content-Type via `headers` (form-data's
                // getHeaders(), which carries the generated boundary). Setting it here
                // would drop the boundary and Zoho answers 6500 General Error.
                body = data;
            } else if (form) {
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
                body = new URLSearchParams(data);
            } else {
                headers['Content-Type'] = 'application/json';
            }
        }

        try {
            const response = await axios({
                method,
                url,
                params,
                data: body,
                headers,
                // An upload of a client's video is not comparable to a JSON read, so the
                // shared timeout is overridable rather than generous for every call.
                timeout: timeout || REQUEST_TIMEOUT_MS,
                ...(responseType ? { responseType } : {}),
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            });

            return response.data;
        } catch (error) {
            const status = error.response && error.response.status;

            // The cached token may have been revoked or rotated out from under us. Drop
            // it and replay exactly once with a freshly minted one.
            if (status === 401 && !triedTokenRefresh) {
                triedTokenRefresh = true;
                await invalidateAccessToken();
                logger.warn(`[ZohoProjectsClient] 401 on ${method} ${path} — refreshing token and retrying once`);
                continue;
            }

            if (status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
                rateLimitRetries += 1;
                const waitMs = retryAfterMs(error.response.headers);
                logger.warn(
                    `[ZohoProjectsClient] 429 on ${method} ${path} — retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES} in ${waitMs}ms`
                );
                await sleep(waitMs);
                continue;
            }

            throw toApiError(error, context);
        }
    }
};

/**
 * Unwrap the array Zoho nests under a resource-specific key.
 * v3 responses are sometimes bare arrays, so handle both.
 */
const unwrap = (payload, envelope) => {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (payload && Array.isArray(payload[envelope])) {
        return payload[envelope];
    }
    // v3 wraps some collections one level deeper under `data`.
    if (payload && payload.data && Array.isArray(payload.data)) {
        return payload.data;
    }
    return [];
};

/**
 * Walk every page of a collection.
 *
 * The two generations paginate differently — v2 uses 1-based `index` plus `range`, v3
 * uses `page` plus `per_page` — so the dialect is chosen from the version. Iteration
 * stops on a short page, and `maxItems` caps the total so a huge portal cannot make a
 * request handler run unbounded.
 */
const paginate = async ({ path, version = 'v3', envelope, pageSize = 100, params = {}, maxItems = Infinity, context }) => {
    const results = [];
    let index = 1; // v2 is 1-based over records
    let page = 1;  // v3 is 1-based over pages

    while (results.length < maxItems) {
        const remaining = maxItems - results.length;
        const size = Math.min(pageSize, remaining);

        const pageParams =
            version === 'v2'
                ? { ...params, index, range: size }
                : { ...params, page, per_page: size };

        const payload = await zohoRequest({ path, version, params: pageParams, context });
        const batch = unwrap(payload, envelope);

        results.push(...batch);

        // A short page means we have reached the end.
        if (batch.length < size) {
            break;
        }

        index += batch.length;
        page += 1;
    }

    return results.slice(0, maxItems === Infinity ? results.length : maxItems);
};

module.exports = {
    zohoRequest,
    paginate,
    unwrap,
    resolvePortalId,
    baseUrlFor
};

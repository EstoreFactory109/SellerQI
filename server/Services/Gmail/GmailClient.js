/**
 * GmailClient.js — the single request path to the Gmail API.
 *
 * Mirrors Services/Zoho/ZohoProjectsClient.js and owns the same concerns: the auth
 * header, an explicit timeout on every call, one transparent replay on 401 after
 * re-minting, and bounded backoff on throttling.
 *
 * Retry is local rather than axios-retry for the reason documented in the Zoho client:
 * several modules here call axiosRetry() on the DEFAULT axios instance at require time,
 * so global config would both inherit their settings and leak ours into Amazon calls.
 *
 * ── THE ONE GMAIL-SPECIFIC TRAP ──
 * Gmail reports throttling as **403** at least as often as 429, with the real cause in
 * `error.errors[0].reason` — `rateLimitExceeded`, `userRateLimitExceeded`,
 * `backendError`. Treating 403 as a permissions failure means a sync that stops on a
 * transient limit and reads, in the logs, exactly like a missing scope. The distinction
 * is the reason string, not the status.
 */

const axios = require('axios');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const { getAccessToken, invalidateAccessToken } = require('./GmailAuth.js');
const { API_BASE, PATHS, REQUEST_TIMEOUT_MS } = require('./config.js');

const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 2000;
const MAX_RETRY_AFTER_MS = 30000;

/** 403 reasons that mean "slow down", not "you may not". */
const THROTTLE_REASONS = new Set([
    'rateLimitExceeded',
    'userRateLimitExceeded',
    'backendError',
    'quotaExceeded',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Google's error envelope: `{ error: { code, message, errors: [{ reason, message }] } }`. */
const googleError = (data) => {
    if (!data || typeof data !== 'object') return {};
    const err = data.error;
    if (!err) return {};
    if (typeof err === 'string') return { message: err };
    const first = Array.isArray(err.errors) && err.errors.length ? err.errors[0] : {};
    return { message: err.message || first.message, reason: first.reason || err.status };
};

/** Whether a failure is worth retrying rather than surfacing. */
const isThrottled = (error) => {
    const status = error.response?.status;
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    if (status === 403) return THROTTLE_REASONS.has(googleError(error.response?.data).reason);
    return false;
};

const toApiError = (error, context) => {
    if (error instanceof ApiError) return error;

    if (error.response) {
        const status = error.response.status;
        const { message, reason } = googleError(error.response.data);
        const detail = [message, reason && `(${reason})`].filter(Boolean).join(' ') || error.message;

        logger.error(new ApiError(status, `${context}: ${detail}`), { status, reason });

        if (status === 404) return new ApiError(404, `${context}: not found in Gmail`);
        if (status === 401) {
            return new ApiError(401, `${context}: Gmail rejected the credentials (${detail})`);
        }
        if (status === 403) {
            return new ApiError(403, `${context}: Gmail refused the request (${detail})`);
        }
        return new ApiError(status >= 400 && status < 600 ? status : 502, `${context}: ${detail}`);
    }

    if (error.request) {
        const why = error.code ? ` (${error.code})` : '';
        logger.error(new ApiError(504, `${context}: no response received from Gmail${why}`));
        return new ApiError(504, `${context}: no response received from Gmail${why}`);
    }

    logger.error(new ApiError(500, `${context}: ${error.message}`));
    return new ApiError(500, `${context}: ${error.message}`);
};

/** Retry-After in seconds or as an HTTP date, bounded; exponential when absent. */
const retryDelayMs = (headers, attempt) => {
    const raw = headers && (headers['retry-after'] || headers['Retry-After']);
    if (raw) {
        const seconds = Number(raw);
        if (Number.isFinite(seconds)) {
            return Math.min(Math.max(seconds, 1) * 1000, MAX_RETRY_AFTER_MS);
        }
        const at = Date.parse(raw);
        if (!Number.isNaN(at)) {
            return Math.min(Math.max(at - Date.now(), 1000), MAX_RETRY_AFTER_MS);
        }
    }
    // Jittered exponential, so parallel workers hitting the same limit do not all wake
    // together and immediately re-trip it.
    const backoff = DEFAULT_RETRY_AFTER_MS * (2 ** (attempt - 1));
    return Math.min(backoff + Math.floor(Math.random() * 500), MAX_RETRY_AFTER_MS);
};

/**
 * Issue one request against the Gmail API.
 *
 * @param {object}  options
 * @param {string}  [options.method='GET']
 * @param {string}  options.path              below API_BASE, from PATHS
 * @param {object}  [options.params]
 * @param {object}  [options.data]
 * @param {number}  [options.timeout]
 * @param {string}  [options.responseType]    'arraybuffer' for attachment bytes
 * @param {string}  [options.context]         phrase used in error messages
 */
const gmailRequest = async ({
    method = 'GET',
    path,
    params,
    data,
    timeout,
    responseType,
    context = 'Gmail request',
}) => {
    const url = `${API_BASE}${path}`;

    let triedTokenRefresh = false;
    let attempts = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const accessToken = await getAccessToken({ forceRefresh: triedTokenRefresh });

        try {
            const response = await axios({
                method,
                url,
                params,
                data,
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/json',
                    ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
                },
                timeout: timeout || REQUEST_TIMEOUT_MS,
                ...(responseType ? { responseType } : {}),
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            });

            return response.data;
        } catch (error) {
            const status = error.response?.status;

            // The cached token may have been revoked or rotated out from under us.
            // Replay exactly once with a freshly minted one.
            if (status === 401 && !triedTokenRefresh) {
                triedTokenRefresh = true;
                await invalidateAccessToken();
                logger.warn(`[GmailClient] 401 on ${method} ${path} — refreshing token and retrying once`);
                continue;
            }

            if (isThrottled(error) && attempts < MAX_RATE_LIMIT_RETRIES) {
                attempts += 1;
                const waitMs = retryDelayMs(error.response?.headers, attempts);
                logger.warn(
                    `[GmailClient] ${status} on ${method} ${path} — retry ${attempts}/${MAX_RATE_LIMIT_RETRIES} in ${waitMs}ms`
                );
                await sleep(waitMs);
                continue;
            }

            throw toApiError(error, context);
        }
    }
};

/** The mailbox's own address and current historyId. Also the connect-time identity check. */
const getProfile = async () => gmailRequest({
    path: PATHS.profile(),
    context: 'Gmail profile lookup',
});

/**
 * getProfile using a token we already hold, bypassing the cache and the connection.
 *
 * Needed during connect: the identity guard has to run BEFORE the connection is
 * persisted, so there is nothing for getAccessToken to read yet.
 */
const getProfileWithToken = async (accessToken) => {
    const response = await axios.get(`${API_BASE}${PATHS.profile()}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
    });
    return response.data;
};

/**
 * One page of history since `startHistoryId`.
 *
 * Note this is NOT filtered by label even though the watch is: the watch decides when
 * Google pings us, history decides what we then see. Filtering here would hide the
 * admin's own SENT replies from a poll-triggered run.
 */
const listHistory = async ({ startHistoryId, pageToken, maxResults }) => gmailRequest({
    path: PATHS.history(),
    params: {
        startHistoryId: String(startHistoryId),
        ...(pageToken ? { pageToken } : {}),
        ...(maxResults ? { maxResults } : {}),
        historyTypes: 'messageAdded',
    },
    context: 'Gmail history list',
});

/** One message. `format: 'full'` returns the parsed payload tree plus headers. */
const getMessage = async (messageId, { format = 'full' } = {}) => gmailRequest({
    path: PATHS.message(messageId),
    params: { format },
    context: `Gmail message ${messageId}`,
});

/** Recent message ids, used by backfill when the cursor has expired. */
const listMessages = async ({ q, maxResults = 100, pageToken } = {}) => gmailRequest({
    path: PATHS.messages(),
    params: { ...(q ? { q } : {}), maxResults, ...(pageToken ? { pageToken } : {}) },
    context: 'Gmail message list',
});

/** Attachment bytes, base64url-encoded in `data`. Never stored — streamed on demand. */
const getAttachment = async (messageId, attachmentId) => gmailRequest({
    path: PATHS.attachment(messageId, attachmentId),
    // Attachments can be tens of megabytes and are slower than any JSON read here.
    timeout: 60000,
    context: 'Gmail attachment',
});

/** Start or renew the push watch. Returns `{ historyId, expiration }`. */
const watch = async ({ topicName, labelIds }) => gmailRequest({
    method: 'POST',
    path: PATHS.watch(),
    data: { topicName, labelIds, labelFilterBehavior: 'include' },
    context: 'Gmail watch',
});

const stopWatch = async () => gmailRequest({
    method: 'POST',
    path: PATHS.stopWatch(),
    context: 'Gmail stop watch',
});

/** Send a message. `raw` is base64url RFC822. `threadId` keeps it in the conversation. */
const sendMessage = async ({ raw, threadId }) => gmailRequest({
    method: 'POST',
    path: PATHS.send(),
    data: { raw, ...(threadId ? { threadId } : {}) },
    context: 'Gmail send',
});

/**
 * File a message into the mailbox WITHOUT transmitting it.
 *
 * CURRENTLY UNUSED, and kept deliberately. Client portal messages were filed this way
 * so the Gmail record could keep `From: <the client>` — faithful, but an inserted
 * message is synthetic, so Gmail raises no new-mail notification and the admin was
 * never told a client had written. They are sent for real now, with `Reply-To` carrying
 * the client's address (see GmailSendService).
 *
 * Retained because the scope grants it and it is the only way to add a message to a
 * mailbox without delivery — worth having if an import or migration ever needs it.
 */
const insertMessage = async ({ raw, threadId, labelIds = ['INBOX'] }) => gmailRequest({
    method: 'POST',
    path: PATHS.insert(),
    params: { internalDateSource: 'dateHeader' },
    data: { raw, labelIds, ...(threadId ? { threadId } : {}) },
    context: 'Gmail insert',
});

module.exports = {
    gmailRequest,
    getProfile,
    getProfileWithToken,
    listHistory,
    getMessage,
    listMessages,
    getAttachment,
    watch,
    stopWatch,
    sendMessage,
    insertMessage,
    // exported for tests
    isThrottled,
    googleError,
};

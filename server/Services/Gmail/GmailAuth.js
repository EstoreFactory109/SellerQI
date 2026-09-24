/**
 * GmailAuth.js — OAuth for the one shared ESF inbox.
 *
 * A transliteration of Services/Zoho/ZohoAuth.js, which is already proven here: env-held
 * client id/secret, refresh token in Mongo, access token written through to
 * utils/authCache.js so every worker and request reuses one rather than re-minting.
 *
 * Google's token endpoint is simpler than Zoho's in one respect — failures are honest
 * 4xx responses rather than 200-with-an-error-key — and harder in another: the refresh
 * token is issued ONCE, on first consent, and subsequent consents return none unless
 * `prompt=consent` forces reissue.
 */

const axios = require('axios');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const authCache = require('../../utils/authCache.js');
const GmailConnection = require('../../models/system/GmailConnectionModel.js');
const {
    getCredentials,
    SCOPES,
    AUTH_ENDPOINT,
    TOKEN_ENDPOINT,
    REVOKE_ENDPOINT,
    TOKEN_REQUEST_TIMEOUT_MS,
} = require('./config.js');

const SINGLETON_KEY = GmailConnection.SINGLETON_KEY;
const CACHE_KIND = 'gmail';

/** Fail with the variable names rather than sending Google `undefined`. */
const requireCredentials = () => {
    const credentials = getCredentials();
    const missing = ['clientId', 'clientSecret', 'redirectUri', 'inboxAddress']
        .filter((key) => !credentials[key]);

    if (missing.length > 0) {
        const names = missing.map((key) => `GMAIL_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
        const error = new ApiError(500, `Gmail credentials are missing from environment variables: ${names.join(', ')}`);
        logger.error(error);
        throw error;
    }

    return credentials;
};

/** Read the singleton. `withSecret` opts into the select:false refreshToken. */
const getConnection = async (withSecret = false) => {
    const query = GmailConnection.findOne({ key: SINGLETON_KEY });
    if (withSecret) query.select('+refreshToken');
    return query.exec();
};

/**
 * Build the consent URL the admin opens in a browser.
 *
 * `access_type=offline` and `prompt=consent` are BOTH mandatory. Without them Google
 * returns an access token and no refresh token — which looks like a successful connect
 * until it stops working an hour later, with nothing in the logs to say why.
 */
const buildAuthorizationUrl = (state) => {
    const { clientId, redirectUri } = requireCredentials();

    if (!state) {
        const error = new ApiError(500, 'Gmail authorization state is required');
        logger.error(error);
        throw error;
    }

    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    // Narrows the account chooser to the shared inbox, so an admin signed into a
    // personal account does not sleepwalk into connecting it. The identity guard in the
    // callback is the real defence; this only makes the mistake less likely.
    url.searchParams.set('login_hint', getCredentials().inboxAddress);
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);

    return url.toString();
};

/** Map Google's OAuth error codes onto statuses that point at the actual fix. */
const mapTokenError = (code, fallbackMessage, httpStatus) => {
    switch (code) {
        case 'invalid_grant':
            return new ApiError(
                401,
                'Gmail refresh token is invalid, expired or revoked. If the OAuth app is still in '
                + '"Testing" publishing status, Google expires refresh tokens after 7 days — set it '
                + 'to "In production" and reconnect.'
            );
        case 'invalid_client':
            return new ApiError(401, 'Gmail client credentials are invalid. Check GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET.');
        case 'redirect_uri_mismatch':
            return new ApiError(400, 'Gmail redirect URI does not match the one registered in the Google Cloud console.');
        case 'invalid_scope':
            return new ApiError(400, 'One or more requested Gmail scopes are invalid.');
        case 'access_denied':
            return new ApiError(403, 'Consent was declined for the Gmail connection.');
        default:
            return new ApiError(httpStatus || 500, fallbackMessage || 'Gmail token request failed');
    }
};

const postToken = async (params) => {
    let response;
    try {
        response = await axios.post(TOKEN_ENDPOINT, new URLSearchParams(params), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            // Explicit: axios has no default timeout, and a socket that connects but
            // never answers would hang a worker forever.
            timeout: TOKEN_REQUEST_TIMEOUT_MS,
        });
    } catch (error) {
        error.gmailTokenUrl = TOKEN_ENDPOINT;
        throw error;
    }

    if (!response || !response.data) {
        throw new ApiError(502, 'No response body received from the Google token endpoint');
    }
    return response.data;
};

const normaliseTokenError = (error, context) => {
    if (error instanceof ApiError) return error;

    if (error.response) {
        const status = error.response.status;
        const data = error.response.data || {};
        const message = data.error_description || data.error || error.message;
        logger.error(new ApiError(status, `${context}: ${message}`), { status, googleError: data.error });
        return mapTokenError(data.error, `${context}: ${message}`, status);
    }

    if (error.request) {
        // The transport code is the entire diagnosis — ENOTFOUND vs ECONNREFUSED vs
        // ECONNABORTED point at three different problems, and "no response received"
        // alone is unactionable. This was a real dead end on the Zoho connect flow.
        const why = error.code ? ` (${error.code}: ${error.message})` : '';
        const message = `${context}: no response received from Google${why}`;
        logger.error(new ApiError(504, message), { code: error.code });
        return new ApiError(504, message);
    }

    logger.error(new ApiError(500, `${context}: ${error.message}`));
    return new ApiError(500, `${context}: ${error.message}`);
};

/**
 * Exchange the one-time code, verify the mailbox is the one we expect, and persist.
 *
 * @param {object} args
 * @param {string} args.code
 * @param {string} [args.connectedBy]
 * @param {function} args.fetchProfile  called with the fresh access token; returns
 *   `{ emailAddress, historyId }`. Injected rather than imported so this module does not
 *   depend on GmailClient, which depends on this one.
 */
const exchangeAuthorizationCode = async ({ code, connectedBy, fetchProfile }) => {
    const { clientId, clientSecret, redirectUri, inboxAddress } = requireCredentials();

    if (!code) {
        const error = new ApiError(400, 'Gmail authorization code is missing');
        logger.error(error);
        throw error;
    }

    let data;
    try {
        data = await postToken({
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
        });
    } catch (error) {
        throw normaliseTokenError(error, 'Gmail authorization code exchange failed');
    }

    if (!data.refresh_token) {
        // Almost always access_type/prompt dropped from the consent URL, or this account
        // has consented before and Google reissued without one.
        const error = new ApiError(
            502,
            'Google did not return a refresh token. Remove the app under myaccount.google.com > '
            + 'Third-party access and reconnect.'
        );
        logger.error(error);
        throw error;
    }

    /**
     * ── THE IDENTITY GUARD ──
     * Runs BEFORE anything is written, and the token is discarded if it fails.
     *
     * Without it, an admin already signed into a personal Google account in the same
     * browser connects their own mailbox with one click. Nothing would look wrong: the
     * connect flow succeeds, ingestion starts, and their private mail begins appearing
     * on a page other staff can read. Not hypothetical — the account chooser defaults
     * to whichever account is already signed in.
     */
    let profile;
    try {
        profile = await fetchProfile(data.access_token);
    } catch (error) {
        throw new ApiError(502, `Gmail connected but the mailbox could not be identified: ${error.message}`);
    }

    const connectedAddress = String(profile?.emailAddress || '').trim().toLowerCase();
    if (!connectedAddress || connectedAddress !== inboxAddress) {
        logger.error(new ApiError(403, `[GmailAuth] refused a connection to ${connectedAddress || 'an unknown mailbox'}`));
        throw new ApiError(
            403,
            `That Google account (${connectedAddress || 'unknown'}) is not the shared ESF inbox. `
            + `Expected ${inboxAddress}. Sign out of other Google accounts and try again.`
        );
    }

    const connection = await GmailConnection.findOneAndUpdate(
        { key: SINGLETON_KEY },
        {
            $set: {
                refreshToken: data.refresh_token,
                emailAddress: connectedAddress,
                scopes: SCOPES,
                connectedBy: connectedBy || null,
                connectedAt: new Date(),
                lastRefreshAt: new Date(),
                lastError: null,
                lastErrorAt: null,
                /**
                 * Baseline the cursor at the mailbox's CURRENT historyId.
                 *
                 * Deliberately not null and not zero: starting from zero asks Gmail to
                 * replay the mailbox's entire history, which for a years-old agency
                 * inbox means ingesting every message ever received, redacting each one
                 * through the AI, and filling the client pages with archaeology.
                 * Backfill of recent mail is a separate, explicit operation.
                 */
                historyId: profile.historyId ? String(profile.historyId) : null,
            },
            // A reconnect may be a different mailbox; a stale watch would be for the old one.
            $unset: { watchExpiration: '', watchTopic: '' },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await authCache.setToken(CACHE_KIND, data.refresh_token, data.access_token);
    logger.info(`[GmailAuth] Connected the shared inbox (${connectedAddress})`);

    return { connection, accessToken: data.access_token };
};

/**
 * A valid access token, minted only if the cache is cold.
 *
 * Keyed by a hash of the refresh token, so a reconnect naturally produces a new key and
 * can never serve a token belonging to the previous connection.
 */
const getAccessToken = async ({ forceRefresh = false } = {}) => {
    const { clientId, clientSecret } = requireCredentials();

    const connection = await getConnection(true);
    if (!connection || !connection.refreshToken) {
        const error = new ApiError(428, 'The ESF inbox is not connected. Run the admin connect flow first.');
        logger.error(error);
        throw error;
    }

    const refreshToken = connection.refreshToken;

    if (!forceRefresh) {
        const cached = await authCache.getToken(CACHE_KIND, refreshToken);
        if (cached) return cached;
    }

    try {
        const data = await postToken({
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
        });

        if (!data.access_token) {
            throw new ApiError(502, 'Gmail token refresh succeeded but returned no access token');
        }

        await authCache.setToken(CACHE_KIND, refreshToken, data.access_token);
        await GmailConnection.updateOne(
            { key: SINGLETON_KEY },
            { $set: { lastRefreshAt: new Date(), lastError: null, lastErrorAt: null } }
        ).catch((err) => logger.warn(`[GmailAuth] Failed to stamp lastRefreshAt (non-fatal): ${err.message}`));

        return data.access_token;
    } catch (error) {
        const apiError = normaliseTokenError(error, 'Gmail access token refresh failed');

        // A dead refresh token must not leave a usable-looking cache entry behind, and
        // /status has to be able to say what happened without a log dive.
        if (apiError.statusCode === 401) {
            await authCache.invalidateToken(CACHE_KIND, refreshToken);
            await GmailConnection.updateOne(
                { key: SINGLETON_KEY },
                { $set: { lastError: apiError.message, lastErrorAt: new Date() } }
            ).catch(() => {});
        }

        throw apiError;
    }
};

/** Drop the cached access token — used by the client's 401 replay. */
const invalidateAccessToken = async () => {
    const connection = await getConnection(true);
    if (connection?.refreshToken) {
        await authCache.invalidateToken(CACHE_KIND, connection.refreshToken);
    }
};

/**
 * Forget the connection, and ask Google to revoke the grant.
 *
 * Revocation is attempted but never fatal: if Google is unreachable we still want the
 * local credential gone, because the alternative is a "disconnect" that silently left a
 * working token in our database.
 */
const disconnect = async () => {
    const connection = await getConnection(true);
    if (!connection) return false;

    if (connection.refreshToken) {
        await authCache.invalidateToken(CACHE_KIND, connection.refreshToken);
        await axios.post(REVOKE_ENDPOINT, new URLSearchParams({ token: connection.refreshToken }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: TOKEN_REQUEST_TIMEOUT_MS,
        }).catch((err) => logger.warn(`[GmailAuth] Revoke at Google failed (non-fatal): ${err.message}`));
    }

    await GmailConnection.deleteOne({ key: SINGLETON_KEY });
    logger.info('[GmailAuth] Gmail connection removed');
    return true;
};

module.exports = {
    buildAuthorizationUrl,
    exchangeAuthorizationCode,
    getAccessToken,
    invalidateAccessToken,
    getConnection,
    disconnect,
    requireCredentials,
    CACHE_KIND,
};

/**
 * DriveAuth.js — OAuth for the one Google Drive ESF report PDFs are saved to.
 *
 * The same flow as Services/Gmail/GmailAuth.js (itself a copy of ZohoAuth.js): env-held
 * client id/secret, refresh token in Mongo, access token cached through utils/authCache.js
 * so every run reuses one rather than minting its own.
 *
 * No identity guard like Gmail's: any ESF Google account may hold the archive. The
 * connected address is stored and shown on the portal card instead.
 */

const axios = require('axios');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const authCache = require('../../utils/authCache.js');
const DriveConnection = require('../../models/system/DriveConnectionModel.js');
const {
    getCredentials,
    SCOPES,
    AUTH_ENDPOINT,
    TOKEN_ENDPOINT,
    REVOKE_ENDPOINT,
    TOKEN_REQUEST_TIMEOUT_MS,
} = require('./config.js');

const SINGLETON_KEY = DriveConnection.SINGLETON_KEY;
const CACHE_KIND = 'gdrive';

/** In-process fallback when Redis is unavailable; same 50-minute life as authCache. */
const MEMO_TTL_MS = 50 * 60 * 1000;
const memo = { refreshToken: null, token: null, expiresAt: 0 };

/** Fail with the variable names rather than sending Google `undefined`. */
const requireCredentials = () => {
    const credentials = getCredentials();
    const missing = ['clientId', 'clientSecret', 'redirectUri'].filter((key) => !credentials[key]);
    if (missing.length) {
        const names = missing.map((key) => `GDRIVE_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
        throw new ApiError(500, `Google Drive credentials are missing from environment variables: ${names.join(', ')}`);
    }
    return credentials;
};

const getConnection = async (withSecret = false) => {
    const query = DriveConnection.findOne({ key: SINGLETON_KEY });
    if (withSecret) query.select('+refreshToken');
    return query.exec();
};

/**
 * The consent URL. `access_type=offline` and `prompt=consent` are both required, or
 * Google returns no refresh token and the connection dies an hour later.
 */
const buildAuthorizationUrl = (state) => {
    const { clientId, redirectUri } = requireCredentials();
    if (!state) throw new ApiError(500, 'Google Drive authorization state is required');

    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    return url.toString();
};

const mapTokenError = (code, fallbackMessage, httpStatus) => {
    switch (code) {
        case 'invalid_grant':
            return new ApiError(
                401,
                'Google Drive access has expired or was revoked. If the OAuth app is still in '
                + '"Testing" publishing status, Google expires it after 7 days — set it to '
                + '"In production" and reconnect.'
            );
        case 'invalid_client':
            return new ApiError(401, 'Google Drive client credentials are invalid. Check GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET.');
        case 'redirect_uri_mismatch':
            return new ApiError(400, 'GDRIVE_REDIRECT_URI does not match the one registered in the Google Cloud console.');
        case 'access_denied':
            return new ApiError(403, 'Consent was declined for the Google Drive connection.');
        default:
            return new ApiError(httpStatus || 500, fallbackMessage || 'Google Drive token request failed');
    }
};

const normaliseTokenError = (error, context) => {
    if (error instanceof ApiError) return error;
    if (error.response) {
        const data = error.response.data || {};
        const message = data.error_description || data.error || error.message;
        logger.error(`[DriveAuth] ${context}: ${message}`, { status: error.response.status, googleError: data.error });
        return mapTokenError(data.error, `${context}: ${message}`, error.response.status);
    }
    if (error.request) {
        const why = error.code ? ` (${error.code}: ${error.message})` : '';
        return new ApiError(504, `${context}: no response received from Google${why}`);
    }
    return new ApiError(500, `${context}: ${error.message}`);
};

const postToken = async (params) => {
    const response = await axios.post(TOKEN_ENDPOINT, new URLSearchParams(params), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: TOKEN_REQUEST_TIMEOUT_MS,
    });
    if (!response?.data) throw new ApiError(502, 'No response body received from the Google token endpoint');
    return response.data;
};

/**
 * Exchange the one-time code and persist the connection.
 *
 * @param {object} args
 * @param {string} args.code
 * @param {string} [args.connectedBy]
 * @param {function} args.fetchAccount  called with the fresh access token; returns
 *   `{ emailAddress }`. Injected so this module does not import DriveClient, which imports it.
 */
const exchangeAuthorizationCode = async ({ code, connectedBy, fetchAccount }) => {
    const { clientId, clientSecret, redirectUri } = requireCredentials();
    if (!code) throw new ApiError(400, 'Google Drive authorization code is missing');

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
        throw normaliseTokenError(error, 'Google Drive authorization code exchange failed');
    }

    if (!data.refresh_token) {
        throw new ApiError(
            502,
            'Google did not return a refresh token. Remove SellerQI under myaccount.google.com > '
            + 'Third-party access and reconnect.'
        );
    }

    let emailAddress = null;
    try {
        emailAddress = String((await fetchAccount(data.access_token))?.emailAddress || '').trim().toLowerCase() || null;
    } catch (error) {
        // Only used for display; the connection works without it.
        logger.warn(`[DriveAuth] connected, but the account address could not be read: ${error.message}`);
    }

    const previous = await DriveConnection.findOne({ key: SINGLETON_KEY }).lean();
    const sameAccount = previous && emailAddress && previous.emailAddress === emailAddress;

    const connection = await DriveConnection.findOneAndUpdate(
        { key: SINGLETON_KEY },
        {
            $set: {
                refreshToken: data.refresh_token,
                emailAddress,
                scopes: SCOPES,
                connectedBy: connectedBy || null,
                connectedAt: new Date(),
                lastRefreshAt: new Date(),
                lastError: null,
                lastErrorAt: null,
                // Another account's Drive has none of the old folders.
                ...(sameAccount ? {} : { rootFolderId: null }),
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await authCache.setToken(CACHE_KIND, data.refresh_token, data.access_token);
    logger.info(`[DriveAuth] Google Drive connected (${emailAddress || 'address unknown'})`);
    return { connection, accessToken: data.access_token };
};

/** A valid access token, minted only when the cache is cold. */
const getAccessToken = async ({ forceRefresh = false } = {}) => {
    const { clientId, clientSecret } = requireCredentials();

    const connection = await getConnection(true);
    if (!connection?.refreshToken) {
        throw new ApiError(428, 'Google Drive is not connected. Connect it on the Estore Factory > Google Drive page.');
    }
    const refreshToken = connection.refreshToken;

    if (!forceRefresh) {
        const cached = await authCache.getToken(CACHE_KIND, refreshToken);
        if (cached) return cached;
        // The manual runner (esfReportsMailerStandalone --run) has no Redis, so without this
        // every Drive request would mint its own token.
        if (memo.refreshToken === refreshToken && memo.expiresAt > Date.now()) return memo.token;
    }

    try {
        const data = await postToken({
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
        });
        if (!data.access_token) throw new ApiError(502, 'Google Drive token refresh returned no access token');

        await authCache.setToken(CACHE_KIND, refreshToken, data.access_token);
        Object.assign(memo, { refreshToken, token: data.access_token, expiresAt: Date.now() + MEMO_TTL_MS });
        await DriveConnection.updateOne(
            { key: SINGLETON_KEY },
            { $set: { lastRefreshAt: new Date() } }
        ).catch((err) => logger.warn(`[DriveAuth] could not stamp lastRefreshAt: ${err.message}`));
        return data.access_token;
    } catch (error) {
        const apiError = normaliseTokenError(error, 'Google Drive access token refresh failed');
        if (apiError.statusCode === 401) {
            await authCache.invalidateToken(CACHE_KIND, refreshToken);
            await DriveConnection.updateOne(
                { key: SINGLETON_KEY },
                { $set: { lastError: apiError.message, lastErrorAt: new Date() } }
            ).catch(() => {});
        }
        throw apiError;
    }
};

const invalidateAccessToken = async () => {
    memo.expiresAt = 0;
    const connection = await getConnection(true);
    if (connection?.refreshToken) await authCache.invalidateToken(CACHE_KIND, connection.refreshToken);
};

/**
 * Forget the connection and revoke it at Google. The files already in Drive stay — they
 * belong to the ESF account, not to SellerQI.
 */
const disconnect = async () => {
    const connection = await getConnection(true);
    if (!connection) return false;

    if (connection.refreshToken) {
        await authCache.invalidateToken(CACHE_KIND, connection.refreshToken);
        await axios.post(REVOKE_ENDPOINT, new URLSearchParams({ token: connection.refreshToken }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: TOKEN_REQUEST_TIMEOUT_MS,
        }).catch((err) => logger.warn(`[DriveAuth] revoke at Google failed (non-fatal): ${err.message}`));
    }

    await DriveConnection.deleteOne({ key: SINGLETON_KEY });
    logger.info('[DriveAuth] Google Drive connection removed');
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

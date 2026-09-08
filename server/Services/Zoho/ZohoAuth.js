/**
 * ZohoAuth.js — OAuth for the org-wide Zoho Projects connection.
 *
 * Modelled on Services/AmazonAds/GenerateToken.js: env-held client id/secret, a
 * form-encoded refresh_token grant, and write-through into utils/authCache.js.
 *
 * The one structural difference from the Amazon flow: there is a single connection for
 * the whole org, stored in models/system/ZohoConnectionModel.js, so there is no userId
 * threaded through any of this.
 */

const axios = require('axios');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const authCache = require('../../utils/authCache.js');
const ZohoConnection = require('../../models/system/ZohoConnectionModel.js');
const {
    getCredentials,
    SCOPES,
    TOKEN_REQUEST_TIMEOUT_MS,
    DEFAULT_ACCOUNTS_DOMAIN,
    DEFAULT_API_DOMAIN
} = require('./config.js');

const SINGLETON_KEY = ZohoConnection.SINGLETON_KEY;
const CACHE_KIND = 'zoho';

/**
 * Zoho's per-datacenter domains. The consent redirect comes back with `location` (a
 * two-letter DC code) and `accounts-server` (the full accounts host) — we trust
 * accounts-server when present and fall back to this table.
 */
const DC_ACCOUNTS_DOMAIN = {
    us: 'https://accounts.zoho.com',
    eu: 'https://accounts.zoho.eu',
    in: 'https://accounts.zoho.in',
    au: 'https://accounts.zoho.com.au',
    jp: 'https://accounts.zoho.jp',
    ca: 'https://accounts.zohocloud.ca',
    uk: 'https://accounts.zoho.uk',
    sa: 'https://accounts.zoho.sa'
};

const DC_PROJECTS_DOMAIN = {
    us: 'https://projectsapi.zoho.com',
    eu: 'https://projectsapi.zoho.eu',
    in: 'https://projectsapi.zoho.in',
    au: 'https://projectsapi.zoho.com.au',
    jp: 'https://projectsapi.zoho.jp',
    ca: 'https://projectsapi.zohocloud.ca',
    uk: 'https://projectsapi.zoho.uk',
    sa: 'https://projectsapi.zoho.sa'
};

/** Throws a 500 ApiError if the app was never configured, rather than sending Zoho `undefined`. */
const requireCredentials = () => {
    const credentials = getCredentials();
    const missing = ['clientId', 'clientSecret', 'redirectUri'].filter((k) => !credentials[k]);

    if (missing.length > 0) {
        const names = missing.map((k) => `ZOHO_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
        const error = new ApiError(500, `Zoho credentials are missing from environment variables: ${names.join(', ')}`);
        logger.error(error);
        throw error;
    }

    return credentials;
};

/**
 * Read the singleton connection. `withSecret` opts into the select:false refreshToken.
 * Returns null when Zoho has never been connected.
 */
const getConnection = async (withSecret = false) => {
    const query = ZohoConnection.findOne({ key: SINGLETON_KEY });
    if (withSecret) {
        query.select('+refreshToken');
    }
    return query.exec();
};

/**
 * Build the consent URL the admin opens in a browser.
 *
 * access_type=offline and prompt=consent are BOTH required. Without them Zoho returns an
 * access token and no refresh token, which looks like success until the first token
 * expiry an hour later.
 */
const buildAuthorizationUrl = (state) => {
    const { clientId, redirectUri, accountsDomain } = requireCredentials();

    if (!state) {
        const error = new ApiError(500, 'Zoho authorization state is required');
        logger.error(error);
        throw error;
    }

    const url = new URL(`${accountsDomain}/oauth/v2/auth`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', SCOPES.join(','));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);

    return url.toString();
};

/**
 * Turn an axios failure from the Zoho token endpoint into an ApiError with a useful status.
 * Zoho reports OAuth failures as HTTP 200 with an `error` key as often as it does 4xx,
 * so both paths funnel through here.
 */
const mapTokenError = (zohoErrorCode, fallbackMessage, httpStatus) => {
    switch (zohoErrorCode) {
        case 'invalid_code':
            return new ApiError(400, 'Zoho authorization code is invalid or already used. Restart the connect flow.');
        case 'invalid_client':
            return new ApiError(401, 'Zoho client credentials are invalid. Check ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET.');
        case 'invalid_client_secret':
            return new ApiError(401, 'Zoho client secret is invalid. Check ZOHO_CLIENT_SECRET.');
        case 'unauthorized_client':
            return new ApiError(403, 'Zoho client is not authorized for the requested grant type.');
        case 'invalid_redirect_uri':
            return new ApiError(400, 'Zoho redirect URI does not match the one registered at api-console.zoho.com.');
        case 'invalid_scope':
            return new ApiError(400, 'One or more requested Zoho scopes are invalid.');
        case 'invalid_grant':
            return new ApiError(401, 'Zoho refresh token is invalid, expired, or revoked. Reconnect the Zoho account.');
        default:
            return new ApiError(httpStatus || 500, fallbackMessage || 'Zoho token request failed');
    }
};

/** POST to the Zoho token endpoint. Shared by the auth-code and refresh-token grants. */
const postToken = async (accountsDomain, params) => {
    const response = await axios.post(
        `${accountsDomain}/oauth/v2/token`,
        new URLSearchParams(params),
        {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            // Explicit timeout: axios has no default, and a socket that connects but never
            // responds would hang this request forever. The same omission previously froze
            // the daily pipeline for hours (see Services/AmazonAds/GenerateToken.js).
            timeout: TOKEN_REQUEST_TIMEOUT_MS
        }
    );

    if (!response || !response.data) {
        throw new ApiError(500, 'No response body received from the Zoho token endpoint');
    }

    // Zoho signals OAuth failures inside a 200 response body.
    if (response.data.error) {
        throw mapTokenError(response.data.error, response.data.error_description || response.data.error, 400);
    }

    return response.data;
};

/** Normalise an axios/ApiError into an ApiError, mapping Zoho's error codes where present. */
const normaliseTokenError = (error, context) => {
    if (error instanceof ApiError) {
        return error;
    }

    if (error.response) {
        const status = error.response.status;
        const data = error.response.data || {};
        const message = data.error_description || data.error || error.message;
        logger.error(new ApiError(status, `${context}: ${message}`), { status, zohoError: data.error });
        return mapTokenError(data.error, `${context}: ${message}`, status);
    }

    if (error.request) {
        logger.error(new ApiError(504, `${context}: no response received from Zoho`));
        return new ApiError(504, `${context}: no response received from Zoho`);
    }

    logger.error(new ApiError(500, `${context}: ${error.message}`));
    return new ApiError(500, `${context}: ${error.message}`);
};

/**
 * Exchange the one-time authorization code for a refresh token and persist the connection.
 *
 * `location` and `accountsServer` come from Zoho's redirect query string and pin the data
 * center — a token minted on the EU DC is rejected by the US API host, so getting these
 * wrong produces confusing 401s on every subsequent call.
 */
const exchangeAuthorizationCode = async ({ code, location, accountsServer, connectedBy }) => {
    const { clientId, clientSecret, redirectUri, accountsDomain: configuredAccounts, apiDomain: configuredApi } =
        requireCredentials();

    if (!code) {
        const error = new ApiError(400, 'Zoho authorization code is missing');
        logger.error(error);
        throw error;
    }

    const dc = (location || '').toLowerCase();
    const accountsDomain = accountsServer || DC_ACCOUNTS_DOMAIN[dc] || configuredAccounts || DEFAULT_ACCOUNTS_DOMAIN;

    try {
        const data = await postToken(accountsDomain, {
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code
        });

        if (!data.refresh_token) {
            // Almost always means access_type=offline / prompt=consent were dropped from
            // the consent URL, or this account has already consented and Zoho reissued
            // without a refresh token.
            const error = new ApiError(
                502,
                'Zoho did not return a refresh token. Revoke the app under Zoho Accounts > Connected Apps and reconnect.'
            );
            logger.error(error);
            throw error;
        }

        // Zoho's api_domain points at the generic zohoapis host; Projects has its own
        // host, so derive it from the DC and only fall back to configuration.
        const apiDomain = DC_PROJECTS_DOMAIN[dc] || configuredApi || DEFAULT_API_DOMAIN;

        const connection = await ZohoConnection.findOneAndUpdate(
            { key: SINGLETON_KEY },
            {
                $set: {
                    refreshToken: data.refresh_token,
                    apiDomain,
                    accountsDomain,
                    scopes: SCOPES,
                    connectedBy: connectedBy || null,
                    connectedAt: new Date(),
                    lastRefreshAt: new Date(),
                    lastError: null
                },
                // Clear the portal from any prior connection — it may belong to a
                // different Zoho account and would otherwise silently persist.
                $unset: { portalId: '', portalName: '' }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // A brand-new refresh token invalidates anything cached against the old one.
        await authCache.setToken(CACHE_KIND, data.refresh_token, data.access_token);

        logger.info(`[ZohoAuth] Connected Zoho Projects (dc=${dc || 'us'}, apiDomain=${apiDomain})`);

        return { connection, accessToken: data.access_token };
    } catch (error) {
        throw normaliseTokenError(error, 'Zoho authorization code exchange failed');
    }
};

/**
 * Return a valid access token for the org connection, minting one if the cache is cold.
 *
 * The cache is shared Redis with a 3000s TTL — comfortably under Zoho's 3600s expiry —
 * and is keyed by a hash of the refresh token, so a reconnect naturally produces a new
 * key and can never serve a token from the previous connection.
 */
const getAccessToken = async ({ forceRefresh = false } = {}) => {
    const { clientId, clientSecret } = requireCredentials();

    const connection = await getConnection(true);
    if (!connection || !connection.refreshToken) {
        const error = new ApiError(428, 'Zoho Projects is not connected. Run the admin connect flow first.');
        logger.error(error);
        throw error;
    }

    const refreshToken = connection.refreshToken;

    if (!forceRefresh) {
        const cached = await authCache.getToken(CACHE_KIND, refreshToken);
        if (cached) {
            return cached;
        }
    }

    try {
        const data = await postToken(connection.accountsDomain || DEFAULT_ACCOUNTS_DOMAIN, {
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken
        });

        if (!data.access_token) {
            throw new ApiError(502, 'Zoho token refresh succeeded but returned no access token');
        }

        // Write-through so every later phase/request reuses this token instead of
        // re-minting, and so a refreshed token always overwrites a stale cached entry.
        await authCache.setToken(CACHE_KIND, refreshToken, data.access_token);

        await ZohoConnection.updateOne(
            { key: SINGLETON_KEY },
            { $set: { lastRefreshAt: new Date(), lastError: null } }
        ).catch((err) => logger.warn(`[ZohoAuth] Failed to stamp lastRefreshAt (non-fatal): ${err.message}`));

        return data.access_token;
    } catch (error) {
        const apiError = normaliseTokenError(error, 'Zoho access token refresh failed');

        // A dead refresh token must not leave a usable-looking cache entry behind, and
        // /status should be able to explain the breakage without a log dive.
        if (apiError.statusCode === 401) {
            await authCache.invalidateToken(CACHE_KIND, refreshToken);
            await ZohoConnection.updateOne(
                { key: SINGLETON_KEY },
                { $set: { lastError: apiError.message } }
            ).catch(() => {});
        }

        throw apiError;
    }
};

/** Drop the cached access token — used by the client's 401 retry path. */
const invalidateAccessToken = async () => {
    const connection = await getConnection(true);
    if (connection && connection.refreshToken) {
        await authCache.invalidateToken(CACHE_KIND, connection.refreshToken);
    }
};

/**
 * Forget the connection entirely. Note this does NOT revoke the grant on Zoho's side —
 * that has to be done in Zoho Accounts > Connected Apps.
 */
const disconnect = async () => {
    const connection = await getConnection(true);
    if (!connection) {
        return false;
    }

    if (connection.refreshToken) {
        await authCache.invalidateToken(CACHE_KIND, connection.refreshToken);
    }

    await ZohoConnection.deleteOne({ key: SINGLETON_KEY });
    logger.info('[ZohoAuth] Zoho Projects connection removed');
    return true;
};

module.exports = {
    buildAuthorizationUrl,
    exchangeAuthorizationCode,
    getAccessToken,
    invalidateAccessToken,
    getConnection,
    disconnect,
    CACHE_KIND
};

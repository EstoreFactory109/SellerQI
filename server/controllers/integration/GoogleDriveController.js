/**
 * GoogleDriveController.js
 *
 * The one Google Drive the ESF clients' report PDFs are saved to. Same shape as
 * GmailController.js, including the single-use Redis CSRF state on the OAuth round-trip.
 *
 *   GET    /api/gdrive/status         connection health (esfAuth)
 *   GET    /api/gdrive/auth/url       consent URL (owner/admin)
 *   GET    /api/gdrive/auth/callback  OAuth redirect target — no auth by necessity
 *   DELETE /api/gdrive/disconnect     forget the connection (owner/admin)
 */

const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const DriveAuth = require('../../Services/GoogleDrive/DriveAuth.js');
const DriveClient = require('../../Services/GoogleDrive/DriveClient.js');
const DriveConnection = require('../../models/system/DriveConnectionModel.js');
const DriveReportFolder = require('../../models/system/DriveReportFolderModel.js');
const { canManageTeam } = require('../../Services/User/esfRoles.js');
const { getCredentials, isReportsArchiveEnabled, rootFolderName } = require('../../Services/GoogleDrive/config.js');

const portalOrigin = () =>
    (process.env.ESF_PORTAL_URL || process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000')
        .replace(/\/+$/, '');

const portalRedirect = (params) =>
    `${portalOrigin()}/esf/estore-factory/google-drive?${new URLSearchParams(params).toString()}`;

const folderUrl = (id) => (id ? `https://drive.google.com/drive/folders/${id}` : null);

/** One shared company credential: the same bar as team management, as for Gmail and Zoho. */
const requireDriveManager = (req, res) => {
    if (req.esfUser?.accessType === 'superAdmin') return true;
    if (canManageTeam(req.esfUser)) return true;

    logger.warn(`ESF user ${req.esfUserId} (${req.esfRole}) attempted to change the Google Drive connection`);
    res.status(403).json(
        new ApiResponse(403, '', 'Only the portal owner and admins can change the Google Drive connection')
    );
    return false;
};

const STATE_PREFIX = 'sqi:gdrive:oauth_state:';
const STATE_TTL_SECONDS = 600;

const tryGetRedis = () => {
    try {
        const { getRedisClient } = require('../../config/redisConn.js');
        return getRedisClient();
    } catch (_) {
        return null;
    }
};

const storeState = async (state, adminId) => {
    const client = tryGetRedis();
    if (!client) throw new ApiError(503, 'Cannot start the Google Drive connect flow: state store (Redis) is unavailable');
    await client.setEx(`${STATE_PREFIX}${state}`, STATE_TTL_SECONDS, String(adminId || 'unknown'));
};

/** Consume exactly once — a replayed callback must not validate twice. */
const consumeState = async (state) => {
    const client = tryGetRedis();
    if (!client) throw new ApiError(503, 'Cannot complete the Google Drive connect flow: state store (Redis) is unavailable');
    const key = `${STATE_PREFIX}${state}`;
    const value = await client.get(key);
    if (!value) return null;
    await client.del(key);
    return value;
};

/** GET /api/gdrive/status — never returns the refresh token. */
const getDriveStatus = asyncHandler(async (req, res) => {
    const { clientId, clientSecret, redirectUri } = getCredentials();
    const base = {
        configured: Boolean(clientId && clientSecret && redirectUri),
        enabled: isReportsArchiveEnabled(),
        rootFolderName: rootFolderName(),
    };

    const connection = await DriveConnection.findOne({ key: DriveConnection.SINGLETON_KEY }).lean();
    if (!connection) {
        return res.status(200).json(new ApiResponse(200, { ...base, connected: false }, 'Google Drive is not connected'));
    }

    const clientFolders = await DriveReportFolder.countDocuments(
        connection.rootFolderId ? { rootFolderId: connection.rootFolderId } : { _id: null }
    );

    return res.status(200).json(new ApiResponse(200, {
        ...base,
        connected: true,
        emailAddress: connection.emailAddress,
        connectedAt: connection.connectedAt,
        lastRefreshAt: connection.lastRefreshAt,
        lastSavedAt: connection.lastSavedAt,
        // Only an error newer than the last save is still a problem.
        lastError: connection.lastError,
        lastErrorAt: connection.lastErrorAt,
        lastErrorCurrent: Boolean(connection.lastErrorAt
            && (!connection.lastSavedAt || new Date(connection.lastErrorAt) > new Date(connection.lastSavedAt))),
        rootFolderUrl: folderUrl(connection.rootFolderId),
        clientFolders,
    }, 'Google Drive connection status'));
});

/** GET /api/gdrive/auth/url */
const startDriveAuth = asyncHandler(async (req, res) => {
    if (!requireDriveManager(req, res)) return undefined;

    const state = crypto.randomBytes(32).toString('hex');
    await storeState(state, req.esfUserId);

    return res.status(200).json(new ApiResponse(200, {
        authorizationUrl: DriveAuth.buildAuthorizationUrl(state),
    }, 'Open this URL to connect Google Drive'));
});

/**
 * GET /api/gdrive/auth/callback
 *
 * Unauthenticated by necessity — the browser arrives from Google without our SameSite
 * cookies. The single-use state is the protection. Always redirects: a person is looking.
 */
const handleDriveCallback = asyncHandler(async (req, res) => {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
        logger.warn(`[GoogleDriveController] consent returned ${oauthError}`);
        return res.redirect(portalRedirect({ gdrive: 'error', reason: String(oauthError) }));
    }
    if (!state) return res.redirect(portalRedirect({ gdrive: 'error', reason: 'missing_state' }));

    const adminId = await consumeState(String(state));
    if (!adminId) {
        logger.warn('[GoogleDriveController] callback with an unknown or replayed state');
        return res.redirect(portalRedirect({ gdrive: 'error', reason: 'invalid_state' }));
    }

    try {
        const { connection } = await DriveAuth.exchangeAuthorizationCode({
            code: String(code || ''),
            connectedBy: adminId !== 'unknown' ? adminId : null,
            fetchAccount: DriveClient.getAboutWithToken,
        });
        return res.redirect(portalRedirect({ gdrive: 'connected', account: connection.emailAddress || '' }));
    } catch (error) {
        logger.error(`[GoogleDriveController] connect failed: ${error.message}`);
        return res.redirect(portalRedirect({ gdrive: 'error', reason: String(error.message).slice(0, 200) }));
    }
});

/** DELETE /api/gdrive/disconnect — the files already saved stay in Drive. */
const disconnectDrive = asyncHandler(async (req, res) => {
    if (!requireDriveManager(req, res)) return undefined;

    const removed = await DriveAuth.disconnect();
    return res.status(200).json(new ApiResponse(
        200,
        { removed },
        removed ? 'Google Drive has been disconnected' : 'No Google Drive connection to remove'
    ));
});

module.exports = {
    getDriveStatus,
    startDriveAuth,
    handleDriveCallback,
    disconnectDrive,
};

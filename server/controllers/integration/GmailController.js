/**
 * GmailController.js
 *
 * HTTP surface for the one shared ESF inbox connection. Modelled on
 * ZohoProjectsController.js, including the single-use Redis CSRF state — deliberately
 * not the sessionStorage approach the Amazon flow uses, which is a dead no-op there.
 *
 *   GET    /api/gmail/status        connection health (esfAuth)
 *   GET    /api/gmail/auth/url      consent URL (owner/admin)
 *   GET    /api/gmail/auth/callback OAuth redirect target — no auth by necessity
 *   DELETE /api/gmail/disconnect    forget the connection (owner/admin)
 *   POST   /api/gmail/watch         start or renew the push watch (owner/admin)
 */

const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const GmailAuth = require('../../Services/Gmail/GmailAuth.js');
const GmailClient = require('../../Services/Gmail/GmailClient.js');
const GmailConnection = require('../../models/system/GmailConnectionModel.js');
const { canManageTeam } = require('../../Services/User/esfRoles.js');
const {
    getCredentials, getPubSubConfig, isMessagingEnabled, WATCH_LABEL_IDS, getPollMinutes,
} = require('../../Services/Gmail/config.js');

const portalOrigin = () =>
    (process.env.ESF_PORTAL_URL || process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000')
        .replace(/\/+$/, '');

const portalRedirect = (params) =>
    `${portalOrigin()}/esf/messages?${new URLSearchParams(params).toString()}`;

/**
 * Connecting touches ONE shared company credential and grants read access to every
 * client conversation, so it sits at the same bar as team management. A member
 * reconnecting would silently repoint the whole inbox at a different mailbox.
 */
const requireGmailManager = (req, res) => {
    // canManageTeam resolves a missing esfRole to 'member', which would lock out a
    // platform superAdmin — the account esfAuth admits precisely so platform admins can
    // service the portal.
    if (req.esfUser?.accessType === 'superAdmin') return true;
    if (canManageTeam(req.esfUser)) return true;

    logger.warn(`ESF user ${req.esfUserId} (${req.esfRole}) attempted to change the Gmail connection`);
    res.status(403).json(
        new ApiResponse(403, '', 'Only the portal owner and admins can change the Gmail connection')
    );
    return false;
};

const STATE_PREFIX = 'sqi:gmail:oauth_state:';
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
    // An unverifiable OAuth callback is exactly what state exists to prevent, so a
    // missing state store fails the connect rather than proceeding without one.
    if (!client) throw new ApiError(503, 'Cannot start the Gmail connect flow: state store (Redis) is unavailable');
    await client.setEx(`${STATE_PREFIX}${state}`, STATE_TTL_SECONDS, String(adminId || 'unknown'));
};

/** Consume exactly once — a replayed callback must not validate twice. */
const consumeState = async (state) => {
    const client = tryGetRedis();
    if (!client) throw new ApiError(503, 'Cannot complete the Gmail connect flow: state store (Redis) is unavailable');

    const key = `${STATE_PREFIX}${state}`;
    const value = await client.get(key);
    if (!value) return null;
    await client.del(key);
    return value;
};

/**
 * GET /api/gmail/status
 *
 * Never returns the refresh token — the model marks it select:false and nothing here
 * opts in. Surfaces enough for an expired token to banner in the UI rather than mail
 * simply stopping, which is indistinguishable from "nobody emailed today".
 */
const getGmailStatus = asyncHandler(async (req, res) => {
    const connection = await GmailConnection.findOne({ key: GmailConnection.SINGLETON_KEY }).lean();
    const { inboxAddress } = getCredentials();
    const { topicName } = getPubSubConfig();

    if (!connection) {
        return res.status(200).json(new ApiResponse(200, {
            connected: false,
            messagingEnabled: isMessagingEnabled(),
            expectedInbox: inboxAddress || null,
            pushConfigured: Boolean(topicName),
        }, 'The ESF inbox is not connected'));
    }

    const watchExpiresInHours = connection.watchExpiration
        ? Math.round((new Date(connection.watchExpiration).getTime() - Date.now()) / 3600000)
        : null;

    return res.status(200).json(new ApiResponse(200, {
        connected: true,
        messagingEnabled: isMessagingEnabled(),
        inbox: connection.emailAddress,
        expectedInbox: inboxAddress || null,
        connectedAt: connection.connectedAt,
        lastSyncAt: connection.lastSyncAt,
        // Age rather than the raw cursor: the number itself means nothing to a reader,
        // whereas "no sync for 3 hours" is immediately actionable.
        minutesSinceSync: connection.lastSyncAt
            ? Math.round((Date.now() - new Date(connection.lastSyncAt).getTime()) / 60000)
            : null,
        pollMinutes: getPollMinutes(),
        pushConfigured: Boolean(topicName),
        watchExpiration: connection.watchExpiration,
        watchExpiresInHours,
        // A watch that has lapsed means push has silently stopped and only polling is
        // still delivering mail.
        watchHealthy: Boolean(connection.watchExpiration && watchExpiresInHours > 0),
        lastError: connection.lastError,
        lastErrorAt: connection.lastErrorAt,
    }, 'Gmail connection status'));
});

/** GET /api/gmail/auth/url */
const startGmailAuth = asyncHandler(async (req, res) => {
    if (!requireGmailManager(req, res)) return undefined;

    const state = crypto.randomBytes(32).toString('hex');
    await storeState(state, req.esfUserId);

    return res.status(200).json(new ApiResponse(200, {
        authorizationUrl: GmailAuth.buildAuthorizationUrl(state),
        expectedInbox: getCredentials().inboxAddress,
    }, 'Open this URL to connect the ESF inbox'));
});

/**
 * GET /api/gmail/auth/callback
 *
 * Unauthenticated by necessity — the browser arrives via a redirect from Google, which
 * carries none of our SameSite cookies. The single-use state is the protection.
 *
 * Always redirects rather than returning JSON: a human is looking at this, not a script.
 */
const handleGmailCallback = asyncHandler(async (req, res) => {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
        logger.warn(`[GmailController] consent returned ${oauthError}`);
        return res.redirect(portalRedirect({ gmail: 'error', reason: String(oauthError) }));
    }

    if (!state) return res.redirect(portalRedirect({ gmail: 'error', reason: 'missing_state' }));

    const adminId = await consumeState(String(state));
    if (!adminId) {
        logger.warn('[GmailController] callback with an unknown or replayed state');
        return res.redirect(portalRedirect({ gmail: 'error', reason: 'invalid_state' }));
    }

    try {
        const { connection } = await GmailAuth.exchangeAuthorizationCode({
            code: String(code || ''),
            connectedBy: adminId !== 'unknown' ? adminId : null,
            // Injected so GmailAuth does not import GmailClient, which imports GmailAuth.
            fetchProfile: GmailClient.getProfileWithToken,
        });

        return res.redirect(portalRedirect({ gmail: 'connected', inbox: connection.emailAddress }));
    } catch (error) {
        logger.error(new ApiError(error.statusCode || 500, `[GmailController] connect failed: ${error.message}`));
        // The message matters here — "that is not the shared inbox" is a mistake the
        // admin can fix in ten seconds, and a generic failure would hide it.
        return res.redirect(portalRedirect({ gmail: 'error', reason: error.message.slice(0, 200) }));
    }
});

/** DELETE /api/gmail/disconnect */
const disconnectGmail = asyncHandler(async (req, res) => {
    if (!requireGmailManager(req, res)) return undefined;

    const removed = await GmailAuth.disconnect();
    return res.status(200).json(new ApiResponse(
        200,
        { removed },
        removed ? 'The ESF inbox has been disconnected' : 'No Gmail connection to remove'
    ));
});

/**
 * POST /api/gmail/watch
 *
 * Start or renew the push watch by hand. The renewal cron does this daily; this exists
 * for the initial setup and for recovering from a lapse without waiting for 03:00.
 */
const startGmailWatch = asyncHandler(async (req, res) => {
    if (!requireGmailManager(req, res)) return undefined;

    const { topicName } = getPubSubConfig();
    if (!topicName) {
        return res.status(400).json(new ApiResponse(400, '', 'GMAIL_PUBSUB_TOPIC is not configured'));
    }

    const result = await GmailClient.watch({ topicName, labelIds: WATCH_LABEL_IDS });

    await GmailConnection.updateOne(
        { key: GmailConnection.SINGLETON_KEY },
        {
            $set: {
                watchTopic: topicName,
                watchExpiration: result.expiration ? new Date(Number(result.expiration)) : null,
            },
        }
    );

    logger.info(`[GmailController] watch started on ${WATCH_LABEL_IDS.join('+')} until ${result.expiration}`);

    return res.status(200).json(new ApiResponse(200, {
        expiration: result.expiration ? new Date(Number(result.expiration)) : null,
        historyId: result.historyId ? String(result.historyId) : null,
        labelIds: WATCH_LABEL_IDS,
    }, 'Gmail watch started'));
});

/**
 * POST /api/gmail/pubsub/push
 *
 * Google calls this. No auth middleware by necessity — the protection is the OIDC token
 * check in pubsubVerifier.js, which is where the reasoning lives.
 *
 * ── ALWAYS ANSWER 204, EVEN ON REJECTION ──
 * Pub/Sub retries anything that is not a prompt 2xx, with backoff, for days. A 401 to a
 * misconfigured subscription therefore becomes an unbounded retry storm against a public
 * endpoint, and a 500 for a message we cannot use means Google redelivers it forever.
 * Nothing here is worth a retry: a genuine notification we drop is picked up by the next
 * poll, and a forged one must not be retried at all. The reason is logged instead.
 */
const handlePubSubPush = asyncHandler(async (req, res) => {
    const { verifyPush } = require('../../Services/Gmail/pubsubVerifier.js');

    const result = await verifyPush(req);
    if (!result.ok) {
        logger.warn(`[GmailPush] rejected: ${result.reason}`);
        return res.status(204).send();
    }

    if (!isMessagingEnabled()) return res.status(204).send();

    try {
        const { enqueueGmailSync } = require('../../Services/BackgroundJobs/gmailInboxQueue.js');
        // The announced historyId is recorded for diagnostics only. It is a doorbell,
        // never a cursor — Pub/Sub delivers out of order and at least once.
        await enqueueGmailSync({ reason: 'push', historyId: result.notification.historyId });
    } catch (error) {
        // Enqueue failing is ours to fix, not Google's to retry. The poll is the
        // backstop, which is exactly why it stays on in production.
        logger.error(new ApiError(500, `[GmailPush] enqueue failed: ${error.message}`));
    }

    return res.status(204).send();
});

module.exports = {
    getGmailStatus,
    startGmailAuth,
    handleGmailCallback,
    disconnectGmail,
    startGmailWatch,
    handlePubSubPush,
};

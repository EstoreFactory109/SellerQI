/**
 * ZohoProjectsController.js
 *
 * HTTP surface for the org-wide Zoho Projects connection.
 *
 * Admin lifecycle (superAdminAuth):
 *   GET    /api/zoho/status
 *   GET    /api/zoho/auth/url
 *   GET    /api/zoho/auth/callback   <- no auth: this is a browser redirect from Zoho
 *   DELETE /api/zoho/disconnect
 *
 * Project operations (normal cookie auth):
 *   GET    /api/zoho/projects
 *   POST   /api/zoho/projects
 *   GET    /api/zoho/projects/:projectId/updates
 */

const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const ZohoAuth = require('../../Services/Zoho/ZohoAuth.js');
const ZohoProjectsService = require('../../Services/Zoho/ZohoProjectsService.js');
const ZohoConnection = require('../../models/system/ZohoConnectionModel.js');
const { MAX_TASKS_DEFAULT } = require('../../Services/Zoho/config.js');

const STATE_PREFIX = 'sqi:zoho:oauth_state:';
const STATE_TTL_SECONDS = 600; // 10 minutes — long enough to click through consent

/** Lazily grab the shared cache Redis; null when unavailable. */
const tryGetRedis = () => {
    try {
        const { getRedisClient } = require('../../config/redisConn.js');
        return getRedisClient();
    } catch (_) {
        return null;
    }
};

/**
 * Persist the CSRF state server-side.
 *
 * Deliberately NOT the sessionStorage approach the Amazon flow uses — that check is a
 * dead no-op today (ConnectAccounts.jsx writes `oauth_state`, FetchingTokens.jsx reads
 * `spapi_oauth_state`, so the stored value is always null and the comparison never runs).
 */
const storeState = async (state, adminId) => {
    const client = tryGetRedis();
    if (!client) {
        // Without Redis we cannot verify the state on the way back, and an unverifiable
        // OAuth callback is exactly the thing state exists to prevent.
        throw new ApiError(503, 'Cannot start the Zoho connect flow: state store (Redis) is unavailable');
    }
    await client.setEx(`${STATE_PREFIX}${state}`, STATE_TTL_SECONDS, String(adminId || 'unknown'));
};

/** Consume the state exactly once — a replayed callback must not validate twice. */
const consumeState = async (state) => {
    const client = tryGetRedis();
    if (!client) {
        throw new ApiError(503, 'Cannot complete the Zoho connect flow: state store (Redis) is unavailable');
    }

    const key = `${STATE_PREFIX}${state}`;
    const value = await client.get(key);
    if (!value) {
        return null;
    }
    await client.del(key);
    return value;
};

/**
 * Current connection state. Never returns the refresh token — the model marks it
 * select:false and nothing here opts in.
 *
 * @route GET /api/zoho/status
 */
const getZohoStatus = asyncHandler(async (req, res) => {
    const connection = await ZohoConnection.findOne({ key: ZohoConnection.SINGLETON_KEY });

    if (!connection) {
        return res.status(200).json(
            new ApiResponse(200, { connected: false }, 'Zoho Projects is not connected')
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                connected: true,
                portalId: connection.portalId || null,
                portalName: connection.portalName || null,
                apiDomain: connection.apiDomain || null,
                accountsDomain: connection.accountsDomain || null,
                scopes: connection.scopes || [],
                connectedAt: connection.connectedAt || null,
                lastRefreshAt: connection.lastRefreshAt || null,
                lastError: connection.lastError || null
            },
            'Zoho Projects connection status'
        )
    );
});

/**
 * Start the connect flow. Returns the consent URL for the admin to open in a browser;
 * it is not a redirect so the caller can use it from curl or a future admin UI alike.
 *
 * @route GET /api/zoho/auth/url
 */
const startZohoAuth = asyncHandler(async (req, res) => {
    const state = crypto.randomBytes(32).toString('hex');

    await storeState(state, req.SuperAdminId);
    const authorizationUrl = ZohoAuth.buildAuthorizationUrl(state);

    logger.info('[ZohoProjects] Generated Zoho authorization URL');

    return res.status(200).json(
        new ApiResponse(
            200,
            { authorizationUrl, state, expiresInSeconds: STATE_TTL_SECONDS },
            'Open this URL in a browser to authorize Zoho Projects'
        )
    );
});

/**
 * OAuth redirect target. Zoho appends code, state, location and accounts-server.
 *
 * Unauthenticated by necessity (the browser arrives here from Zoho, and third-party
 * redirects do not carry our SameSite cookies); the single-use state is what protects it.
 *
 * @route GET /api/zoho/auth/callback
 */
const handleZohoCallback = asyncHandler(async (req, res) => {
    const { code, state, location, error: zohoError } = req.query;
    const accountsServer = req.query['accounts-server'];

    if (zohoError) {
        logger.error(new ApiError(400, `Zoho authorization was denied: ${zohoError}`));
        return res.status(400).json(new ApiResponse(400, { connected: false }, `Zoho authorization was denied: ${zohoError}`));
    }

    const storedBy = await consumeState(state);
    if (!storedBy) {
        logger.error(new ApiError(400, 'Zoho OAuth state is invalid, expired, or already used'));
        return res.status(400).json(
            new ApiResponse(400, { connected: false }, 'Zoho OAuth state is invalid, expired, or already used. Restart the connect flow.')
        );
    }

    const connectedBy = /^[0-9a-fA-F]{24}$/.test(storedBy) ? storedBy : null;

    const { connection } = await ZohoAuth.exchangeAuthorizationCode({
        code,
        location,
        accountsServer,
        connectedBy
    });

    // Resolve the portal now so every later call has one. The token is already valid at
    // this point, so a failure here is a real problem worth surfacing — but the
    // connection itself is saved, and /status will show connected with a null portalId.
    let portals = [];
    try {
        portals = await ZohoProjectsService.listPortals();
    } catch (error) {
        logger.error(new ApiError(502, `Zoho connected but portal lookup failed: ${error.message}`));
        return res.status(502).json(
            new ApiResponse(
                502,
                { connected: true, portalId: null },
                `Zoho connected, but the portal list could not be read: ${error.message}`
            )
        );
    }

    if (portals.length === 0) {
        return res.status(502).json(
            new ApiResponse(502, { connected: true, portalId: null }, 'Zoho connected, but this account has no accessible portals')
        );
    }

    const chosen = portals.find((p) => p.isDefault) || portals[0];

    await ZohoConnection.updateOne(
        { key: ZohoConnection.SINGLETON_KEY },
        { $set: { portalId: chosen.id, portalName: chosen.name } }
    );

    logger.info(`[ZohoProjects] Connected portal ${chosen.id} (${chosen.name})`);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                connected: true,
                portalId: chosen.id,
                portalName: chosen.name,
                apiDomain: connection.apiDomain,
                availablePortals: portals
            },
            'Zoho Projects connected successfully'
        )
    );
});

/**
 * Forget the stored connection. Does not revoke the grant on Zoho's side — that has to
 * be done in Zoho Accounts > Connected Apps.
 *
 * @route DELETE /api/zoho/disconnect
 */
const disconnectZoho = asyncHandler(async (req, res) => {
    const removed = await ZohoAuth.disconnect();

    return res.status(200).json(
        new ApiResponse(
            200,
            { connected: false, removed },
            removed
                ? 'Zoho Projects disconnected. Revoke the grant in Zoho Accounts > Connected Apps to fully remove access.'
                : 'Zoho Projects was not connected'
        )
    );
});

/**
 * @route GET /api/zoho/projects?status=active&limit=100
 */
const listProjects = asyncHandler(async (req, res) => {
    const { status } = req.query;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const projects = await ZohoProjectsService.listProjects({ status, limit });

    return res.status(200).json(
        new ApiResponse(200, { projects, count: projects.length }, 'Zoho projects retrieved successfully')
    );
});

/**
 * @route POST /api/zoho/projects
 * body: { name, description?, startDate?, endDate?, ownerId? }
 */
const createProject = asyncHandler(async (req, res) => {
    const { name, description, startDate, endDate, ownerId } = req.body;

    const project = await ZohoProjectsService.createProject({ name, description, startDate, endDate, ownerId });

    logger.info(`[ZohoProjects] Project created via API by user ${req.userId}: ${project.id}`);

    return res.status(201).json(new ApiResponse(201, { project }, 'Zoho project created successfully'));
});

/**
 * Tasks + comments + activity feed + status posts for one project.
 *
 * @route GET /api/zoho/projects/:projectId/updates?includeComments=true&maxTasks=200
 */
const getProjectTaskUpdates = asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const includeComments = req.query.includeComments !== 'false';
    const maxTasks = req.query.maxTasks ? Number(req.query.maxTasks) : MAX_TASKS_DEFAULT;

    const updates = await ZohoProjectsService.getProjectTaskUpdates(projectId, { includeComments, maxTasks });

    return res.status(200).json(
        new ApiResponse(
            200,
            updates,
            updates.truncated
                ? `Returned the first ${updates.taskCount} tasks; more exist. Raise maxTasks to fetch further.`
                : 'Zoho project updates retrieved successfully'
        )
    );
});

module.exports = {
    getZohoStatus,
    startZohoAuth,
    handleZohoCallback,
    disconnectZoho,
    listProjects,
    createProject,
    getProjectTaskUpdates
};

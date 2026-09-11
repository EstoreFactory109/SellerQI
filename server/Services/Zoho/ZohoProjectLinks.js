/**
 * ZohoProjectLinks.js — connecting an existing Zoho project to an ESF client.
 *
 * Projects are created in Zoho, never here. The portal's only job is to record
 * which Zoho project tracks a given client's work, so this service is about
 * *finding* the right project and storing the pointer — never about creating one.
 *
 * The link itself lives on the client's User document (`zohoProject`), not in a
 * join collection: it is one pointer per client, read on every clients-list
 * render, and a separate collection would mean a second query for no benefit.
 */

const UserModel = require('../../models/user-auth/userModel.js');
const SellerCentralModel = require('../../models/user-auth/sellerCentralModel.js');
const { ApiError } = require('../../utils/ApiError.js');
const logger = require('../../utils/Logger.js');
const ZohoProjectsService = require('./ZohoProjectsService.js');
const ZohoAuth = require('./ZohoAuth.js');

const CACHE_KEY = 'sqi:zoho:projects:all';
const CACHE_TTL_SECONDS = 300; // 5 min — the picker searches on every keystroke

const SUGGESTION_COUNT = 6;
const SEARCH_RESULT_LIMIT = 40;

/** Lazily grab the shared cache Redis; null when unavailable (treated as a miss). */
const tryGetRedis = () => {
    try {
        const { getRedisClient } = require('../../config/redisConn.js');
        return getRedisClient();
    } catch (_) {
        return null;
    }
};

/**
 * The full project list, cached in Redis.
 *
 * Without this every keystroke in the picker would re-run listProjects(), which
 * paginates the Zoho API — a fast route to their rate limiter. Fail-open: any
 * Redis problem just means we fetch from Zoho, never an error to the caller.
 */
const getProjects = async ({ refresh = false } = {}) => {
    const client = tryGetRedis();

    if (!refresh && client) {
        try {
            const cached = await client.get(CACHE_KEY);
            if (cached) return JSON.parse(cached);
        } catch (err) {
            logger.warn(`[ZohoProjectLinks] project cache read failed (non-fatal): ${err.message}`);
        }
    }

    const projects = await ZohoProjectsService.listProjects();

    if (client) {
        try {
            await client.setEx(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(projects));
        } catch (err) {
            logger.warn(`[ZohoProjectLinks] project cache write failed (non-fatal): ${err.message}`);
        }
    }

    return projects;
};

/** Drop the cached list — called after a link so a stale name can't linger. */
const invalidateProjectCache = async () => {
    const client = tryGetRedis();
    if (!client) return;
    try {
        await client.del(CACHE_KEY);
    } catch (err) {
        logger.warn(`[ZohoProjectLinks] project cache invalidate failed (non-fatal): ${err.message}`);
    }
};

/** Lowercase, strip punctuation — so "Bathox (AU) - Vendor" and "bathox au" compare sanely. */
const normalise = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Words worth matching on. Drops noise that would match almost every project. */
const NOISE_WORDS = new Set(['the', 'and', 'ltd', 'llc', 'inc', 'com', 'amazon', 'vendor', 'central', 'seller']);
const meaningfulTokens = (value) =>
    normalise(value).split(' ').filter((t) => t.length > 2 && !NOISE_WORDS.has(t));

/**
 * How well a project name matches what we know about this client.
 *
 * Real project names look like "Biogenic Health (Bathox Australasia) - Vendor
 * Central - AU" or "ESFI3624 - Barbier Robin", so a whole-string containment
 * check in either direction is what actually lands the obvious matches; token
 * overlap catches the rest.
 */
const scoreProject = (project, needles) => {
    const projectNorm = normalise(project.name);
    if (!projectNorm) return 0;
    const projectTokens = new Set(meaningfulTokens(project.name));

    let score = 0;
    for (const needle of needles) {
        const needleNorm = normalise(needle.value);
        if (!needleNorm || needleNorm.length < 3) continue;

        // A needle made only of noise ("Vendor Central", "Amazon Seller") must not
        // match at all — including through the containment check below, which
        // would otherwise score it 100 and make every client's suggestions
        // identical. Requiring one meaningful token gates both paths.
        const needleTokens = meaningfulTokens(needle.value);
        if (needleTokens.length === 0) continue;

        if (projectNorm.includes(needleNorm) || needleNorm.includes(projectNorm)) {
            score += 100 * needle.weight;
            continue;
        }
        const overlap = needleTokens.filter((t) => projectTokens.has(t)).length;
        score += overlap * 20 * needle.weight;
    }
    return score;
};

/**
 * Which ESF client each already-linked project belongs to.
 * Surfaced in the picker so nobody attaches one project to two clients by
 * accident — it does not block the link, it just makes the collision visible.
 */
const linkedProjectOwners = async (excludeClientId) => {
    const linked = await UserModel.find({
        isEsfClient: true,
        'zohoProject.projectId': { $ne: null },
        ...(excludeClientId ? { _id: { $ne: excludeClientId } } : {}),
    }).select('firstName lastName zohoProject.projectId').lean();

    return new Map(
        linked.map((u) => [
            String(u.zohoProject.projectId),
            `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'another client',
        ])
    );
};

/** The ESF client, with the brand name that drives suggestion matching. */
const loadClientContext = async (clientId) => {
    const client = await UserModel.findOne({ _id: clientId, isEsfClient: true })
        .select('firstName lastName email zohoProject')
        .lean();
    if (!client) return null;

    // Brand lives on the Seller document, not the User — same place the clients
    // list reads it from (Services/User/ManagedClientService.js).
    const seller = await SellerCentralModel.findOne({ User: clientId }).select('brand').lean();
    return { ...client, brandName: seller?.brand || null };
};

/**
 * Everything the connect-a-project picker needs in one call.
 *
 * With no search term it returns brand-matched suggestions (falling back to the
 * newest projects when nothing matches); with one it returns name matches.
 */
const getProjectOptions = async ({ clientId, search = '', refresh = false }) => {
    const client = await loadClientContext(clientId);
    if (!client) {
        throw new ApiError(404, 'Client not found in the ESF portal');
    }

    const connection = await ZohoAuth.getConnection();
    if (!connection || !connection.portalId) {
        // Not an error — the picker renders a "connect Zoho first" state.
        return {
            zohoConnected: false,
            portalName: null,
            linked: client.zohoProject?.projectId ? client.zohoProject : null,
            suggestions: [],
            results: [],
            totalProjects: 0,
            searched: Boolean(search),
        };
    }

    const [projects, owners] = await Promise.all([
        getProjects({ refresh }),
        linkedProjectOwners(clientId),
    ]);

    const decorate = (p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        ownerName: p.ownerName,
        openTaskCount: p.openTaskCount,
        taskCount: p.taskCount,
        createdAt: p.createdAt,
        url: p.url,
        linkedToClientName: owners.get(String(p.id)) || null,
    });

    const term = normalise(search);

    if (term) {
        const results = projects
            .filter((p) => normalise(p.name).includes(term))
            .slice(0, SEARCH_RESULT_LIMIT)
            .map(decorate);

        return {
            zohoConnected: true,
            portalName: connection.portalName || null,
            linked: client.zohoProject?.projectId ? client.zohoProject : null,
            suggestions: [],
            results,
            totalProjects: projects.length,
            searched: true,
        };
    }

    const needles = [
        { value: client.brandName, weight: 1 },
        { value: `${client.firstName || ''} ${client.lastName || ''}`, weight: 0.6 },
        // The local part only — every client would otherwise match on the domain.
        { value: String(client.email || '').split('@')[0], weight: 0.4 },
    ].filter((n) => n.value);

    const scored = projects
        .map((p) => ({ project: p, score: scoreProject(p, needles) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, SUGGESTION_COUNT)
        .map((entry) => decorate(entry.project));

    // Nothing resembled the client — show the newest projects instead of an
    // empty panel, since a just-created project is the likeliest target.
    const suggestions = scored.length
        ? scored
        : [...projects]
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .slice(0, SUGGESTION_COUNT)
            .map(decorate);

    return {
        zohoConnected: true,
        portalName: connection.portalName || null,
        linked: client.zohoProject?.projectId ? client.zohoProject : null,
        suggestions,
        matchedByName: scored.length > 0,
        results: [],
        totalProjects: projects.length,
        searched: false,
    };
};

/**
 * Point a client at an existing Zoho project.
 *
 * The name is resolved from Zoho rather than trusted from the request, so the
 * stored label can never drift from the real project, and a bogus id is
 * rejected instead of silently stored.
 */
const linkProject = async ({ clientId, projectId, staffUserId }) => {
    const client = await UserModel.findOne({ _id: clientId, isEsfClient: true }).select('_id');
    if (!client) {
        throw new ApiError(404, 'Client not found in the ESF portal');
    }

    const connection = await ZohoAuth.getConnection();
    if (!connection || !connection.portalId) {
        throw new ApiError(428, 'Zoho Projects is not connected. An admin can connect it in Estore Factory → Zoho Projects.');
    }

    const projects = await getProjects();
    const project = projects.find((p) => String(p.id) === String(projectId));
    if (!project) {
        // Could be a project created since the list was cached.
        const fresh = await getProjects({ refresh: true });
        const retry = fresh.find((p) => String(p.id) === String(projectId));
        if (!retry) {
            throw new ApiError(404, 'That project no longer exists in Zoho Projects');
        }
        return persistLink({ clientId, project: retry, connection, staffUserId });
    }

    return persistLink({ clientId, project, connection, staffUserId });
};

const persistLink = async ({ clientId, project, connection, staffUserId }) => {
    const zohoProject = {
        projectId: String(project.id),
        projectName: project.name,
        portalId: String(connection.portalId),
        linkedAt: new Date(),
        linkedBy: staffUserId || null,
    };

    await UserModel.updateOne({ _id: clientId }, { $set: { zohoProject } });
    await invalidateProjectCache();

    logger.info(`[ZohoProjectLinks] Linked project ${project.id} ("${project.name}") to client ${clientId}`);
    return zohoProject;
};

/** Remove the pointer. The Zoho project itself is untouched. */
const unlinkProject = async (clientId) => {
    const client = await UserModel.findOne({ _id: clientId, isEsfClient: true }).select('zohoProject');
    if (!client) {
        throw new ApiError(404, 'Client not found in the ESF portal');
    }

    await UserModel.updateOne(
        { _id: clientId },
        {
            $set: {
                'zohoProject.projectId': null,
                'zohoProject.projectName': null,
                'zohoProject.portalId': null,
                'zohoProject.linkedAt': null,
                'zohoProject.linkedBy': null,
            },
        }
    );

    logger.info(`[ZohoProjectLinks] Unlinked project from client ${clientId}`);
    return true;
};

module.exports = {
    getProjectOptions,
    linkProject,
    unlinkProject,
    getProjects,
    invalidateProjectCache,
    // exported for tests
    scoreProject,
    normalise,
};

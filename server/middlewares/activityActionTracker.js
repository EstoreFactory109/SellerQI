const { recordAction } = require('../Services/Activity/activityTracker.js');
const logger = require('../utils/Logger.js');

/**
 * Counts what a seller DOES in the app - every successful save, create, delete,
 * send, export and download - for the admin "User activity" pages.
 *
 * Counted here, from the request itself, rather than reported by the page: it
 * cannot be skipped by a closed tab or a blocked script, and it only counts what
 * actually succeeded (status < 400).
 *
 * Mounted once, app-wide, before the routes. It waits for the response to finish,
 * by which time the route's own `auth` has identified the user (req.userId);
 * requests with no signed-in seller are ignored. Who counts as "the user" is
 * decided by recordAction (staff, admins and agencies acting for them do not).
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DOWNLOAD_PATH = /(export|download|pdf|csv)/i;

// Plumbing, and the tracker's own endpoint - not something the user "did".
const IGNORED_PREFIXES = [
    '/app/activity',
    '/app/refresh-token',
    '/app/logout',
    '/app/login',
    '/app/google-login',
    '/app/session',
    '/app/track-ip',
    '/app/get-ip-tracking',
    '/app/esf',
    '/app/auth',
    '/app/members/login-link',
    '/app/members/invite/',
];

const VERBS = { POST: 'Create', PUT: 'Update', PATCH: 'Update', DELETE: 'Delete', GET: 'Download' };
const NOISE_SEGMENTS = new Set(['app', 'api', 'pagewise', 'v1', 'v2', 'v3']);
const looksLikeId = (segment) =>
    /^[0-9a-f]{24}$/i.test(segment) || /^\d+$/.test(segment) || /^[0-9a-f-]{32,36}$/i.test(segment) || segment.length > 30;

/** "POST /api/pagewise/tasks/64f…/complete" -> "Create · tasks · complete" */
const labelFor = (method, path) => {
    const parts = path
        .split('?')[0]
        .split('/')
        .filter(Boolean)
        .filter((segment) => !NOISE_SEGMENTS.has(segment.toLowerCase()))
        .filter((segment) => !looksLikeId(segment))
        .map((segment) => segment.replace(/[-_]+/g, ' ').toLowerCase());
    if (!parts.length) return null;
    // Whole segments only: "tasks" contains "ask" but is not a question.
    const isQuestion = method === 'POST' && parts.some((part) => ['qmate', 'chat', 'ask'].includes(part));
    const verb = isQuestion ? 'Ask' : VERBS[method];
    return `${verb} · ${parts.slice(0, 3).join(' · ')}`;
};

const activityActionTracker = (req, res, next) => {
    res.on('finish', () => {
        try {
            if (!req.userId || res.statusCode >= 400) return;
            const path = (req.originalUrl || '').split('?')[0];
            const isDownload = req.method === 'GET' && DOWNLOAD_PATH.test(path);
            if (!MUTATING.has(req.method) && !isDownload) return;
            if (IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix))) return;

            const label = labelFor(req.method, path);
            if (label) recordAction(req, label).catch((error) => logger.error(`Activity action not recorded: ${error.message}`));
        } catch (error) {
            logger.error(`Activity action tracker failed: ${error.message}`);
        }
    });
    next();
};

module.exports = activityActionTracker;
module.exports.labelFor = labelFor;

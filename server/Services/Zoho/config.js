/**
 * config.js — Zoho Projects integration configuration.
 *
 * Client credentials come from the environment (like SPAPI_CLIENT_ID / AMAZON_ADS_CLIENT_ID).
 * The refresh token does NOT live here — see models/system/ZohoConnectionModel.js.
 *
 * Required in .env:
 *   ZOHO_CLIENT_ID
 *   ZOHO_CLIENT_SECRET
 *   ZOHO_REDIRECT_URI            must match the Authorized Redirect URI registered at
 *                                api-console.zoho.com EXACTLY, e.g.
 *                                https://members.sellerqi.com/api/zoho/auth/callback
 * Optional:
 *   ZOHO_ACCOUNTS_DOMAIN         default https://accounts.zoho.com
 *   ZOHO_PROJECTS_API_DOMAIN     default https://projectsapi.zoho.com
 */

const DEFAULT_ACCOUNTS_DOMAIN = 'https://accounts.zoho.com';
const DEFAULT_API_DOMAIN = 'https://projectsapi.zoho.com';

// Read lazily (function, not a frozen const) so tests can set process.env before requiring
// anything, and so a missing var surfaces at call time with a clear message rather than
// silently baking `undefined` into a module-load-time object.
const getCredentials = () => ({
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    redirectUri: process.env.ZOHO_REDIRECT_URI,
    accountsDomain: process.env.ZOHO_ACCOUNTS_DOMAIN || DEFAULT_ACCOUNTS_DOMAIN,
    apiDomain: process.env.ZOHO_PROJECTS_API_DOMAIN || DEFAULT_API_DOMAIN
});

/**
 * Scopes requested at consent time.
 *
 * projects.ALL is required because we CREATE projects; the rest are read-only.
 * Changing this list invalidates the existing refresh token — Zoho requires a fresh
 * consent for a widened scope, so a reconnect is mandatory after any edit here.
 */
const SCOPES = [
    'ZohoProjects.portals.READ',
    'ZohoProjects.projects.ALL',
    'ZohoProjects.tasks.READ',
    'ZohoProjects.activities.READ',
    'ZohoProjects.status.READ'
];

/**
 * Endpoint paths, centralised.
 *
 * Zoho Projects has two live API generations and they are NOT interchangeable:
 *   v3  -> {apiDomain}/api/v3/...     JSON request bodies
 *   v2  -> {apiDomain}/restapi/...    form-encoded writes, older response envelopes
 *
 * Projects / tasks / comments exist on both. Activities and project status posts are
 * documented on v2 only, hence the mixed versions below. If a path 404s against a live
 * portal, this block is the only place that needs correcting.
 */
const PATHS = {
    // version: which generation the path belongs to
    // envelope: the top-level key Zoho wraps the array in, used to unwrap responses
    portals: { version: 'v3', path: () => '/portals', envelope: 'portals' },

    projects: { version: 'v3', path: (portalId) => `/portal/${portalId}/projects`, envelope: 'projects' },

    tasks: {
        version: 'v3',
        path: (portalId, projectId) => `/portal/${portalId}/projects/${projectId}/tasks`,
        envelope: 'tasks'
    },

    taskComments: {
        version: 'v3',
        path: (portalId, projectId, taskId) =>
            `/portal/${portalId}/projects/${projectId}/tasks/${taskId}/comments`,
        envelope: 'comments'
    },

    activities: {
        version: 'v2',
        path: (portalId, projectId) => `/portal/${portalId}/projects/${projectId}/activities/`,
        envelope: 'activities'
    },

    statuses: {
        version: 'v2',
        path: (portalId, projectId) => `/portal/${portalId}/projects/${projectId}/statuses/`,
        envelope: 'statuses'
    }
};

// Zoho caps page size per resource; these are the documented maxima.
const PAGE_SIZE = {
    projects: 200,
    tasks: 200,
    comments: 100,
    activities: 100,
    statuses: 100
};

// Bounds for the composite "project updates" call. Fetching comments is one request per
// task, so an unbounded project would issue hundreds of calls inside a single HTTP handler.
const MAX_TASKS_DEFAULT = 200;
const COMMENT_FETCH_CONCURRENCY = 5;

const REQUEST_TIMEOUT_MS = 20000;
const TOKEN_REQUEST_TIMEOUT_MS = 15000;

module.exports = {
    getCredentials,
    SCOPES,
    PATHS,
    PAGE_SIZE,
    MAX_TASKS_DEFAULT,
    COMMENT_FETCH_CONCURRENCY,
    REQUEST_TIMEOUT_MS,
    TOKEN_REQUEST_TIMEOUT_MS,
    DEFAULT_ACCOUNTS_DOMAIN,
    DEFAULT_API_DOMAIN
};

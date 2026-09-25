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
    // ALL, not READ: posting a client's reply back onto a task and attaching their
    // files both write through the tasks module (comments and attachments are
    // sub-resources of a task, see PATHS below). With READ these return 401
    // INVALID_OAUTHSCOPE, which is indistinguishable from a bad token until you read
    // the error body.
    'ZohoProjects.tasks.ALL',
    /**
     * ALL, not READ: accepting a client's task request files it under a tasklist, and
     * creates one when nothing fits.
     *
     * Added 2026-09-25. Before this the tasklists endpoint answered 401
     * INVALID_OAUTHSCOPE on BOTH v2 and v3 — the reason ZohoTaskSync reconstructs the
     * Untapped tree out of ordinary tasks instead of asking for tasklists directly.
     *
     * Adding it cost a reconnect, per the warning above. If tasklist calls still 401
     * after that reconnect, suspect THIS STRING rather than the code: Zoho's consent URL
     * accepts any scope name without validating it, so a typo here consents cleanly and
     * then fails exactly as if the scope were missing.
     */
    'ZohoProjects.tasklists.ALL',
    'ZohoProjects.activities.READ',
    'ZohoProjects.status.READ',

    /**
     * For the client Billing page (currently mock — see client/src/Pages/ESF/
     * EstoreFactory/Billing.jsx). That page shows only invoice history and the card
     * on file; it explicitly does NOT show plan/subscription terms ("Anything about
     * your plan itself goes through your account manager"), so subscriptions/plans
     * scopes are deliberately left out — least privilege, same principle as
     * tasks.ALL above being scoped to only what write-back needs.
     *
     * NAMING CAVEAT: Zoho's own docs (zoho.com/billing/api/v1/oauth/) still use the
     * legacy `ZohoSubscriptions.*` prefix for what is now branded "Zoho Billing" —
     * confirmed 2026-09 against the live doc page, not assumed. But as with the
     * Projects scopes, Zoho's consent URL accepts ANY scope string without
     * validating it — the only real proof is whether Zoho Billing actually appears
     * on the consent screen at reconnect time. If it doesn't, either this org has
     * no Zoho Billing organization provisioned, or the scope name is wrong.
     */
    'ZohoSubscriptions.invoices.READ',
    'ZohoSubscriptions.customers.READ',

    /**
     * Read-only on subscriptions, for SCHEDULING rather than display.
     *
     * The Billing page still shows no plan terms — that is unchanged and deliberate
     * ("Anything about your plan itself goes through your account manager"). This
     * scope exists so the nightly sweep can read Zoho's own `next_billing_at`
     * instead of inferring the renewal date by parsing invoice line-item text:
     *
     *     "Charges for this duration (from 22-June-2026 to 21-July-2026)"
     *
     * That inference works (see ZohoBillingService.parseCoveragePeriodEnd) but is
     * hostage to ESF's invoice wording — change the template and every renewal date
     * silently becomes null, which degrades to fetching every client every night. An
     * authoritative field removes that fragility.
     *
     * Same caveat as every scope here: Zoho's consent URL accepts any string without
     * validating it, so this is only proven by Zoho Billing appearing on the consent
     * screen and by the subscriptions endpoint answering 200 afterwards. It currently
     * answers 401.
     */
    'ZohoSubscriptions.subscriptions.READ'
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

    /**
     * Tasklists — read to choose one, written to create one.
     *
     * The version here is a GUESS that could not be tested before the scope existed:
     * both generations answered 401 INVALID_OAUTHSCOPE, which masks whichever of them
     * actually serves this resource. v3 matches the rest of this block, but v3 answers
     * URL_RULE_NOT_CONFIGURED for subtasks, so v2 is a real possibility — and
     * listTasklists retries on the other generation for exactly that reason. If v2 turns
     * out to be the one, correct it here (note v2 paths carry a trailing slash) and drop
     * the retry.
     */
    tasklists: {
        version: 'v3',
        path: (portalId, projectId) => `/portal/${portalId}/projects/${projectId}/tasklists`,
        envelope: 'tasklists'
    },

    taskComments: {
        version: 'v3',
        path: (portalId, projectId, taskId) =>
            `/portal/${portalId}/projects/${projectId}/tasks/${taskId}/comments`,
        envelope: 'comments'
    },

    /**
     * Attachments are v2-only, unlike comments right above them.
     *
     * The v3 path exists and routes, but every multipart POST to it comes back
     * 400 UPLOAD_RULE_NOT_CONFIGURED with an empty details array regardless of the
     * field name. v2 accepts the same upload as `uploaddoc`. Verified against the
     * live portal; the trailing slash is required.
     */
    taskAttachments: {
        version: 'v2',
        path: (portalId, projectId, taskId) =>
            `/portal/${portalId}/projects/${projectId}/tasks/${taskId}/attachments/`,
        envelope: 'attachments',
        fileField: 'uploaddoc'
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

/**
 * Whether clients may attach files to a task reply. DEFAULT OFF, and off for a reason
 * that is not in our code.
 *
 * Every upload shape Zoho documents was tried against a live scratch task: v3 answers
 * UPLOAD_RULE_NOT_CONFIGURED and v2 answers 6500 General Error, for both `uploaddoc`
 * and `file`, with a well-formed multipart body from the form-data package. The path
 * and field are right — the same v2 path cleanly returns 6404 for a task that does not
 * exist — so the portal or the grant is simply not provisioned for API uploads.
 *
 * Posting a COMMENT works and is verified end to end, so text replies ship; the upload
 * button stays hidden until this flips. Flip it once uploads are provisioned (most
 * likely a documents scope plus a reconnect) — no code change needed.
 */
const ATTACHMENTS_ENABLED = process.env.ZOHO_TASK_ATTACHMENTS_ENABLED === 'true';

/**
 * Zoho Billing is a different product on a different host from Projects.
 *
 * Projects has its own dedicated hostname (projectsapi.zoho.com); Billing is served
 * from the shared Zoho API gateway. Per-DC the TLD changes the same way the accounts
 * domain does, so this follows ZOHO_ACCOUNTS_DOMAIN rather than hardcoding .com.
 */
const DEFAULT_BILLING_API_DOMAIN = 'https://www.zohoapis.com';
const getBillingBaseUrl = () =>
    `${process.env.ZOHO_BILLING_API_DOMAIN || DEFAULT_BILLING_API_DOMAIN}/billing/v1`;

/**
 * Billing paths. Verified against the live account — the field names these return
 * are NOT what the docs imply, so see ZohoBillingService for the mapping:
 *   - the invoice date is `invoice_date`, not `date`
 *   - the customer record carries NO card data; cards are their own sub-resource
 *   - a human-readable description lives on invoice LINE ITEMS, so it needs the
 *     per-invoice detail call, not the list
 */
const BILLING_PATHS = {
    customers: () => '/customers',
    customer: (customerId) => `/customers/${customerId}`,
    customerCards: (customerId) => `/customers/${customerId}/cards`,
    invoices: () => '/invoices',
    invoice: (invoiceId) => `/invoices/${invoiceId}`,
    subscriptions: () => '/subscriptions'
};

// Zoho caps page size per resource; these are the documented maxima.
const PAGE_SIZE = {
    projects: 200,
    tasks: 200,
    tasklists: 100,
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
    ATTACHMENTS_ENABLED,
    BILLING_PATHS,
    getBillingBaseUrl,
    PATHS,
    PAGE_SIZE,
    MAX_TASKS_DEFAULT,
    COMMENT_FETCH_CONCURRENCY,
    REQUEST_TIMEOUT_MS,
    TOKEN_REQUEST_TIMEOUT_MS,
    DEFAULT_ACCOUNTS_DOMAIN,
    DEFAULT_API_DOMAIN
};

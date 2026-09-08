/**
 * Per-member page access for ESF clients.
 *
 * The owner (and admins) can restrict which pages a staff member may open when
 * they are working inside an ESF client's account. This applies to ESF clients
 * ONLY — agency clients and self-serve sellers are untouched.
 *
 * Stored as a BLOCKLIST (`esfDeniedPages`) rather than an allow-list, so:
 *   - an empty/absent list means full access, matching "everything until restricted"
 *   - a new page added later is visible to everyone by default instead of
 *     silently disappearing for every existing member
 *
 * The page key is the route segment under /seller-central-checker/, so the
 * client can derive a key straight from a nav link instead of maintaining a
 * second mapping that would drift out of sync.
 */

/** Pages the owner can switch on/off, grouped for the permissions UI. */
const ESF_CLIENT_PAGES = [
    { key: 'client-dashboard', label: 'Client Dashboard', group: 'ESF-only pages' },

    { key: 'dashboard', label: 'Dashboard', group: 'Overview' },
    { key: 'qmate', label: 'Amazon Copilot', group: 'Overview' },

    { key: 'your-products', label: 'Your Products', group: 'Optimize' },
    { key: 'pre-analysis', label: 'Listing Analyzer', group: 'Optimize' },
    { key: 'ppc-dashboard', label: 'Campaign Audit', group: 'Optimize' },
    { key: 'keyword-analysis', label: 'Keyword Analysis', group: 'Optimize' },
    { key: 'tasks', label: 'Tasks', group: 'Optimize' },

    { key: 'profitibility-dashboard', label: 'Profitability', group: 'Money' },
    { key: 'reimbursement-dashboard', label: 'Reimbursement', group: 'Money' },

    { key: 'issues', label: 'Issues', group: 'Health' },
    { key: 'review-request', label: 'Review Requests', group: 'Health' },
    { key: 'account-history', label: 'Account History', group: 'Health' },
    { key: 'user-logging', label: 'User Logging', group: 'Health' },

    { key: 'ecommerce-calendar', label: 'Ecommerce Calendar', group: 'Tools' },
    { key: 'settings', label: 'Client Settings', group: 'Tools' },
];

const ESF_PAGE_KEYS = ESF_CLIENT_PAGES.map((p) => p.key);

/** Keep only keys we recognise, so a stale or hand-edited list cannot lock people out of nothing. */
const sanitizeDeniedPages = (keys) =>
    Array.isArray(keys) ? [...new Set(keys.filter((k) => ESF_PAGE_KEYS.includes(k)))] : [];

/**
 * API path prefix -> page key.
 *
 * Longest match wins, so '/api/pagewise/esf/' resolves to the ESF dashboard
 * rather than being swallowed by a shorter prefix. Anything not listed is
 * unrestricted — shared endpoints (navbar, profile, location) must keep working
 * whatever the member can see, or the whole app breaks rather than one page.
 */
const API_PATH_TO_PAGE = [
    ['/api/pagewise/esf/client-dashboard', 'client-dashboard'],

    ['/api/pagewise/dashboard', 'dashboard'],
    ['/api/pagewise/product-checker', 'dashboard'],
    ['/api/pagewise/top4-products', 'dashboard'],
    ['/api/pagewise/top-priority-products', 'dashboard'],
    ['/api/pagewise/top-opportunities', 'dashboard'],
    ['/api/pagewise/top-products', 'dashboard'],

    ['/api/pagewise/your-products', 'your-products'],
    ['/api/pagewise/inventory', 'your-products'],

    ['/api/pagewise/ppc', 'ppc-dashboard'],
    ['/api/pagewise/ads', 'ppc-dashboard'],
    ['/api/pagewise/keyword-analysis', 'keyword-analysis'],

    ['/api/pagewise/profitability', 'profitibility-dashboard'],
    ['/api/pagewise/asin-wise-sales', 'profitibility-dashboard'],
    ['/api/pagewise/reimbursement', 'reimbursement-dashboard'],

    ['/api/pagewise/issues', 'issues'],
    ['/api/pagewise/account-history', 'account-history'],
    ['/api/pagewise/tasks', 'tasks'],

    ['/api/qmate', 'qmate'],
];

/**
 * Which page does this API path belong to? Returns null when the path is shared
 * infrastructure and must never be blocked.
 */
const pageKeyForApiPath = (path) => {
    if (typeof path !== 'string') return null;
    // Strip the query string before matching.
    const clean = path.split('?')[0];

    let match = null;
    for (const [prefix, key] of API_PATH_TO_PAGE) {
        if (clean.startsWith(prefix) && (!match || prefix.length > match[0].length)) {
            match = [prefix, key];
        }
    }
    return match ? match[1] : null;
};

/**
 * Is this staff member blocked from the given page?
 *
 * The owner is never restricted. Everyone else is checked against their
 * blocklist — admins included, since the owner can restrict them too.
 */
const isPageDeniedFor = (staffUser, pageKey, { isOwner = false } = {}) => {
    if (!pageKey || isOwner || !staffUser) return false;
    const denied = sanitizeDeniedPages(staffUser.esfDeniedPages);
    return denied.includes(pageKey);
};

module.exports = {
    ESF_CLIENT_PAGES,
    ESF_PAGE_KEYS,
    sanitizeDeniedPages,
    pageKeyForApiPath,
    isPageDeniedFor,
};

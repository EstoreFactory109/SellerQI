/**
 * Readable names for the seller pages recorded by activity monitoring.
 *
 * Seller pages live under /seller-central-checker/<key>; the in-account page catalogue the ESF
 * portal already uses (ESF_CLIENT_PAGES) names most of them, so it is the base. The rest are the
 * pages that catalogue does not cover (onboarding, notifications, consultation…).
 */
const { ESF_CLIENT_PAGES } = require('../User/esfPages.js');

const SELLER_PREFIX = '/seller-central-checker/';

/** Keys under /seller-central-checker/ that ESF_CLIENT_PAGES does not name. */
const EXTRA_SELLER_PAGES = {
    'issues-by-product': 'Issues by Product',
    notifications: 'Notifications',
    'notification-details': 'Notification',
    consultation: 'Book a Call',
    'estore-factory/billing': 'Billing',
    'estore-factory/messages': 'Messages',
    'estore-factory/report-history': 'Report History',
    'estore-factory/reports': 'Reports',
    'estore-factory/status': 'Status',
    'estore-factory/untapped': 'Untapped',
    'estore-factory/zoho-projects': 'Projects',
};

/** Pages outside /seller-central-checker/ that belong to the seller (onboarding). */
const TOP_LEVEL_PAGES = {
    '/connect-to-amazon': 'Connect Amazon',
    '/connect-accounts': 'Connect Amazon',
    '/connect-marketplaces': 'Your Marketplaces',
    '/profile-selection': 'Ads Profile',
    '/analyse-account': 'Analysing Account',
};

const CATALOGUE = new Map(ESF_CLIENT_PAGES.map((p) => [p.key, p.label]));

/** Path without query, hash, trailing slash; never longer than 200 characters. */
const normalisePath = (path) => {
    const clean = String(path || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    return clean.slice(0, 200);
};

/**
 * @returns {{ path: string, pageKey: string|null, label: string }}
 */
const describePage = (rawPath) => {
    const path = normalisePath(rawPath);
    if (TOP_LEVEL_PAGES[path]) return { path, pageKey: path.slice(1), label: TOP_LEVEL_PAGES[path] };

    if (path.startsWith(SELLER_PREFIX) || path === SELLER_PREFIX.slice(0, -1)) {
        const rest = path.slice(SELLER_PREFIX.length);
        if (!rest) return { path, pageKey: 'dashboard', label: 'Dashboard' };
        // Longest known prefix first: "estore-factory/report-history/abc" → Report History.
        const segments = rest.split('/');
        for (let n = Math.min(segments.length, 2); n >= 1; n -= 1) {
            const key = segments.slice(0, n).join('/');
            const label = EXTRA_SELLER_PAGES[key] || CATALOGUE.get(key);
            if (label) return { path, pageKey: key, label: segments.length > n && key === 'your-products' ? 'Product Details' : label };
        }
        return { path, pageKey: segments[0], label: segments[0] };
    }
    return { path, pageKey: null, label: path };
};

/** Only seller pages are recorded; anything else (portals, marketing) is ignored. */
const isSellerPage = (rawPath) => {
    const path = normalisePath(rawPath);
    return path.startsWith(SELLER_PREFIX) || Boolean(TOP_LEVEL_PAGES[path]);
};

module.exports = { describePage, isSellerPage, normalisePath };

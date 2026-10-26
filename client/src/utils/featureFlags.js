/**
 * Build-time feature flags (Vite env). Both default OFF so the app behaves exactly as before
 * until a deploy turns them on.
 *
 *   VITE_PER_PAGE_MARKETPLACE       — each page gets its own marketplace switcher and the TopNav
 *                                     pill is hidden; the choice travels as the X-Marketplace header.
 *   VITE_ALL_MARKETPLACES_DASHBOARD — the Dashboard opens on "All marketplaces": every marketplace
 *                                     side by side, each in its own currency (needs
 *                                     ALL_MARKETPLACES_DASHBOARD_ENABLED on the server).
 */
export const PER_PAGE_MARKETPLACE = import.meta.env.VITE_PER_PAGE_MARKETPLACE === 'true';
export const ALL_MARKETPLACES_DASHBOARD = PER_PAGE_MARKETPLACE && import.meta.env.VITE_ALL_MARKETPLACES_DASHBOARD === 'true';

/**
 * VITE_FIX_IT_PACKAGES — the Tasks page's "Fix it now" / "Have us fix these" buttons and the
 * price line that sells them. Off until the Fix it packages are ready to offer; the rest of the
 * Tasks page (what the open tasks cost, the account risks) shows either way.
 */
export const FIX_IT_PACKAGES = import.meta.env.VITE_FIX_IT_PACKAGES === 'true';

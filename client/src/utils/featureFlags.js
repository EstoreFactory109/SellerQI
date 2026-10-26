/**
 * Build-time feature flags (Vite env).
 *
 * The two marketplace flags are ON by default (2026-10-27): set either to 'false' to switch it
 * off. Defaults matter here because the production frontend is built by GitHub Actions
 * (.github/workflows/deploy.yml), which passes no VITE_ flag of this kind into the build.
 *
 *   VITE_PER_PAGE_MARKETPLACE       — each page gets its own marketplace switcher and the TopNav
 *                                     pill is hidden; the choice travels as the X-Marketplace header.
 *   VITE_ALL_MARKETPLACES_DASHBOARD — the Dashboard opens on "All marketplaces": every marketplace
 *                                     side by side, each in its own currency (needs
 *                                     ALL_MARKETPLACES_DASHBOARD_ENABLED on the server).
 */
export const PER_PAGE_MARKETPLACE = import.meta.env.VITE_PER_PAGE_MARKETPLACE !== 'false';
export const ALL_MARKETPLACES_DASHBOARD = PER_PAGE_MARKETPLACE && import.meta.env.VITE_ALL_MARKETPLACES_DASHBOARD !== 'false';

/**
 * VITE_FIX_IT_PACKAGES — the Tasks page's "Fix it now" / "Have us fix these" buttons and the
 * price line that sells them. Off until the Fix it packages are ready to offer; the rest of the
 * Tasks page (what the open tasks cost, the account risks) shows either way.
 */
export const FIX_IT_PACKAGES = import.meta.env.VITE_FIX_IT_PACKAGES === 'true';

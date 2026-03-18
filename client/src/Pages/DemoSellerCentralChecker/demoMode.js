export const DEMO_PREFIX = '/seller-central-checker-demo';
export const MAIN_PREFIX = '/seller-central-checker';

export const isDemoMode = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith(DEMO_PREFIX);
};

/**
 * Convert a main seller-central-checker path to its demo equivalent.
 * Example: `/seller-central-checker/dashboard` → `/seller-central-checker-demo/dashboard`
 */
export const toDemoPath = (mainPath) => {
  if (!mainPath || typeof mainPath !== 'string') return mainPath;
  if (mainPath.startsWith(DEMO_PREFIX)) return mainPath;
  if (mainPath.startsWith(MAIN_PREFIX)) {
    return `${DEMO_PREFIX}${mainPath.slice(MAIN_PREFIX.length)}`;
  }
  // Also handle cases without leading prefix (best-effort)
  if (mainPath.startsWith('/dashboard')) return `${DEMO_PREFIX}/dashboard`;
  return mainPath;
};


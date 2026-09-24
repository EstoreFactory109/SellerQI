/**
 * Which portal a page belongs to, and the last page visited in each one.
 *
 * When someone signed in to one portal types another portal's URL (say, /esf-login
 * while on /manage-accounts/logs/email), they are sent back to exactly the page
 * they were on — not to that portal's home — so a stray URL changes nothing.
 * Typing a URL is a full page load, so the page is remembered in localStorage
 * rather than in React state.
 */

// Most specific first. Login, invite and demo pages belong to no portal and are
// never remembered, so a remembered page can never be a login page.
const PORTAL_PREFIXES = [
  ['admin', ['/manage-accounts']],
  ['agency', ['/manage-agency-users', '/agency/']],
  ['esf', ['/esf/']],
  ['user', ['/seller-central-checker/', '/analyse-account', '/connect-to-amazon', '/connect-accounts', '/profile-selection']],
];

const keyFor = (portal) => `lastPortalPage:${portal}`;

/** 'admin' | 'agency' | 'esf' | 'user' | null */
export const portalOf = (pathname = '') => {
  if (pathname === '/esf') return 'esf';
  const match = PORTAL_PREFIXES.find(([, prefixes]) => prefixes.some((prefix) => pathname.startsWith(prefix)));
  return match ? match[0] : null;
};

/** Call on every navigation; ignores pages that belong to no portal. */
export const rememberPortalPage = (pathname, search = '') => {
  const portal = portalOf(pathname);
  if (!portal) return;
  try {
    localStorage.setItem(keyFor(portal), JSON.stringify({ path: `${pathname}${search}`, at: Date.now() }));
  } catch {
    /* storage unavailable — callers fall back to the portal's home page */
  }
};

const readPage = (portal) => {
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(portal)) || 'null');
    return saved && typeof saved.path === 'string' && portalOf(saved.path.split('?')[0]) === portal ? saved : null;
  } catch {
    return null;
  }
};

/**
 * Where to send someone who is signed in as `session` (from GET /app/session).
 *
 * Staff and admins can be inside a client's account (session.inAccount), in which
 * case the seller page they were on counts too — whichever was visited last wins.
 * Without an open account a seller page would only bounce to the login page, so
 * it is not considered.
 */
export const returnPathFor = (session) => {
  const candidates = [readPage(session.kind)];
  if (session.kind !== 'user' && session.inAccount) candidates.push(readPage('user'));
  const newest = candidates.filter(Boolean).sort((a, b) => b.at - a.at)[0];
  return newest ? newest.path : session.home;
};

/**
 * Best guess at the current session from the flags each login writes, for when
 * the server cannot be asked. The destination portal checks the real session
 * itself and clears its flag if it is stale, so a wrong guess cannot loop.
 */
export const sessionFromFlags = () => {
  try {
    const flag = (key) => localStorage.getItem(key);
    if (flag('isAdminAuth') === 'true' && flag('adminAccessType') === 'superAdmin') {
      return { kind: 'admin', home: '/manage-accounts', inAccount: Boolean(flag('loggedInAsUser')) };
    }
    if (flag('isEsfAuth') === 'true') {
      return { kind: 'esf', home: '/esf/clients', inAccount: Boolean(flag('loggedInAsClient')) };
    }
    if (flag('isAdminAuth') === 'true' && flag('adminAccessType') === 'enterpriseAdmin') {
      return { kind: 'agency', home: '/manage-agency-users', inAccount: Boolean(flag('loggedInAsClient')) };
    }
    if (flag('isAuth') === 'true') return { kind: 'user', home: '/analyse-account', inAccount: true };
  } catch {
    /* storage unavailable */
  }
  return null;
};

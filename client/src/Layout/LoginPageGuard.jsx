import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Loader from '../Components/Loader/Loader.jsx';
import axiosInstance from '../config/axios.config.js';
import { clearEsfPageAccessCache } from '../hooks/useEsfPageAccess.js';
import { returnPathFor, sessionFromFlags } from '../utils/portalPages.js';

/**
 * One browser holds one session: every tab shares the same cookies, so signing in
 * to a second portal would stack a second session on the first. So a page that
 * belongs to a different portal than the one this browser is signed in to is not
 * reachable — typing its URL leaves the visitor on the page they were already on
 * (see utils/portalPages.js). The login endpoints refuse the same way server-side.
 *
 * <LoginPageGuard>          — login, sign-up, invitation and sign-in-link pages:
 *                             open only while nobody is signed in.
 * <PortalGate allow={[…]}>  — a portal's own pages: open to the listed sessions
 *                             (and to nobody-signed-in, which the portal already
 *                             sends to its own login page).
 */

// The flags each portal's own login writes. Kept in step with the server's answer
// so a layout that trusts localStorage does not bounce the visitor back here.
const FLAGS_BY_SESSION = {
  admin: { isAdminAuth: 'true', adminAccessType: 'superAdmin' },
  esf: { isEsfAuth: 'true' },
  agency: { isAuth: 'true', userAccessType: 'enterpriseAdmin', isAdminAuth: 'true', adminAccessType: 'enterpriseAdmin' },
  user: { isAuth: 'true' },
};

// Left behind by a session that has since ended (expired cookie, logout in
// another tab). Nothing is signed in, so none of them are true any more.
const STALE_FLAGS = ['isAuth', 'userAccessType', 'isAdminAuth', 'adminAccessType', 'adminId', 'isEsfAuth', 'loggedInAsUser', 'loggedInAsClient'];

const syncFlags = (session) => {
  try {
    if (session) {
      Object.entries(FLAGS_BY_SESSION[session.kind] || {}).forEach(([key, value]) => localStorage.setItem(key, value));
    } else {
      STALE_FLAGS.forEach((key) => localStorage.removeItem(key));
    }
  } catch {
    /* storage unavailable — the server still decides */
  }
};

/**
 * @param {Array<string>} allow session kinds that may see the page; null = signed out
 */
const SessionGate = ({ allow, children }) => {
  const navigate = useNavigate();
  // Held in a ref so the check runs once per mount, not again on every navigation
  // inside a gated portal (navigate's identity changes with the location).
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [checked, setChecked] = useState(false);
  const allowKey = allow.join(',');

  useEffect(() => {
    let alive = true;
    const allowed = allowKey.split(',');

    const decide = (session, { fromServer }) => {
      if (!alive) return;
      const kind = session ? session.kind : 'null';
      if (allowed.includes(kind)) {
        // Whoever signs in next is a new session. The ESF page-access answer is
        // cached for the life of the tab, so drop it or the next account inherits
        // the last one's (e.g. the "back to ESF" switch button).
        if (!session && fromServer) clearEsfPageAccessCache();
        setChecked(true);
        return;
      }
      navigateRef.current(returnPathFor(session), { replace: true });
    };

    axiosInstance
      .get('/app/session')
      .then((res) => {
        const session = res.data?.data || null;
        syncFlags(session);
        decide(session, { fromServer: true });
      })
      // The server could not be asked. Go by what this browser's logins recorded;
      // the portal it lands on re-checks the real session and clears a stale flag.
      .catch(() => decide(sessionFromFlags(), { fromServer: false }));

    return () => {
      alive = false;
    };
  }, [allowKey]);

  if (!checked) return <Loader />;
  return children;
};

export const PortalGate = ({ allow, children }) => <SessionGate allow={[...allow, 'null']}>{children}</SessionGate>;

const LoginPageGuard = ({ children }) => <SessionGate allow={['null']}>{children}</SessionGate>;

export default LoginPageGuard;

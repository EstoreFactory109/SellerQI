import { useSelector } from 'react-redux';
import { Navigate, Outlet } from 'react-router-dom';

/**
 * Keeps the ESF client pages out of accounts that are not ESF clients.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM EsfPageAccessGuard ──
 * That guard sits on the same route block and reads as though it covers this, but it
 * does not: it only acts on a RESTRICTED session — ESF staff inside a client, or a
 * member whose owner limited their pages — and no-ops for everyone else, its own
 * docstring says so. An ordinary client is neither, so it fell straight through.
 *
 * Until this existed, the only thing keeping these pages out of a normal account was
 * the sidebar link being hidden (LeftNavSection.jsx). Typing or bookmarking the URL
 * walked straight in: ClientDashboard checked for itself, and the six estore-factory
 * pages did not check at all, so they rendered their shell, fired their requests, took
 * a 403 from esfClientOnly and sat there looking blank and broken.
 *
 * ── THE SAME RULE AS THE SERVER, DELIBERATELY ──
 * `isEsfClient`, and nothing else — copied from server/middlewares/Auth/esfClientOnly.js.
 * The server is still the thing that refuses the DATA, and nothing here is load-bearing
 * for that. This exists so the answer is a clean redirect rather than a page full of
 * failed requests.
 *
 * A platform superAdmin is NOT an exception. Servicing a real ESF client mints a session
 * as that client, so the account in hand is an ESF client and passes on its own account.
 * An admin on their OWN account has no agency relationship to show, and these pages would
 * describe one that does not exist.
 *
 * ── UNDECIDED IS NOT DENIED ──
 * `user` is null for an instant on first paint, before ProtectedRouteWrapper populates
 * it. Redirecting on that would bounce a real ESF client off their own dashboard on
 * every hard refresh, so an absent user renders through and the server stays the
 * backstop for the moment it takes to arrive.
 */
const EsfClientOnlyRoute = () => {
  const user = useSelector((state) => state.Auth?.user);

  if (user && user.isEsfClient !== true) {
    return <Navigate to="/seller-central-checker/dashboard" replace />;
  }

  return <Outlet />;
};

export default EsfClientOnlyRoute;

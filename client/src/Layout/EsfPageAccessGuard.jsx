import { useEffect } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import useEsfPageAccess from '../hooks/useEsfPageAccess.js';

/**
 * Blocks direct URL access to a page the current ESF staff member is not
 * allowed to open for this client.
 *
 * Hiding the sidebar link is not enough on its own — someone can still type or
 * bookmark the URL. The server refuses the data independently; this exists so
 * they get a clean redirect instead of a page full of failed requests.
 *
 * No-ops entirely for non-ESF sessions and for the owner.
 */
const EsfPageAccessGuard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { ready, isEsfSession, isOwner, isPageAllowed } = useEsfPageAccess();

  // Route segment == permission key (see Services/User/esfPages.js).
  const pageKey = location.pathname.split('?')[0].split('/').filter(Boolean).pop();

  const blocked = ready && isEsfSession && !isOwner && pageKey && !isPageAllowed(pageKey);

  useEffect(() => {
    if (!blocked) return;
    // Dashboard is the usual landing spot; if that is blocked too, fall back to
    // settings, which every member can reach for their own account.
    const fallback = isPageAllowed('dashboard')
      ? '/seller-central-checker/dashboard'
      : '/seller-central-checker/settings';
    navigate(fallback, { replace: true });
  }, [blocked, isPageAllowed, navigate]);

  // Hold rendering until the permission answer is in, otherwise a blocked page
  // flashes on screen and fires its data requests before the redirect lands.
  if (!ready || blocked) {
    return (
      <div className="w-full h-full min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
      </div>
    );
  }

  return <Outlet />;
};

export default EsfPageAccessGuard;

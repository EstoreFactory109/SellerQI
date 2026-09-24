import { useEffect } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import useEsfPageAccess from '../hooks/useEsfPageAccess.js';

// Where to send someone away from a blocked page, in order of preference.
const FALLBACK_PAGES = [
  'dashboard', 'your-products', 'tasks', 'profitibility-dashboard', 'reimbursement-dashboard',
  'issues', 'review-request', 'qmate', 'pre-analysis', 'account-history', 'settings',
];

/**
 * Blocks direct URL access to a page the current session is not allowed to open:
 * an ESF staff member (other than the owner) inside a client, or a member of a
 * seller account whose owner limited their page access.
 *
 * Hiding the sidebar link is not enough on its own — someone can still type or
 * bookmark the URL. The server refuses the data independently; this exists so
 * they get a clean redirect instead of a page full of failed requests.
 *
 * No-ops for everyone else.
 */
const EsfPageAccessGuard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { ready, isRestricted, isPageAllowed } = useEsfPageAccess();

  // Route segment == permission key (see Services/User/esfPages.js).
  const pageKey = location.pathname.split('?')[0].split('/').filter(Boolean).pop();

  const blocked = ready && isRestricted && pageKey && !isPageAllowed(pageKey);
  const fallbackKey = blocked ? FALLBACK_PAGES.find((key) => key !== pageKey && isPageAllowed(key)) : null;

  useEffect(() => {
    if (!blocked || !fallbackKey) return;
    navigate(`/seller-central-checker/${fallbackKey}`, { replace: true });
  }, [blocked, fallbackKey, navigate]);

  // Every page is blocked: say so, rather than spinning forever.
  if (blocked && !fallbackKey) {
    return (
      <div className="w-full h-full min-h-[60vh] flex flex-col items-center justify-center gap-2 text-center px-4">
        <Lock className="w-6 h-6 text-gray-500" />
        <p className="text-sm text-gray-300">You don&apos;t have access to any pages of this account.</p>
        <p className="text-xs text-gray-500">Ask the account owner to give you access.</p>
      </div>
    );
  }

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

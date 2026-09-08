import React from 'react';
import { Outlet, useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const CLIENT_PAGE_TITLES = {
  'connect-to-amazon': 'Connect to Amazon',
  'connect-accounts': 'Connect accounts',
  'profile-selection': 'Profile selection',
};

/**
 * Shell for the ESF portal's per-client setup flow.
 * TODO(backend): verify the client belongs to the ESF portal via
 * GET /app/esf/clients/:clientId before rendering (see ProtectedEsfRouteWrapper).
 */
const EsfClientLayout = () => {
  const { clientId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const pathSegment = location.pathname.split('/').filter(Boolean).pop() || '';
  const pageTitle = CLIENT_PAGE_TITLES[pathSegment] || 'Client setup';

  return (
    <div className="min-h-screen bg-[#0b0f17] flex flex-col text-gray-100">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 md:px-6 py-4 bg-[#0b0f17]/85 backdrop-blur-xl border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/esf/clients')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:bg-white/[0.05] hover:text-gray-200 transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium hidden sm:inline">Back to clients</span>
          </button>
          <h1 className="text-xl font-semibold text-gray-100 tracking-tight truncate">{pageTitle}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-medium text-gray-300 truncate max-w-[140px] md:max-w-[200px]">
            eStore Factory
          </span>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <Outlet context={{ clientId, basePath: `/esf/client/${clientId}` }} />
      </main>
    </div>
  );
};

export default EsfClientLayout;

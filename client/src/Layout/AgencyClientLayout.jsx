import React, { useEffect, useState } from 'react';
import { Outlet, useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2, Building2, Plus } from 'lucide-react';
import axiosInstance from '../config/axios.config.js';

const CLIENT_PAGE_TITLES = {
  'connect-to-amazon': 'Connect to Amazon',
  'connect-accounts': 'Connect accounts',
  'profile-selection': 'Profile selection',
};

const AgencyClientLayout = () => {
  const { agencyName, clientId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const decodedAgencyName = agencyName ? decodeURIComponent(agencyName) : '';
  const backToClients = '/manage-agency-users';
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [agencyLogoUrl, setAgencyLogoUrl] = useState('');

  const pathSegment = location.pathname.split('/').filter(Boolean).pop() || '';
  const pageTitle = CLIENT_PAGE_TITLES[pathSegment] || 'Client setup';

  useEffect(() => {
    const verifyAccess = async () => {
      const isAuth = localStorage.getItem('isAuth') === 'true';
      const isAdminAuth = localStorage.getItem('isAdminAuth') === 'true';
      const adminAccessType = localStorage.getItem('adminAccessType');
      
      // Check basic auth
      if (!isAuth && !isAdminAuth) {
        navigate('/agency-login', { replace: true });
        return;
      }
      
      // Check if user is an agency admin (enterpriseAdmin)
      if (adminAccessType !== 'enterpriseAdmin') {
        console.error('[AgencyClientLayout] User is not an agency admin');
        navigate('/agency-login', { replace: true });
        return;
      }
      
      // Verify the client belongs to this agency by checking via API
      if (clientId) {
        try {
          // Switch to client context to verify ownership (this will fail if client doesn't belong to agency)
          const response = await axiosInstance.post('/app/admin/switch-to-client', { clientId });
          if (response.status === 200) {
            setAuthorized(true);
          } else {
            console.error('[AgencyClientLayout] Failed to verify client ownership');
            navigate('/manage-agency-users', { replace: true });
          }
        } catch (error) {
          console.error('[AgencyClientLayout] Error verifying client:', error);
          navigate('/manage-agency-users', { replace: true });
          return;
        }
      } else {
        // No clientId provided
        navigate('/manage-agency-users', { replace: true });
        return;
      }
      
      setLoading(false);
    };
    
    verifyAccess();
  }, [navigate, clientId]);

  useEffect(() => {
    const loadAgencyProfile = async () => {
      if (!authorized) return;
      try {
        const res = await axiosInstance.get('/app/admin/profile');
        if (res.data?.statusCode === 200 && res.data?.data?.adminInfo?.profilePic) {
          setAgencyLogoUrl(res.data.data.adminInfo.profilePic);
        }
      } catch (_) {}
    };
    loadAgencyProfile();
  }, [authorized]);

  useEffect(() => {
    const onLogoUpdated = (e) => {
      const url = e.detail?.profilePicUrl;
      if (url) setAgencyLogoUrl(url);
    };
    window.addEventListener('agency-logo-updated', onLogoUpdated);
    return () => window.removeEventListener('agency-logo-updated', onLogoUpdated);
  }, []);

  // Show loading while verifying access
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          <p className="text-white/70 text-sm">Verifying access...</p>
        </div>
      </div>
    );
  }
  
  // Don't render if not authorized (should redirect)
  if (!authorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] flex flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 py-3 bg-[#111] border-b border-[#252525]">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate(backToClients)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-white/80 hover:bg-white/10 hover:text-white transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium hidden sm:inline">Back to clients</span>
          </button>
          <h1 className="text-lg font-semibold text-white tracking-tight truncate">{pageTitle}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {agencyLogoUrl ? (
            <img src={agencyLogoUrl} alt="" className="h-8 w-8 rounded-lg object-cover border border-[#252525]" aria-hidden />
          ) : (
            <div className="h-8 w-8 rounded-lg bg-[#1a1a1a] border border-[#252525] flex items-center justify-center relative">
              <Building2 className="w-4 h-4 text-blue-400" aria-hidden />
              <Plus className="w-2.5 h-2.5 text-blue-400 absolute -bottom-0.5 -right-0.5" aria-hidden />
            </div>
          )}
          <span className="text-sm font-medium text-white truncate max-w-[140px] md:max-w-[200px]" title={decodedAgencyName}>
            {decodedAgencyName || 'Agency'}
          </span>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <Outlet context={{ agencyName: decodedAgencyName, clientId }} />
      </main>
    </div>
  );
};

export default AgencyClientLayout;

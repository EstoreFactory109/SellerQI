import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate, NavLink } from 'react-router-dom';
import { Users, LogOut, Menu, Building2, Plus, Settings, User, Key, HelpCircle, Calendar } from 'lucide-react';
import axiosInstance from '../config/axios.config.js';
import { useDispatch } from 'react-redux';
import { logout } from '../redux/slices/authSlice.js';
import sellerQILogo from '../assets/Logo/sellerQILogo.png';

const PAGE_TITLES = {
  '/manage-agency-users': { title: 'Clients', subtitle: 'Manage your agency clients' },
  '/manage-agency-users/settings': { title: 'Settings', subtitle: 'Agency profile and preferences' },
  '/manage-agency-users/consultation': { title: 'Need any help', subtitle: 'Book a call with our team' },
};

const ManageAgencyUsersLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [agencyName, setAgencyName] = useState('');
  const [agencyLogoUrl, setAgencyLogoUrl] = useState('');

  const pathname = location.pathname;
  const pageInfo = PAGE_TITLES[pathname] || { title: 'Agency', subtitle: '' };
  const isClients = pathname === '/manage-agency-users' && !pathname.startsWith('/manage-agency-users/settings') && pathname !== '/manage-agency-users/consultation';

  useEffect(() => {
    const isAuth = localStorage.getItem('isAuth') === 'true';
    if (!isAuth) {
      navigate('/agency-login', { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    const loadAgencyProfile = async () => {
      try {
        const res = await axiosInstance.get('/app/admin/profile');
        if (res.data?.statusCode === 200 && res.data?.data?.adminInfo) {
          const info = res.data.data.adminInfo;
          if (info.agencyName) setAgencyName(info.agencyName);
          if (info.profilePic) setAgencyLogoUrl(info.profilePic);
        }
      } catch (_) {
        // use fallback
      }
    };
    loadAgencyProfile();
  }, []);

  useEffect(() => {
    const onLogoUpdated = (e) => {
      const url = e.detail?.profilePicUrl;
      if (url) setAgencyLogoUrl(url);
    };
    window.addEventListener('agency-logo-updated', onLogoUpdated);
    return () => window.removeEventListener('agency-logo-updated', onLogoUpdated);
  }, []);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await axiosInstance.post('/app/logout');
      dispatch(logout());
      localStorage.removeItem('isAuth');
      localStorage.removeItem('userAccessType');
      localStorage.removeItem('adminId');
      localStorage.removeItem('isAdminAuth');
      localStorage.removeItem('adminAccessType');
      navigate('/agency-login');
    } catch (err) {
      console.error('Logout error:', err);
      localStorage.removeItem('isAuth');
      localStorage.removeItem('userAccessType');
      navigate('/agency-login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  const navTo = (path) => {
    navigate(path);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#111] flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-full w-[240px] max-w-[85vw] lg:max-w-none bg-[#0d0d0d] border-r border-[#252525] flex flex-col transition-transform duration-200 ease-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex flex-col h-full w-[240px] shrink-0">
          <div className="p-5 border-b border-[#252525]">
            <div className="flex items-center justify-center">
              <img src={sellerQILogo} alt="SellerQI" className="h-7 w-auto object-contain" />
            </div>
          </div>
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            <button
              type="button"
              onClick={() => navTo('/manage-agency-users')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                isClients ? 'bg-[#1a1a1a] border-l-2 border-blue-500 text-white' : 'text-white/70 hover:bg-[#1a1a1a] hover:text-white'
              }`}
            >
              <Users className={`w-5 h-5 shrink-0 ${isClients ? 'text-blue-400' : 'text-gray-500'}`} />
              <span className="text-sm font-medium">Clients</span>
            </button>
          </nav>
          <div className="p-3 border-t border-[#252525] space-y-0.5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 px-3">Settings</p>
            <NavLink
              to="/manage-agency-users/settings"
              end={false}
              className={({ isActive }) => {
                const tab = new URLSearchParams(location.search).get('tab');
                const isProfileTab = isActive && (!tab || tab === 'profile');
                return `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  isProfileTab ? 'bg-[#1a1a1a] border-l-2 border-blue-500 text-white' : 'text-white/70 hover:bg-[#1a1a1a] hover:text-white'
                }`;
              }}
            >
              <User className="w-5 h-5 shrink-0 text-gray-500" />
              <span className="text-sm font-medium">Agency Profile</span>
            </NavLink>
            <NavLink
              to="/manage-agency-users/settings?tab=password"
              className={({ isActive }) =>
                `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  isActive ? 'bg-[#1a1a1a] border-l-2 border-blue-500 text-white' : 'text-white/70 hover:bg-[#1a1a1a] hover:text-white'
                }`
              }
            >
              <Key className="w-5 h-5 shrink-0 text-gray-500" />
              <span className="text-sm font-medium">Update password</span>
            </NavLink>
            <NavLink
              to="/manage-agency-users/settings?tab=support"
              className={({ isActive }) =>
                `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  isActive ? 'bg-[#1a1a1a] border-l-2 border-blue-500 text-white' : 'text-white/70 hover:bg-[#1a1a1a] hover:text-white'
                }`
              }
            >
              <HelpCircle className="w-5 h-5 shrink-0 text-gray-500" />
              <span className="text-sm font-medium">Support</span>
            </NavLink>
            <NavLink
              to="/manage-agency-users/consultation"
              className={({ isActive }) =>
                `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  isActive ? 'bg-[#1a1a1a] border-l-2 border-blue-500 text-white' : 'text-white/70 hover:bg-[#1a1a1a] hover:text-white'
                }`
              }
            >
              <Calendar className="w-5 h-5 shrink-0 text-gray-500" />
              <span className="text-sm font-medium">Need any help</span>
            </NavLink>
          </div>
          <div className="p-3 border-t border-[#252525]">
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <LogOut className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">{isLoggingOut ? 'Logging out…' : 'Logout'}</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 lg:ml-[240px]">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 py-3 bg-[#111] border-b border-[#252525]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg text-white/80 hover:bg-white/10 hover:text-white lg:hidden shrink-0"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-white tracking-tight truncate">{pageInfo.title}</h1>
              {pageInfo.subtitle && <p className="text-xs text-white/60 truncate">{pageInfo.subtitle}</p>}
            </div>
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
            <span className="text-sm font-medium text-white truncate max-w-[140px] md:max-w-[200px]" title={agencyName || 'Agency'}>
              {agencyName || 'Agency'}
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default ManageAgencyUsersLayout;

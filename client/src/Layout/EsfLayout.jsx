import React, { useState } from 'react';
import { Outlet, useLocation, useNavigate, NavLink } from 'react-router-dom';
import { Users, UserCog, LogOut, Menu, User, Key, HelpCircle } from 'lucide-react';
import axiosInstance from '../config/axios.config.js';
import { useEsfUser } from '../contexts/EsfUserContext.js';
import sellerQILogo from '../assets/Logo/sellerQILogo.png';

const PAGE_TITLES = {
  '/esf/clients': { title: 'Manage client', subtitle: 'Manage all clients onboarded by the team' },
  '/esf/users': { title: 'Team members', subtitle: 'Manage who can access this portal' },
  '/esf/settings': { title: 'Settings', subtitle: 'Your profile and preferences' },
};

const EsfLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const esfUser = useEsfUser();

  const pathname = location.pathname;
  const pageInfo = PAGE_TITLES[pathname] || { title: 'ESF Portal', subtitle: '' };
  const isClients = pathname === '/esf' || pathname.startsWith('/esf/clients');
  const isUsers = pathname.startsWith('/esf/users');

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await axiosInstance.post('/app/esf/logout');
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      localStorage.removeItem('isEsfAuth');
      setIsLoggingOut(false);
      navigate('/esf-login');
    }
  };

  const navTo = (path) => {
    navigate(path);
    setSidebarOpen(false);
  };

  const navItemClass = (active) =>
    `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
      active
        ? 'bg-blue-500/15 border border-blue-500/30 text-blue-100 shadow-sm'
        : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
    }`;

  return (
    <div className="min-h-screen bg-[#0b0f17] flex text-gray-100">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-full w-[260px] max-w-[85vw] lg:max-w-none bg-[#080c12]/95 backdrop-blur-xl border-r border-white/10 flex flex-col transition-transform duration-200 ease-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex flex-col h-full w-[260px] shrink-0">
          <div className="p-5 border-b border-white/10">
            <div className="flex items-center justify-center rounded-xl bg-white/[0.03] border border-white/10 px-4 py-3">
              <img src={sellerQILogo} alt="SellerQI" className="h-8 w-auto object-contain" />
            </div>
          </div>

          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            <button type="button" onClick={() => navTo('/esf/clients')} className={navItemClass(isClients)}>
              <Users className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">Manage client</span>
            </button>
            <button type="button" onClick={() => navTo('/esf/users')} className={navItemClass(isUsers)}>
              <UserCog className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">Team members</span>
            </button>
          </nav>

          <div className="p-3 border-t border-white/10 space-y-0.5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 px-3">Settings</p>
            <NavLink to="/esf/settings" end className={({ isActive }) => navItemClass(isActive)}>
              <User className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">My profile</span>
            </NavLink>
            <NavLink to="/esf/settings?tab=password" className={({ isActive }) => navItemClass(isActive)}>
              <Key className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">Update password</span>
            </NavLink>
            <NavLink to="/esf/settings?tab=support" className={({ isActive }) => navItemClass(isActive)}>
              <HelpCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">Support</span>
            </NavLink>
          </div>

          <div className="p-3 border-t border-white/10">
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

      <div className="flex-1 flex flex-col min-w-0 lg:ml-[260px]">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 md:px-6 py-4 bg-[#0b0f17]/85 backdrop-blur-xl border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg text-gray-400 hover:bg-white/[0.05] hover:text-gray-200 lg:hidden shrink-0"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-100 tracking-tight truncate">{pageInfo.title}</h1>
              {pageInfo.subtitle && <p className="text-xs text-gray-500 truncate">{pageInfo.subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="text-sm font-medium text-gray-300 truncate max-w-[140px] md:max-w-[200px]"
              title={esfUser ? `${esfUser.firstName} ${esfUser.lastName}` : 'eStore Factory'}
            >
              {esfUser ? `${esfUser.firstName} ${esfUser.lastName}` : 'eStore Factory'}
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

export default EsfLayout;

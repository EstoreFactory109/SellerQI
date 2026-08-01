import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  Users,
  LogOut,
  Menu,
  CreditCard,
  ScrollText,
  MessageSquare,
  FileText,
  Mail,
  Activity,
} from 'lucide-react';
import axiosInstance from '../config/axios.config.js';
import sellerQILogo from '../assets/Logo/sellerQILogo.png';

const PAGE_TITLES = {
  '/manage-accounts': { title: 'Accounts', subtitle: 'Manage and monitor user accounts' },
  '/manage-accounts/subscription': { title: 'Subscription', subtitle: 'Subscription and billing' },
  '/manage-accounts/logs/email': { title: 'Email Logs', subtitle: 'Email delivery and logs' },
  '/manage-accounts/logs/payment': { title: 'Payment Logs', subtitle: 'Payment and transaction logs' },
  '/manage-accounts/logs/user': { title: 'User Logs', subtitle: 'User activity and session logs' },
  '/manage-accounts/ticket-messages': { title: 'User messages', subtitle: 'Ticket and support messages' },
};

const ManageAccountsLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logsDropdownOpen, setLogsDropdownOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const pathname = location.pathname;
  
  // Get page info - handle dynamic routes like /manage-accounts/logs/user/:userId
  const getPageInfo = () => {
    if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
    if (pathname.startsWith('/manage-accounts/logs/user/')) {
      return { title: 'User Log Details', subtitle: 'Activity and session logs for user' };
    }
    return { title: 'Admin', subtitle: '' };
  };
  const pageInfo = getPageInfo();
  const isAccounts = pathname === '/manage-accounts';
  const isEmailLogs = pathname === '/manage-accounts/logs/email';
  const isPaymentLogs = pathname === '/manage-accounts/logs/payment';
  const isUserLogs = pathname === '/manage-accounts/logs/user' || pathname.startsWith('/manage-accounts/logs/user/');

  useEffect(() => {
    if (isEmailLogs || isPaymentLogs || isUserLogs) setLogsDropdownOpen(true);
  }, [isEmailLogs, isPaymentLogs, isUserLogs]);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await axiosInstance.post('/app/auth/admin-logout');
      localStorage.removeItem('isAdminAuth');
      localStorage.removeItem('adminAccessType');
      localStorage.removeItem('adminId');
      navigate('/admin-login');
    } catch (err) {
      console.error('Logout error:', err);
      localStorage.removeItem('isAdminAuth');
      localStorage.removeItem('adminAccessType');
      localStorage.removeItem('adminId');
      navigate('/admin-login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  const navTo = (path) => {
    navigate(path);
    setSidebarOpen(false);
  };

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
            <button
              type="button"
              onClick={() => navTo('/manage-accounts')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                isAccounts ? 'bg-blue-500/15 border border-blue-500/30 text-blue-100 shadow-sm' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
              }`}
            >
              <Users className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">Accounts</span>
            </button>
            <button
              type="button"
              onClick={() => navTo('/manage-accounts/subscription')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                pathname === '/manage-accounts/subscription' ? 'bg-blue-500/15 border border-blue-500/30 text-blue-100 shadow-sm' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
              }`}
            >
              <CreditCard className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">Subscription</span>
            </button>
            <div>
              <button
                type="button"
                onClick={() => setLogsDropdownOpen(!logsDropdownOpen)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  isEmailLogs || isPaymentLogs || isUserLogs ? 'bg-white/[0.05] text-gray-200' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <ScrollText className="w-5 h-5 shrink-0" />
                  <span className="text-sm font-medium">Logs</span>
                </div>
                <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${logsDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {logsDropdownOpen && (
                <div className="ml-4 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                  <button
                    type="button"
                    onClick={() => navTo('/manage-accounts/logs/email')}
                    className={`w-full flex items-center gap-2 py-2 text-xs text-left transition-colors ${isEmailLogs ? 'text-gray-200' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    <Mail className="w-4 h-4 shrink-0" />
                    Email Logs
                  </button>
                  <button
                    type="button"
                    onClick={() => navTo('/manage-accounts/logs/payment')}
                    className={`w-full flex items-center gap-2 py-2 text-xs text-left transition-colors ${isPaymentLogs ? 'text-gray-200' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    <FileText className="w-4 h-4 shrink-0" />
                    Payment Logs
                  </button>
                  <button
                    type="button"
                    onClick={() => navTo('/manage-accounts/logs/user')}
                    className={`w-full flex items-center gap-2 py-2 text-xs text-left transition-colors ${isUserLogs ? 'text-gray-200' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    <Activity className="w-4 h-4 shrink-0" />
                    User Logs
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => navTo('/manage-accounts/ticket-messages')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                pathname === '/manage-accounts/ticket-messages' ? 'bg-blue-500/15 border border-blue-500/30 text-blue-100 shadow-sm' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
              }`}
            >
              <MessageSquare className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">User messages</span>
            </button>
          </nav>
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
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg text-gray-400 hover:bg-white/[0.05] hover:text-gray-200 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-100 tracking-tight">{pageInfo.title}</h1>
              {pageInfo.subtitle && <p className="text-xs text-gray-500">{pageInfo.subtitle}</p>}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default ManageAccountsLayout;

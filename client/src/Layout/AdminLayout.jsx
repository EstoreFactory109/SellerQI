import React, { useState } from 'react';
import { Outlet, useLocation, NavLink, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard,
  Users,
  Settings,
  Shield,
  Crown,
  LogOut,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  Bell,
  User,
  Search
} from 'lucide-react';
import { logout } from '../redux/slices/authSlice.js';
import axiosInstance from '../config/axios.config.js';

const AdminLayout = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  
  // Get admin user data from Redux store
  const user = useSelector((state) => state.Auth?.user);
  const isAdmin = user?.accessType === 'admin' || user?.accessType === 'enterpriseAdmin';
  
  // Get current tab from URL search params for settings pages
  const searchParams = new URLSearchParams(location.search);
  const currentTab = searchParams.get('tab') || 'overview';
  const isSettingsPage = location.pathname.includes('/admin/settings');
  
  // Keep settings dropdown open if we're on settings page
  React.useEffect(() => {
    if (isSettingsPage) {
      setSettingsDropdownOpen(true);
    }
  }, [isSettingsPage]);

  const handleLogout = async () => {
    try {
      // Call the admin logout API
      await axiosInstance.post('/app/auth/admin-logout');
      
      // Clear Redux state
      dispatch(logout());
      
      // Clear localStorage
      localStorage.removeItem('isAdminAuth');
      localStorage.removeItem('adminAccessType');
      localStorage.removeItem('adminId');
      
      // Navigate to login
      navigate('/admin/login');
    } catch (error) {
      console.error('Logout error:', error);
      // Even if API call fails, still clear local state and redirect
      dispatch(logout());
      localStorage.removeItem('isAdminAuth');
      localStorage.removeItem('adminAccessType');
      localStorage.removeItem('adminId');
      navigate('/admin/login');
    }
  };

  // Admin navigation items
  const navigationItems = [
    {
      label: 'Dashboard',
      icon: LayoutDashboard,
      path: '/admin/dashboard',
      description: 'Admin overview and analytics'
    },
    {
      label: 'Manage Accounts',
      icon: Users,
      path: '/admin/manage-accounts',
      description: 'User account management'
    },
    {
      label: 'Settings',
      icon: Settings,
      isDropdown: true,
      items: [
        {
          label: 'Admin User Profile',
          path: '/admin/settings?tab=admin-user-profile',
          tabKey: 'admin-user-profile'
        },
        {
          label: 'Admin Integrations',
          path: '/admin/settings?tab=admin-account-integration',
          tabKey: 'admin-account-integration'
        },
        {
          label: 'Plans & Billing',
          path: '/admin/settings?tab=admin-plans-billing',
          tabKey: 'admin-plans-billing'
        },
        {
          label: 'Admin Support',
          path: '/admin/settings?tab=admin-support',
          tabKey: 'admin-support'
        }
      ]
    }
  ];

  const isActiveRoute = (path) => {
    if (path.includes('?tab=')) {
      const [basePath, tabParam] = path.split('?tab=');
      return location.pathname === basePath && currentTab === tabParam;
    }
    return location.pathname === path;
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Admin Logo & Branding */}
      <div className="p-6 border-b border-gray-200/50 bg-gradient-to-r from-purple-50 to-indigo-50">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img 
              src="https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png" 
              alt="SellerQI Logo" 
              className="h-8 w-auto"
            />
            <div className="absolute -top-1 -right-1 bg-purple-600 rounded-full p-1">
              <Crown className="w-3 h-3 text-white" />
            </div>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Admin Panel</h1>
            <p className="text-xs text-purple-600 font-medium">Management Portal</p>
          </div>
        </div>
      </div>

      {/* Navigation Menu */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {navigationItems.map((item, index) => (
          <div key={index} className="space-y-1">
            {item.isDropdown ? (
              <div>
                <button
                  onClick={() => setSettingsDropdownOpen(!settingsDropdownOpen)}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 group ${
                    isSettingsPage
                      ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-lg shadow-purple-500/25'
                      : 'text-gray-700 hover:bg-white hover:shadow-md hover:text-purple-600 border border-transparent hover:border-gray-100'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </div>
                  <motion.div
                    animate={{ rotate: settingsDropdownOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </motion.div>
                </button>

                <AnimatePresence>
                  {settingsDropdownOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="ml-4 mt-2 space-y-1 overflow-hidden"
                    >
                      {item.items.map((subItem, subIndex) => (
                        <motion.div
                          key={subIndex}
                          initial={{ y: -10, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: -10, opacity: 0 }}
                          transition={{ delay: subIndex * 0.05, duration: 0.15 }}
                        >
                          <NavLink
                            to={subItem.path}
                            className={() =>
                              `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 ${
                                isSettingsPage && currentTab === subItem.tabKey
                                  ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/25'
                                  : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-purple-600'
                              }`
                            }
                          >
                            <div className="w-1.5 h-1.5 bg-current rounded-full opacity-60"></div>
                            {subItem.label}
                          </NavLink>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <NavLink
                to={item.path}
                className={() =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 group ${
                    isActiveRoute(item.path)
                      ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-lg shadow-purple-500/25'
                      : 'text-gray-700 hover:bg-white hover:shadow-md hover:text-purple-600 border border-transparent hover:border-gray-100'
                  }`
                }
              >
                <item.icon className="w-5 h-5" />
                <div className="flex-1">
                  <div className="font-medium">{item.label}</div>
                  {item.description && (
                    <div className="text-xs opacity-75 mt-0.5">{item.description}</div>
                  )}
                </div>
              </NavLink>
            )}
          </div>
        ))}
      </nav>

      {/* Admin Profile Section */}
      <div className="p-4 border-t border-gray-200/50 bg-gradient-to-r from-gray-50/50 to-white/50">
        <div className="relative">
          <button
            onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white hover:shadow-sm transition-all duration-300 group"
          >
            <div className="relative">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-full flex items-center justify-center">
                <Crown className="w-5 h-5 text-white" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-semibold text-gray-900">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="text-xs text-purple-600 font-medium">
                Admin • {user?.accessType}
              </div>
            </div>
            <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${profileDropdownOpen ? 'rotate-90' : ''}`} />
          </button>

          <AnimatePresence>
            {profileDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden"
              >
                <div className="p-2 space-y-1">
                  <button
                    onClick={() => navigate('/admin/profile')}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-600 rounded-lg transition-colors"
                  >
                    <User className="w-4 h-4" />
                    Admin Profile
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:w-80 lg:flex-col lg:fixed lg:inset-y-0 z-40">
        <div className="flex flex-col flex-1 bg-white border-r border-gray-200 shadow-sm">
          <SidebarContent />
        </div>
      </div>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-gray-900/50 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 left-0 w-80 bg-white border-r border-gray-200 shadow-xl z-50 lg:hidden"
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Admin Menu</h2>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <SidebarContent />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 lg:ml-80">
        {/* Top Header */}
        <header className="bg-white border-b border-gray-200 shadow-sm">
          <div className="flex items-center justify-between px-4 py-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors lg:hidden"
              >
                <Menu className="w-5 h-5" />
              </button>
              
              <div>
                <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-purple-600" />
                  Admin Dashboard
                </h1>
                <p className="text-sm text-gray-600">Management and system administration</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Search Bar */}
              <div className="hidden md:flex relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search admin panel..."
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent text-sm w-64"
                />
              </div>

              {/* Notifications */}
              <button className="p-2 rounded-lg hover:bg-gray-100 transition-colors relative">
                <Bell className="w-5 h-5 text-gray-600" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full"></span>
              </button>

              {/* Admin Badge */}
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-100 to-indigo-100 rounded-full border border-purple-200">
                <Crown className="w-4 h-4 text-purple-600" />
                <span className="text-xs font-semibold text-purple-700">ADMIN</span>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;

import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { 
  ChevronLeft, 
  ChevronRight, 
  Users, 
  Search, 
  Filter, 
  LogIn, 
  LogOut,
  Crown, 
  Shield, 
  Briefcase,
  Calendar,
  Mail,
  Phone,
  MoreVertical,
  Trash2,
  Edit3,
  Eye
} from 'lucide-react';
import axiosInstance from '../config/axios.config.js';

const ITEMS_PER_PAGE = 10;

// Mock data based on the user model schema
const mockUsers = [
  {
    _id: '1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    phone: '+1234567890',
    packageType: 'PRO',
    accessType: 'user',
    subscriptionStatus: 'active',
    isInTrialPeriod: false,
    isVerified: true,
    createdAt: '2024-01-15T10:30:00Z'
  },
  {
    _id: '2',
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane.smith@example.com',
    phone: '+1234567891',
    packageType: 'AGENCY',
    accessType: 'enterpriseAdmin',
    subscriptionStatus: 'active',
    isInTrialPeriod: false,
    isVerified: true,
    createdAt: '2024-01-10T14:20:00Z'
  },
  {
    _id: '3',
    firstName: 'Mike',
    lastName: 'Johnson',
    email: 'mike.johnson@example.com',
    phone: '+1234567892',
    packageType: 'LITE',
    accessType: 'user',
    subscriptionStatus: 'active',
    isInTrialPeriod: true,
    isVerified: true,
    createdAt: '2024-01-20T09:15:00Z'
  },
  {
    _id: '4',
    firstName: 'Sarah',
    lastName: 'Wilson',
    email: 'sarah.wilson@example.com',
    phone: '+1234567893',
    packageType: 'PRO',
    accessType: 'user',
    subscriptionStatus: 'inactive',
    isInTrialPeriod: false,
    isVerified: false,
    createdAt: '2024-01-08T16:45:00Z'
  },
  {
    _id: '5',
    firstName: 'David',
    lastName: 'Brown',
    email: 'david.brown@example.com',
    phone: '+1234567894',
    packageType: 'AGENCY',
    accessType: 'superAdmin',
    subscriptionStatus: 'active',
    isInTrialPeriod: false,
    isVerified: true,
    createdAt: '2024-01-05T11:30:00Z'
  },
  {
    _id: '6',
    firstName: 'Emily',
    lastName: 'Davis',
    email: 'emily.davis@example.com',
    phone: '+1234567895',
    packageType: 'LITE',
    accessType: 'user',
    subscriptionStatus: 'past_due',
    isInTrialPeriod: false,
    isVerified: true,
    createdAt: '2024-01-25T13:20:00Z'
  }
];

const ManageAccounts = () => {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [loginLoadingUsers, setLoginLoadingUsers] = useState(new Set());
  const [loginError, setLoginError] = useState('');

  // Filter and search users
  const filteredUsers = useMemo(() => {
    // Don't filter while loading or if no users
    if (loading || !users || users.length === 0) {
      return [];
    }
    
    let filtered = [...users]; // Create a copy to avoid mutations

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(user => {
        const firstName = user.firstName?.toLowerCase() || '';
        const lastName = user.lastName?.toLowerCase() || '';
        const email = user.email?.toLowerCase() || '';
        const searchLower = searchQuery.toLowerCase();
        
        return firstName.includes(searchLower) || 
               lastName.includes(searchLower) || 
               email.includes(searchLower);
      });
    }

    // Apply package type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(user => user.packageType === filterType);
    }

    return filtered;
  }, [users, searchQuery, filterType, loading]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / ITEMS_PER_PAGE));

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredUsers.slice(start, start + ITEMS_PER_PAGE);
  }, [currentPage, filteredUsers]);

  // Fetch accounts data
  const fetchAccounts = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await axiosInstance.get('/app/auth/admin/accounts');

      if(response.data.statusCode === 401){
        localStorage.removeItem('isAdminAuth');
        localStorage.removeItem('adminAccessType');
        localStorage.removeItem('adminId');
        navigate('/admin-login');
      }
      
      // Check for successful response (statusCode 200)
      if (response.data.statusCode === 200) {
        const accounts = response.data.data.accounts || [];
        setUsers(accounts);
        setStats(response.data.data.stats);
      } else {
        setError(response.data.message || 'Failed to load accounts data');
      }
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
      setError(error.response?.data?.message || 'Failed to load accounts data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [filteredUsers.length, totalPages, currentPage]);

  // Helper functions
  const getPackageTypeInfo = (packageType) => {
    switch (packageType) {
      case 'LITE':
        return { 
          icon: Shield, 
          color: 'text-blue-600', 
          bg: 'bg-blue-50', 
          border: 'border-blue-200',
          label: 'Lite'
        };
      case 'PRO':
        return { 
          icon: Crown, 
          color: 'text-purple-600', 
          bg: 'bg-purple-50', 
          border: 'border-purple-200',
          label: 'Pro'
        };
      case 'AGENCY':
        return { 
          icon: Briefcase, 
          color: 'text-emerald-600', 
          bg: 'bg-emerald-50', 
          border: 'border-emerald-200',
          label: 'Agency'
        };
      default:
        return { 
          icon: Shield, 
          color: 'text-gray-600', 
          bg: 'bg-gray-50', 
          border: 'border-gray-200',
          label: 'Unknown'
        };
    }
  };

  const getSubscriptionStatus = (status) => {
    switch (status) {
      case 'active':
        return { color: 'text-green-600', bg: 'bg-green-50', label: 'Active' };
      case 'inactive':
        return { color: 'text-gray-600', bg: 'bg-gray-50', label: 'Inactive' };
      case 'cancelled':
        return { color: 'text-red-600', bg: 'bg-red-50', label: 'Cancelled' };
      case 'past_due':
        return { color: 'text-orange-600', bg: 'bg-orange-50', label: 'Past Due' };
      default:
        return { color: 'text-gray-600', bg: 'bg-gray-50', label: 'Unknown' };
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const handleLoginAsUser = async (user) => {
    try {
      // Add user to loading set
      setLoginLoadingUsers(prev => new Set([...prev, user._id]));
      setLoginError('');
      
      console.log('Logging in as user:', user);
      
      // Call the admin login-as-user API
      const response = await axiosInstance.post('/app/auth/admin/login-as-user', {
        userId: user._id
      });
      
      if (response.data.statusCode === 200) {
        console.log('Successfully logged in as user:', response.data.data);
        
        // Store user info in localStorage (optional, for UI purposes)
        localStorage.setItem('loggedInAsUser', JSON.stringify({
          userId: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        }));
        
        // Navigate to the main dashboard as the selected user
        // The cookies (IbexAccessToken, IbexRefreshToken, LocationToken) are automatically set by the server
        window.location.href = '/seller-central-checker/dashboard';
      } else {
        setLoginError(response.data.message || 'Failed to login as user');
      }
    } catch (error) {
      console.error('Error logging in as user:', error);
      setLoginError(error.response?.data?.message || 'Failed to login as selected user');
    } finally {
      // Remove user from loading set
      setLoginLoadingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(user._id);
        return newSet;
      });
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      
      // Call the admin logout API
      await axiosInstance.post('/app/auth/admin-logout');
      
      // Clear localStorage
      localStorage.removeItem('isAdminAuth');
      localStorage.removeItem('adminAccessType');
      localStorage.removeItem('adminId');
      
      // Navigate to login
      navigate('/admin-login');
    } catch (error) {
      console.error('Logout error:', error);
      // Even if API call fails, still clear local state and redirect
      localStorage.removeItem('isAdminAuth');
      localStorage.removeItem('adminAccessType');
      localStorage.removeItem('adminId');
      navigate('/admin/login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  const getPaginationGroup = () => {
    const group = [];
    const maxButtons = 5;

    if (totalPages <= maxButtons) {
      for (let i = 1; i <= totalPages; i++) group.push(i);
    } else {
      let startPage = Math.max(1, currentPage - 2);
      let endPage = Math.min(totalPages, currentPage + 2);

      if (currentPage <= 3) {
        startPage = 1;
        endPage = 5;
      } else if (currentPage >= totalPages - 2) {
        startPage = totalPages - 4;
        endPage = totalPages;
      }

      for (let i = startPage; i <= endPage; i++) group.push(i);
    }

    return group;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 via-white to-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <Users className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Manage Accounts</h1>
                <p className="text-gray-600">Manage and monitor user accounts across your platform</p>
              </div>
            </div>
            
            {/* Logout Button */}
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                isLoggingOut
                  ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                  : 'bg-red-600 text-white hover:bg-red-700 shadow-lg hover:shadow-xl transform hover:scale-105'
              }`}
            >
              <LogOut className="w-4 h-4" />
              {isLoggingOut ? 'Logging out...' : 'Logout'}
            </button>
          </div>
        </motion.div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            <p className="ml-4 text-gray-600">Loading accounts...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-700 font-medium">Error: {error}</p>
            <button 
              onClick={fetchAccounts}
              className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Login Error State */}
        {loginError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-700 font-medium">Login Error: {loginError}</p>
            <button 
              onClick={() => setLoginError('')}
              className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Search and Filter Bar */}
        {!loading && !error && (
        <>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6"
        >
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Search users by name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300"
                />
              </div>
            </div>

            {/* Filter */}
            <div className="lg:w-64">
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300 appearance-none bg-white"
                >
                  <option value="all">All User Types</option>
                  <option value="LITE">Lite Users</option>
                  <option value="PRO">Pro Users</option>
                  <option value="AGENCY">Agency Users</option>
                </select>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
            <div className="text-center">
              <p className="text-2xl font-bold text-indigo-600">{filteredUsers.length}</p>
              <p className="text-sm text-gray-600">Total Users</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">
                {filteredUsers.filter(u => u.subscriptionStatus === 'active').length}
              </p>
              <p className="text-sm text-gray-600">Active</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">
                {filteredUsers.filter(u => u.packageType === 'PRO').length}
              </p>
              <p className="text-sm text-gray-600">Pro Users</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-600">
                {filteredUsers.filter(u => u.packageType === 'AGENCY').length}
              </p>
              <p className="text-sm text-gray-600">Agency Users</p>
            </div>
          </div>
        </motion.div>

        {/* Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Name & Contact
                    </div>
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    User Type
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Created At
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                <AnimatePresence>
                  {paginatedData.map((user, index) => {
                    const packageInfo = getPackageTypeInfo(user.packageType);
                    const statusInfo = getSubscriptionStatus(user.subscriptionStatus);
                    const PackageIcon = packageInfo.icon;

                    return (
                      <motion.tr
                        key={user._id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.3, delay: index * 0.05 }}
                        className="hover:bg-gray-50 transition-colors duration-200"
                      >
                        {/* Name & Contact */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-sm">
                              <span className="text-white font-semibold text-sm">
                                {user.firstName.charAt(0)}{user.lastName.charAt(0)}
                              </span>
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">
                                {user.firstName} {user.lastName}
                                {user.isInTrialPeriod && (
                                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                    Trial
                                  </span>
                                )}
                              </p>
                              <div className="flex items-center gap-4 mt-1">
                                <div className="flex items-center gap-1">
                                  <Mail className="w-3 h-3 text-gray-400" />
                                  <p className="text-xs text-gray-600">{user.email}</p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Phone className="w-3 h-3 text-gray-400" />
                                  <p className="text-xs text-gray-600">{user.phone}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* User Type */}
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center">
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${packageInfo.bg} ${packageInfo.border}`}>
                              <PackageIcon className={`w-4 h-4 ${packageInfo.color}`} />
                              <span className={`text-sm font-medium ${packageInfo.color}`}>
                                {packageInfo.label}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center">
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${statusInfo.bg}`}>
                              <div className={`w-2 h-2 rounded-full ${statusInfo.color.replace('text-', 'bg-')}`}></div>
                              <span className={`text-sm font-medium ${statusInfo.color}`}>
                                {statusInfo.label}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Created At */}
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-600">
                              {formatDate(user.createdAt)}
                            </span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleLoginAsUser(user)}
                              disabled={loginLoadingUsers.has(user._id)}
                              className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-200 shadow-sm hover:shadow-md ${
                                loginLoadingUsers.has(user._id)
                                  ? 'bg-gray-400 text-gray-200 cursor-not-allowed' 
                                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
                              }`}
                            >
                              {loginLoadingUsers.has(user._id) ? (
                                <>
                                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                  Logging in...
                                </>
                              ) : (
                                <>
                                  <LogIn className="w-4 h-4" />
                                  Login
                                </>
                              )}
                            </button>
                            <div className="relative group">
                              <button className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors duration-200">
                                <MoreVertical className="w-4 h-4" />
                              </button>
                              <div className="absolute right-0 top-8 w-36 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
                                <button className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                  <Eye className="w-3 h-3" />
                                  View Details
                                </button>
                                <button className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                  <Edit3 className="w-3 h-3" />
                                  Edit User
                                </button>
                                <button className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                                  <Trash2 className="w-3 h-3" />
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
              <div className="flex items-center gap-4">
                <p className="text-sm text-gray-600">
                  Showing <span className="font-medium">{filteredUsers.length > 0 ? ((currentPage - 1) * ITEMS_PER_PAGE) + 1 : 0}</span> to{' '}
                  <span className="font-medium">{Math.min(currentPage * ITEMS_PER_PAGE, filteredUsers.length)}</span> of{' '}
                  <span className="font-medium">{filteredUsers.length}</span> accounts
                </p>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    currentPage === 1
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                      : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                
                <div className="flex items-center gap-1">
                  {getPaginationGroup().map((page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                        currentPage === page
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    currentPage === totalPages
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                      : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 hover:border-gray-400'
                  }`}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </motion.div>

        {/* Empty State */}
        {filteredUsers.length === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="text-center py-12 bg-white rounded-2xl border border-gray-200 shadow-sm"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center">
                <Users className="w-8 h-8 text-gray-400" />
              </div>
              <div className="space-y-2">
                <h4 className="text-lg font-semibold text-gray-900">No Users Found</h4>
                <p className="text-sm text-gray-600 max-w-md">
                  No users match your current search criteria. Try adjusting your search or filter options.
                </p>
              </div>
            </div>
          </motion.div>
        )}
        </>
        )}
      </div>
    </div>
  );
};

export default ManageAccounts;

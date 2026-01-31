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
  CalendarDays,
  X,
  Download,
  FileText,
  Link,
  Zap,
  Trash2
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
  const [brandSearchQuery, setBrandSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [spApiFilter, setSpApiFilter] = useState('all'); // 'all', 'connected', 'not-connected'
  const [adsFilter, setAdsFilter] = useState('all'); // 'all', 'connected', 'not-connected'
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [loginLoadingUsers, setLoginLoadingUsers] = useState(new Set());
  const [loginError, setLoginError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [deletingUsers, setDeletingUsers] = useState(new Set());
  const [deleteError, setDeleteError] = useState('');
  const [deleteConfirmUser, setDeleteConfirmUser] = useState(null);
  const [deleteSuccess, setDeleteSuccess] = useState('');

  // Helper functions to check API connection status (defined before useMemo)
  const getSpApiConnectionStatus = (user) => {
    if (!user.sellerCentral || !user.sellerCentral.sellerAccount || user.sellerCentral.sellerAccount.length === 0) {
      return { connected: false, label: 'Not Connected', color: 'text-red-600', bg: 'bg-red-50' };
    }
    
    const hasSpApiToken = user.sellerCentral.sellerAccount.some(account => 
      account.spiRefreshToken && account.spiRefreshToken.trim() !== ''
    );
    
    return hasSpApiToken 
      ? { connected: true, label: 'Connected', color: 'text-green-600', bg: 'bg-green-50' }
      : { connected: false, label: 'Not Connected', color: 'text-red-600', bg: 'bg-red-50' };
  };

  const getAdsApiConnectionStatus = (user) => {
    if (!user.sellerCentral || !user.sellerCentral.sellerAccount || user.sellerCentral.sellerAccount.length === 0) {
      return { connected: false, label: 'Not Connected', color: 'text-red-600', bg: 'bg-red-50' };
    }
    
    const hasAdsApiToken = user.sellerCentral.sellerAccount.some(account => 
      account.adsRefreshToken && account.adsRefreshToken.trim() !== ''
    );
    
    return hasAdsApiToken 
      ? { connected: true, label: 'Connected', color: 'text-green-600', bg: 'bg-green-50' }
      : { connected: false, label: 'Not Connected', color: 'text-red-600', bg: 'bg-red-50' };
  };

  // Filter and search users
  const filteredUsers = useMemo(() => {
    // Don't filter while loading or if no users
    if (loading || !users || users.length === 0) {
      return [];
    }
    
    let filtered = [...users]; // Create a copy to avoid mutations

    // Apply search filter (name, email, brand)
    if (searchQuery) {
      filtered = filtered.filter(user => {
        const firstName = user.firstName?.toLowerCase() || '';
        const lastName = user.lastName?.toLowerCase() || '';
        const email = user.email?.toLowerCase() || '';
        const brand = (user.brand && String(user.brand).toLowerCase()) || '';
        const searchLower = searchQuery.toLowerCase();
        
        return firstName.includes(searchLower) || 
               lastName.includes(searchLower) || 
               email.includes(searchLower) ||
               brand.includes(searchLower);
      });
    }

    // Apply brand filter
    if (brandSearchQuery) {
      const brandLower = brandSearchQuery.toLowerCase().trim();
      filtered = filtered.filter(user => {
        const brand = (user.brand && String(user.brand).toLowerCase()) || '';
        return brand.includes(brandLower);
      });
    }

    // Apply package type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(user => user.packageType === filterType);
    }

    // Apply date range filter
    if (startDate || endDate) {
      filtered = filtered.filter(user => {
        const userDate = new Date(user.createdAt);
        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;
        
        // Set time to start/end of day for proper comparison
        if (start) {
          start.setHours(0, 0, 0, 0);
        }
        if (end) {
          end.setHours(23, 59, 59, 999);
        }
        
        if (start && end) {
          return userDate >= start && userDate <= end;
        } else if (start) {
          return userDate >= start;
        } else if (end) {
          return userDate <= end;
        }
        
        return true;
      });
    }

    // Apply SP-API connection filter
    if (spApiFilter !== 'all') {
      filtered = filtered.filter(user => {
        const spApiStatus = getSpApiConnectionStatus(user);
        return spApiFilter === 'connected' 
          ? spApiStatus.connected 
          : !spApiStatus.connected;
      });
    }

    // Apply Ads API connection filter
    if (adsFilter !== 'all') {
      filtered = filtered.filter(user => {
        const adsApiStatus = getAdsApiConnectionStatus(user);
        return adsFilter === 'connected' 
          ? adsApiStatus.connected 
          : !adsApiStatus.connected;
      });
    }

    return filtered;
  }, [users, searchQuery, brandSearchQuery, filterType, startDate, endDate, spApiFilter, adsFilter, loading]);

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
  const getPackageTypeInfo = (user) => {
    // If user has expired trial or inactive subscription, show as downgraded
    const isExpiredOrInactive = 
      user.isTrialExpired || 
      (user.isInTrialPeriod && user.trialEndsDate && new Date() > new Date(user.trialEndsDate)) ||
      user.subscriptionStatus === 'inactive' ||
      user.subscriptionStatus === 'cancelled';
    
    // Get the base package type, but show as inactive if expired
    let packageType = user.packageType;
    
    switch (packageType) {
      case 'LITE':
        return { 
          icon: Shield, 
          color: isExpiredOrInactive ? 'text-gray-500' : 'text-blue-600', 
          bg: isExpiredOrInactive ? 'bg-gray-50' : 'bg-blue-50', 
          border: isExpiredOrInactive ? 'border-gray-200' : 'border-blue-200',
          label: isExpiredOrInactive ? 'Lite (Inactive)' : 'Lite'
        };
      case 'PRO':
        return { 
          icon: Crown, 
          color: isExpiredOrInactive ? 'text-gray-500' : 'text-purple-600', 
          bg: isExpiredOrInactive ? 'bg-gray-50' : 'bg-purple-50', 
          border: isExpiredOrInactive ? 'border-gray-200' : 'border-purple-200',
          label: isExpiredOrInactive ? 'Pro (Inactive)' : 'Pro'
        };
      case 'AGENCY':
        return { 
          icon: Briefcase, 
          color: isExpiredOrInactive ? 'text-gray-500' : 'text-emerald-600', 
          bg: isExpiredOrInactive ? 'bg-gray-50' : 'bg-emerald-50', 
          border: isExpiredOrInactive ? 'border-gray-200' : 'border-emerald-200',
          label: isExpiredOrInactive ? 'Agency (Inactive)' : 'Agency'
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

  const getSubscriptionStatus = (user) => {
    // Check if trial is expired first
    if (user.isTrialExpired || (user.isInTrialPeriod && user.trialEndsDate && new Date() > new Date(user.trialEndsDate))) {
      return { color: 'text-red-600', bg: 'bg-red-50', label: 'Trial Expired' };
    }
    
    // If user is in trial period and not expired
    if (user.isInTrialPeriod) {
      return { color: 'text-blue-600', bg: 'bg-blue-50', label: 'Trial Active' };
    }
    
    // Handle regular subscription status
    switch (user.subscriptionStatus) {
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


  const clearDateFilters = () => {
    setStartDate('');
    setEndDate('');
  };

  // Export functions
  const convertToCSV = (data) => {
    if (!data || data.length === 0) return '';
    
    const headers = [
      'Name',
      'Email', 
      'Phone',
      'Package Type',
      'Access Type',
      'Subscription Status',
      'Trial Period',
      'SpAPI Connected',
      'Ads API Connected',
      'Verified',
      'Registration Date'
    ];
    
    const csvContent = [
      headers.join(','),
      ...data.map(user => {
        const spApiStatus = getSpApiConnectionStatus(user);
        const adsApiStatus = getAdsApiConnectionStatus(user);
        
        return [
          `"${user.firstName} ${user.lastName}"`,
          `"${user.email}"`,
          `"${user.phone || 'N/A'}"`,
          `"${user.packageType}"`,
          `"${user.accessType || 'user'}"`,
          `"${user.subscriptionStatus}"`,
          `"${user.isInTrialPeriod ? 'Yes' : 'No'}"`,
          `"${spApiStatus.connected ? 'Yes' : 'No'}"`,
          `"${adsApiStatus.connected ? 'Yes' : 'No'}"`,
          `"${user.isVerified ? 'Yes' : 'No'}"`,
          `"${formatDate(user.createdAt)}"`
        ].join(',');
      })
    ].join('\n');
    
    return csvContent;
  };

  const downloadFile = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const exportToCSV = async () => {
    try {
      setIsExporting(true);
      setExportError('');
      const csvContent = convertToCSV(filteredUsers);
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `users-export-${timestamp}.csv`;
      downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      setExportError('Error exporting to CSV. Please try again.');
      setTimeout(() => {
        setExportError('');
      }, 5000);
    } finally {
      setIsExporting(false);
    }
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

  const handleDeleteUser = async (user) => {
    try {
      // Add user to deleting set
      setDeletingUsers(prev => new Set([...prev, user._id]));
      setDeleteError('');
      
      console.log('Deleting user:', user);
      
      // Call the delete user API
      const response = await axiosInstance.delete(`/app/auth/admin/users/${user._id}`);
      
      if (response.data.statusCode === 200) {
        console.log('Successfully deleted user:', response.data.data);
        
        // Remove user from local state
        setUsers(prevUsers => prevUsers.filter(u => u._id !== user._id));
        
        // Close confirmation dialog
        setDeleteConfirmUser(null);
        
        // Show success message
        setDeleteSuccess(`User ${user.firstName} ${user.lastName} (${user.email}) has been deleted successfully.`);
        
        // Clear success message after 5 seconds
        setTimeout(() => {
          setDeleteSuccess('');
        }, 5000);
      } else {
        setDeleteError(response.data.message || 'Failed to delete user');
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      setDeleteError(error.response?.data?.message || 'Failed to delete user');
    } finally {
      // Remove user from deleting set
      setDeletingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(user._id);
        return newSet;
      });
    }
  };

  const openDeleteConfirm = (user) => {
    setDeleteConfirmUser(user);
    setDeleteError('');
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirmUser(null);
    setDeleteError('');
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
            
            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {/* Export CSV Button */}
              {!loading && !error && filteredUsers.length > 0 && (
                <button
                  onClick={exportToCSV}
                  disabled={isExporting}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                    isExporting
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-green-600 text-white hover:bg-green-700 shadow-lg hover:shadow-xl transform hover:scale-105'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  {isExporting ? 'Exporting...' : 'Export CSV'}
                </button>
              )}
              
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

        {/* Delete Error State */}
        {deleteError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-700 font-medium">Delete Error: {deleteError}</p>
            <button 
              onClick={() => setDeleteError('')}
              className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Delete Success State */}
        {deleteSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6"
          >
            <p className="text-green-700 font-medium">✓ {deleteSuccess}</p>
          </motion.div>
        )}

        {/* Export Error State */}
        {exportError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6"
          >
            <p className="text-red-700 font-medium">Export Error: {exportError}</p>
            <button 
              onClick={() => setExportError('')}
              className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Dismiss
            </button>
          </motion.div>
        )}

        {/* Delete Confirmation Dialog */}
        {deleteConfirmUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={closeDeleteConfirm}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Delete User</h3>
                  <p className="text-sm text-gray-600">This action cannot be undone</p>
                </div>
              </div>
              
              <div className="mb-6">
                <p className="text-gray-700 mb-2">
                  Are you sure you want to delete this user?
                </p>
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <p className="font-medium text-gray-900">
                    {deleteConfirmUser.firstName} {deleteConfirmUser.lastName}
                  </p>
                  <p className="text-sm text-gray-600">{deleteConfirmUser.email}</p>
                </div>
                <p className="text-sm text-red-600 mt-3">
                  ⚠️ This will permanently delete the user account and all associated seller documents.
                </p>
              </div>

              {deleteError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{deleteError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={closeDeleteConfirm}
                  disabled={deletingUsers.has(deleteConfirmUser._id)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteUser(deleteConfirmUser)}
                  disabled={deletingUsers.has(deleteConfirmUser._id)}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                    deletingUsers.has(deleteConfirmUser._id)
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  }`}
                >
                  {deletingUsers.has(deleteConfirmUser._id) ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Deleting...
                    </span>
                  ) : (
                    'Delete User'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
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
          <div className="flex flex-col gap-4">
            {/* First Row: Search, Brand Search, and Package Filter */}
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Search */}
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    placeholder="Search by name, email, or brand..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300"
                  />
                </div>
              </div>

              {/* Brand Search */}
              <div className="lg:w-56">
                <div className="relative">
                  <Briefcase className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    placeholder="Search by brand..."
                    value={brandSearchQuery}
                    onChange={(e) => setBrandSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300"
                  />
                  {brandSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setBrandSearchQuery('')}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      aria-label="Clear brand search"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Package Type Filter */}
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

            {/* Second Row: Date Filters and API Connection Filters */}
            <div className="flex flex-col gap-4">
              {/* Date Range Row */}
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                {/* Date Filter Label */}
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 sm:w-24">
                  <CalendarDays className="w-4 h-4" />
                  Date Range:
                </div>
                
                {/* Date Inputs */}
                <div className="flex flex-col sm:flex-row gap-3 flex-1">
                  <div className="relative flex-1">
                    <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="date"
                      placeholder="Start Date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300 text-sm"
                    />
                  </div>
                  
                  <div className="flex items-center justify-center text-gray-400 px-2">
                    <span className="text-sm">to</span>
                  </div>
                  
                  <div className="relative flex-1">
                    <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="date"
                      placeholder="End Date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300 text-sm"
                    />
                  </div>
                  
                  {/* Clear Date Filter Button */}
                  {(startDate || endDate) && (
                    <button
                      onClick={clearDateFilters}
                      className="flex items-center gap-1 px-3 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200"
                      title="Clear date filters"
                    >
                      <X className="w-4 h-4" />
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* API Connection Filters Row */}
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                {/* API Filters Label */}
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 sm:w-24">
                  <Link className="w-4 h-4" />
                  API Status:
                </div>
                
                {/* API Filter Dropdowns */}
                <div className="flex flex-col sm:flex-row gap-3 flex-1">
                  {/* SP-API Filter */}
                  <div className="relative flex-1 sm:max-w-[200px]">
                    <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <select
                      value={spApiFilter}
                      onChange={(e) => setSpApiFilter(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300 text-sm appearance-none bg-white"
                    >
                      <option value="all">All SP-API</option>
                      <option value="connected">SP-API Connected</option>
                      <option value="not-connected">SP-API Not Connected</option>
                    </select>
                  </div>
                  
                  {/* Ads API Filter */}
                  <div className="relative flex-1 sm:max-w-[200px]">
                    <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <select
                      value={adsFilter}
                      onChange={(e) => setAdsFilter(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300 text-sm appearance-none bg-white"
                    >
                      <option value="all">All Ads API</option>
                      <option value="connected">Ads API Connected</option>
                      <option value="not-connected">Ads API Not Connected</option>
                    </select>
                  </div>
                  
                  {/* Clear API Filters Button */}
                  {(spApiFilter !== 'all' || adsFilter !== 'all') && (
                    <button
                      onClick={() => {
                        setSpApiFilter('all');
                        setAdsFilter('all');
                      }}
                      className="flex items-center gap-1 px-3 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200"
                      title="Clear API filters"
                    >
                      <X className="w-4 h-4" />
                      Clear API
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Stats and Export Summary */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
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
            
            {/* Export Summary */}
            {filteredUsers.length > 0 && (
              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                <div className="text-sm text-gray-600">
                  {searchQuery || brandSearchQuery || filterType !== 'all' || startDate || endDate || spApiFilter !== 'all' || adsFilter !== 'all' ? (
                    <span>
                      <span className="font-medium">{filteredUsers.length}</span> users match your filters
                    </span>
                  ) : (
                    <span>
                      Showing all <span className="font-medium">{filteredUsers.length}</span> registered users
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Quick Export:</span>
                  <button
                    onClick={exportToCSV}
                    disabled={isExporting}
                    className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors duration-200 disabled:opacity-50"
                  >
                    CSV
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
        >
          <table className="w-full table-fixed">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="w-1/4 px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      <span className="hidden sm:inline">Name & Email</span>
                      <span className="sm:hidden">User</span>
                    </div>
                  </th>
                  <th className="w-1/8 px-2 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <div className="flex items-center justify-center gap-1">
                      <Phone className="w-3 h-3" />
                      <span className="hidden lg:inline text-xs">Phone</span>
                    </div>
                  </th>
                  <th className="w-1/8 px-2 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <span className="text-xs">Type</span>
                  </th>
                  <th className="w-1/8 px-2 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <span className="text-xs">Brands</span>
                  </th>
                  <th className="w-1/8 px-2 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <span className="text-xs">Status</span>
                  </th>
                  <th className="w-1/12 px-2 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <span className="text-xs">SpAPI</span>
                  </th>
                  <th className="w-1/12 px-2 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <span className="text-xs">Ads</span>
                  </th>
                  <th className="w-1/8 px-2 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <span className="text-xs">Created</span>
                  </th>
                  <th className="w-1/8 px-2 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <span className="text-xs">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                <AnimatePresence>
                  {paginatedData.map((user, index) => {
                    const packageInfo = getPackageTypeInfo(user);
                    const statusInfo = getSubscriptionStatus(user);
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
                        {/* Name & Email */}
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
                              <span className="text-white font-semibold text-xs">
                                {user.firstName.charAt(0)}{user.lastName.charAt(0)}
                              </span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-gray-900 truncate">
                                {user.firstName} {user.lastName}
                                {user.isInTrialPeriod && (
                                  <span className="ml-1 inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                                    T
                                  </span>
                                )}
                              </p>
                              <div className="flex items-center gap-1 mt-0.5">
                                <Mail className="w-2 h-2 text-gray-400 flex-shrink-0" />
                                <p className="text-xs text-gray-600 truncate">{user.email}</p>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Phone Number */}
                        <td className="px-2 py-3 text-center">
                          <div className="flex flex-col items-center">
                            <Phone className="w-3 h-3 text-gray-400 lg:hidden" />
                            <span className="text-xs text-gray-700 font-medium truncate max-w-full">
                              <span className="hidden lg:inline">{user.phone || 'N/A'}</span>
                              <span className="lg:hidden">{user.phone ? '✓' : '✗'}</span>
                            </span>
                          </div>
                        </td>

                        {/* User Type */}
                        <td className="px-2 py-3 text-center">
                          <div className="flex items-center justify-center">
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-full border ${packageInfo.bg} ${packageInfo.border}`}>
                              <PackageIcon className={`w-3 h-3 ${packageInfo.color}`} />
                              <span className={`text-xs font-medium ${packageInfo.color} hidden sm:inline`}>
                                {packageInfo.label.split(' ')[0]}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Brands */}
                        <td className="px-2 py-3 text-left">
                          <div className="flex items-center justify-start">
                            <span className="text-xs text-gray-700 font-medium truncate max-w-full">
                              {user.brand || 'N/A'}
                            </span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-2 py-3 text-center">
                          <div className="flex items-center justify-center">
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${statusInfo.bg}`}>
                              <div className={`w-2 h-2 rounded-full ${statusInfo.color.replace('text-', 'bg-')}`}></div>
                              <span className={`text-xs font-medium ${statusInfo.color} hidden md:inline`}>
                                {statusInfo.label.split(' ')[0]}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* SpAPI Connection Status */}
                        <td className="px-2 py-3 text-center">
                          {(() => {
                            const spApiStatus = getSpApiConnectionStatus(user);
                            return (
                              <span className={`text-xs font-medium ${spApiStatus.color}`}>
                                {spApiStatus.connected ? 'Yes' : 'No'}
                              </span>
                            );
                          })()}
                        </td>

                        {/* Ads API Connection Status */}
                        <td className="px-2 py-3 text-center">
                          {(() => {
                            const adsApiStatus = getAdsApiConnectionStatus(user);
                            return (
                              <span className={`text-xs font-medium ${adsApiStatus.color}`}>
                                {adsApiStatus.connected ? 'Yes' : 'No'}
                              </span>
                            );
                          })()}
                        </td>

                        {/* Created At */}
                        <td className="px-2 py-3 text-center">
                          <div className="flex flex-col items-center">
                            <Calendar className="w-3 h-3 text-gray-400 md:hidden" />
                            <span className="text-xs text-gray-600">
                              <span className="hidden md:inline">{formatDate(user.createdAt)}</span>
                              <span className="md:hidden">{new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            </span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleLoginAsUser(user)}
                              disabled={loginLoadingUsers.has(user._id)}
                              className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors duration-200 ${
                                loginLoadingUsers.has(user._id)
                                  ? 'bg-gray-400 text-gray-200 cursor-not-allowed' 
                                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
                              }`}
                            >
                              {loginLoadingUsers.has(user._id) ? (
                                <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                              ) : (
                                <>
                                  <LogIn className="w-3 h-3" />
                                  <span className="hidden lg:inline">Login</span>
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => openDeleteConfirm(user)}
                              disabled={deletingUsers.has(user._id)}
                              className={`flex items-center justify-center w-8 h-8 text-base font-medium rounded transition-all duration-200 ${
                                deletingUsers.has(user._id)
                                  ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                                  : 'bg-red-600 text-white hover:bg-red-700 hover:scale-105 active:scale-95'
                              }`}
                              title="Delete user"
                            >
                              {deletingUsers.has(user._id) ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>

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

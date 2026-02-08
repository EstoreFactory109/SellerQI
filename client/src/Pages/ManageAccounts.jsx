import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ChevronLeft, 
  ChevronRight, 
  Users, 
  Search, 
  Filter, 
  LogIn,
  Crown, 
  Shield, 
  Briefcase,
  Mail,
  CalendarDays,
  X,
  Trash2,
  MoreVertical,
  Check,
  X as XIcon,
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
  const [loginLoadingUsers, setLoginLoadingUsers] = useState(new Set());
  const [loginError, setLoginError] = useState('');
  const [deletingUsers, setDeletingUsers] = useState(new Set());
  const [deleteError, setDeleteError] = useState('');
  const [deleteConfirmUser, setDeleteConfirmUser] = useState(null);
  const [deleteSuccess, setDeleteSuccess] = useState('');
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const dropdownRef = useRef(null);

  // Helper functions to check API connection status (defined before useMemo)
  const getSpApiConnectionStatus = (user) => {
    if (!user.sellerCentral || !user.sellerCentral.sellerAccount || user.sellerCentral.sellerAccount.length === 0) {
      return { connected: false, label: 'Not Connected', color: 'text-red-400', bg: 'bg-red-500/10' };
    }
    
    const hasSpApiToken = user.sellerCentral.sellerAccount.some(account => 
      account.spiRefreshToken && account.spiRefreshToken.trim() !== ''
    );
    
    return hasSpApiToken 
      ? { connected: true, label: 'Connected', color: 'text-green-400', bg: 'bg-green-500/10' }
      : { connected: false, label: 'Not Connected', color: 'text-red-400', bg: 'bg-red-500/10' };
  };

  const getAdsApiConnectionStatus = (user) => {
    if (!user.sellerCentral || !user.sellerCentral.sellerAccount || user.sellerCentral.sellerAccount.length === 0) {
      return { connected: false, label: 'Not Connected', color: 'text-red-400', bg: 'bg-red-500/10' };
    }
    
    const hasAdsApiToken = user.sellerCentral.sellerAccount.some(account => 
      account.adsRefreshToken && account.adsRefreshToken.trim() !== ''
    );
    
    return hasAdsApiToken 
      ? { connected: true, label: 'Connected', color: 'text-green-400', bg: 'bg-green-500/10' }
      : { connected: false, label: 'Not Connected', color: 'text-red-400', bg: 'bg-red-500/10' };
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Helper functions - muted colors to match existing app
  const getPackageTypeInfo = (user) => {
    const isExpiredOrInactive =
      user.isTrialExpired ||
      (user.isInTrialPeriod && user.trialEndsDate && new Date() > new Date(user.trialEndsDate)) ||
      user.subscriptionStatus === 'inactive' ||
      user.subscriptionStatus === 'cancelled';

    let packageType = user.packageType;

    switch (packageType) {
      case 'LITE':
        return {
          icon: Shield,
          color: isExpiredOrInactive ? 'text-gray-500' : 'text-gray-300',
          label: isExpiredOrInactive ? 'Lite (Inactive)' : 'Lite'
        };
      case 'PRO':
        return {
          icon: Crown,
          color: isExpiredOrInactive ? 'text-gray-500' : 'text-yellow-500',
          label: isExpiredOrInactive ? 'Pro (Inactive)' : 'Pro'
        };
      case 'AGENCY':
        return {
          icon: Briefcase,
          color: isExpiredOrInactive ? 'text-gray-500' : 'text-yellow-500',
          label: isExpiredOrInactive ? 'Agency (Inactive)' : 'Agency'
        };
      default:
        return { icon: Shield, color: 'text-gray-400', label: 'Unknown' };
    }
  };

  const getSubscriptionStatus = (user) => {
    if (user.isTrialExpired || (user.isInTrialPeriod && user.trialEndsDate && new Date() > new Date(user.trialEndsDate))) {
      return { color: 'text-blue-500', label: 'Trial Expired' };
    }
    if (user.isInTrialPeriod) {
      return { color: 'text-blue-500', label: 'Trial Active' };
    }
    switch (user.subscriptionStatus) {
      case 'active':
        return { color: 'text-green-500', label: 'Active' };
      case 'inactive':
        return { color: 'text-gray-500', label: 'Inactive' };
      case 'cancelled':
        return { color: 'text-red-500', label: 'Cancelled' };
      case 'past_due':
        return { color: 'text-gray-400', label: 'Past Due' };
      default:
        return { color: 'text-gray-500', label: 'Unknown' };
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
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto w-full">
          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#333] border-t-blue-500" />
              <p className="ml-3 text-sm text-gray-500">Loading accounts…</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 mb-6">
              <p className="text-sm font-medium text-red-300">Error: {error}</p>
              <button
                onClick={fetchAccounts}
                className="mt-3 px-3 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Login Error State */}
          {loginError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 mb-6">
              <p className="text-sm font-medium text-red-300">Login Error: {loginError}</p>
              <button
                onClick={() => setLoginError('')}
                className="mt-2 px-3 py-2 text-sm rounded-lg bg-[#252525] text-gray-300 hover:bg-[#333] transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Delete Error State */}
          {deleteError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 mb-6">
              <p className="text-sm font-medium text-red-300">Delete Error: {deleteError}</p>
              <button
                onClick={() => setDeleteError('')}
                className="mt-2 px-3 py-2 text-sm rounded-lg bg-[#252525] text-gray-300 hover:bg-[#333] transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Delete Success State */}
          {deleteSuccess && (
            <div className="rounded-lg border border-[#252525] bg-[#161b22] p-4 mb-6">
              <p className="text-sm font-medium text-gray-300">✓ {deleteSuccess}</p>
            </div>
          )}

          {/* Delete Confirmation Dialog */}
          {deleteConfirmUser && (
            <div
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
              onClick={closeDeleteConfirm}
            >
              <div
                className="bg-[#161b22] rounded-lg max-w-md w-full p-6 border border-[#30363d]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                    <Trash2 className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-100">Delete User</h3>
                    <p className="text-xs text-gray-500">This action cannot be undone</p>
                  </div>
                </div>
                <div className="mb-5">
                  <p className="text-sm text-gray-400 mb-2">Are you sure you want to delete this user?</p>
                  <div className="rounded-lg p-3 bg-[#21262d] border border-[#30363d]">
                    <p className="font-medium text-gray-100">
                      {deleteConfirmUser.firstName} {deleteConfirmUser.lastName}
                    </p>
                    <p className="text-xs text-gray-500">{deleteConfirmUser.email}</p>
                  </div>
                  <p className="text-xs text-red-400 mt-3">
                    This will permanently delete the user account and all associated seller documents.
                  </p>
                </div>
                {deleteError && (
                  <div className="mb-4 p-3 rounded-lg border border-red-500/40 bg-red-500/5">
                    <p className="text-xs text-red-300">{deleteError}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={closeDeleteConfirm}
                    disabled={deletingUsers.has(deleteConfirmUser._id)}
                    className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-[#30363d] text-gray-300 hover:bg-[#21262d] transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDeleteUser(deleteConfirmUser)}
                    disabled={deletingUsers.has(deleteConfirmUser._id)}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      deletingUsers.has(deleteConfirmUser._id)
                        ? 'bg-[#333] text-gray-500 cursor-not-allowed'
                        : 'bg-red-600 text-white hover:bg-red-500'
                    }`}
                  >
                    {deletingUsers.has(deleteConfirmUser._id) ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Deleting…
                      </span>
                    ) : (
                      'Delete User'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Search and Filter Bar */}
          {!loading && !error && (
            <>
              <div className="rounded-lg border border-[#252525] bg-[#161b22] p-4 md:p-5 mb-6">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col lg:flex-row gap-3">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <input
                        type="text"
                        placeholder="Search by name, email, or brand…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500 placeholder-gray-500"
                      />
                    </div>
                    <div className="lg:w-48 relative">
                      <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <input
                        type="text"
                        placeholder="Brand…"
                        value={brandSearchQuery}
                        onChange={(e) => setBrandSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-8 py-2.5 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500 placeholder-gray-500"
                      />
                      {brandSearchQuery && (
                        <button type="button" onClick={() => setBrandSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-400" aria-label="Clear">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="lg:w-44 relative">
                      <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500 appearance-none"
                      >
                        <option value="all">All types</option>
                        <option value="LITE">Lite</option>
                        <option value="PRO">Pro</option>
                        <option value="AGENCY">Agency</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-end">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CalendarDays className="w-4 h-4 text-gray-500 shrink-0" />
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="py-2 px-3 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                      <span className="text-gray-500 text-sm">to</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="py-2 px-3 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                      {(startDate || endDate) && (
                        <button onClick={clearDateFilters} className="py-2 px-3 text-sm text-gray-400 hover:text-gray-300 rounded-lg border border-[#30363d] hover:bg-[#21262d]">
                          <X className="w-4 h-4 inline mr-1" /> Clear
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={spApiFilter}
                        onChange={(e) => setSpApiFilter(e.target.value)}
                        className="py-2 px-3 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500"
                      >
                        <option value="all">All SP-API</option>
                        <option value="connected">SP-API connected</option>
                        <option value="not-connected">SP-API not connected</option>
                      </select>
                      <select
                        value={adsFilter}
                        onChange={(e) => setAdsFilter(e.target.value)}
                        className="py-2 px-3 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500"
                      >
                        <option value="all">All Ads API</option>
                        <option value="connected">Ads connected</option>
                        <option value="not-connected">Ads not connected</option>
                      </select>
                      {(spApiFilter !== 'all' || adsFilter !== 'all') && (
                        <button
                          onClick={() => { setSpApiFilter('all'); setAdsFilter('all'); }}
                          className="py-2 px-3 text-sm text-gray-400 hover:text-gray-300 rounded-lg border border-[#30363d] hover:bg-[#21262d]"
                        >
                          Clear API
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stats row */}
                <div className="mt-4 pt-4 border-t border-[#252525] grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border border-[#252525] bg-[#0d0d0d] px-4 py-3">
                    <p className="text-xl font-semibold tabular-nums text-gray-100">{filteredUsers.length}</p>
                    <p className="text-xs text-gray-500">Total</p>
                  </div>
                  <div className="rounded-lg border border-[#252525] bg-[#0d0d0d] px-4 py-3">
                    <p className="text-xl font-semibold tabular-nums text-gray-100">{filteredUsers.filter(u => u.subscriptionStatus === 'active').length}</p>
                    <p className="text-xs text-gray-500">Active</p>
                  </div>
                  <div className="rounded-lg border border-[#252525] bg-[#0d0d0d] px-4 py-3">
                    <p className="text-xl font-semibold tabular-nums text-gray-100">{filteredUsers.filter(u => u.packageType === 'PRO').length}</p>
                    <p className="text-xs text-gray-500">Pro</p>
                  </div>
                  <div className="rounded-lg border border-[#252525] bg-[#0d0d0d] px-4 py-3">
                    <p className="text-xl font-semibold tabular-nums text-gray-100">{filteredUsers.filter(u => u.packageType === 'AGENCY').length}</p>
                    <p className="text-xs text-gray-500">Agency</p>
                  </div>
                </div>
                {filteredUsers.length > 0 && (
                  <div className="mt-3 text-xs text-gray-500">
                    {searchQuery || brandSearchQuery || filterType !== 'all' || startDate || endDate || spApiFilter !== 'all' || adsFilter !== 'all'
                      ? `${filteredUsers.length} match filters`
                      : `Showing all ${filteredUsers.length} users`}
                  </div>
                )}
              </div>

              {/* Table */}
              <div className="rounded-lg border border-[#252525] bg-[#161b22] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead>
                      <tr className="border-b border-[#252525] bg-[#0d0d0d]">
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[180px]">User</th>
                        <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                        <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                        <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Brand</th>
                        <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">SpAPI</th>
                        <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Ads</th>
                        <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                        <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#252525]">
                      {paginatedData.map((user) => {
                        const packageInfo = getPackageTypeInfo(user);
                        const statusInfo = getSubscriptionStatus(user);
                        const PackageIcon = packageInfo.icon;
                        const isDropdownOpen = openDropdownId === user._id;
                        return (
                          <tr key={user._id} className="hover:bg-[#1a1a1a] transition-colors">
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-[#252525] flex items-center justify-center shrink-0">
                                  <span className="text-gray-300 text-xs font-medium">
                                    {(user.firstName?.[0] || '') + (user.lastName?.[0] || '')}
                                  </span>
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-100 break-words">
                                    {user.firstName} {user.lastName}
                                    {user.isInTrialPeriod && <span className="ml-1 text-xs text-gray-500">Trial</span>}
                                  </p>
                                  <p className="text-xs text-gray-500 break-all flex items-center gap-1">
                                    <Mail className="w-3 h-3 shrink-0" />{user.email}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-2.5 text-center text-xs text-gray-400">{user.phone || '—'}</td>
                            <td className="px-2 py-2.5 text-center">
                              <span className={`inline-flex items-center gap-1 text-xs font-medium ${packageInfo.color}`}>
                                <PackageIcon className="w-3 h-3" />{packageInfo.label.split(' ')[0]}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-xs text-gray-400">{user.brand || '—'}</td>
                            <td className="px-2 py-2.5 text-center">
                              <span className={`text-xs font-medium ${statusInfo.color}`}>
                                {statusInfo.label.split(' ')[0]}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-center text-xs">
                              {getSpApiConnectionStatus(user).connected ? (
                                <Check className="w-4 h-4 text-green-500 inline-block" aria-label="Connected" />
                              ) : (
                                <XIcon className="w-4 h-4 text-red-500 inline-block" aria-label="Not connected" />
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-center text-xs">
                              {getAdsApiConnectionStatus(user).connected ? (
                                <Check className="w-4 h-4 text-green-500 inline-block" aria-label="Connected" />
                              ) : (
                                <XIcon className="w-4 h-4 text-red-500 inline-block" aria-label="Not connected" />
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-center text-xs text-gray-500">{formatDate(user.createdAt)}</td>
                            <td className="px-2 py-2.5">
                              <div className="flex items-center justify-center relative" ref={isDropdownOpen ? dropdownRef : undefined}>
                                <button
                                  type="button"
                                  onClick={() => setOpenDropdownId(isDropdownOpen ? null : user._id)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:bg-[#252525] hover:text-gray-300 disabled:opacity-50"
                                  aria-label="Actions"
                                  aria-expanded={isDropdownOpen}
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </button>
                                {isDropdownOpen && (
                                  <div className="absolute right-0 top-full mt-1 z-10 min-w-[120px] py-1 rounded-lg bg-[#1a1a1a] border border-[#252525] shadow-lg">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenDropdownId(null);
                                        handleLoginAsUser(user);
                                      }}
                                      disabled={loginLoadingUsers.has(user._id)}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-green-500 hover:bg-[#252525] hover:text-green-400 disabled:opacity-50"
                                    >
                                      {loginLoadingUsers.has(user._id) ? (
                                        <div className="w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                                      ) : (
                                        <LogIn className="w-3.5 h-3.5" />
                                      )}
                                      Login
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenDropdownId(null);
                                        openDeleteConfirm(user);
                                      }}
                                      disabled={deletingUsers.has(user._id)}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-red-500 hover:bg-[#252525] hover:text-red-400 disabled:opacity-50"
                                    >
                                      {deletingUsers.has(user._id) ? (
                                        <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                      ) : (
                                        <Trash2 className="w-3.5 h-3.5" />
                                      )}
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-[#252525] bg-[#0d0d0d]">
                    <p className="text-xs text-gray-500">
                      {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredUsers.length)} of {filteredUsers.length}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a] disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      {getPaginationGroup().map((page) => (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`min-w-[32px] py-2 px-2 rounded-lg text-sm font-medium ${
                            currentPage === page ? 'bg-blue-600 text-white' : 'border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a]'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a] disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {filteredUsers.length === 0 && (
                <div className="rounded-lg border border-[#252525] bg-[#161b22] py-16 text-center">
                  <div className="w-12 h-12 rounded-lg bg-[#252525] flex items-center justify-center mx-auto mb-3">
                    <Users className="w-6 h-6 text-gray-500" />
                  </div>
                  <h4 className="text-sm font-medium text-gray-300">No users found</h4>
                  <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">Adjust search or filters to see results.</p>
                </div>
              )}
            </>
          )}
    </div>
  );
};

export default ManageAccounts;

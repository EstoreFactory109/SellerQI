import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Chart from 'react-apexcharts';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Users,
  Search, 
  Filter, 
  LogIn,
  Crown, 
  Shield, 
  Briefcase,
  Mail,
  X,
  Trash2,
  MoreVertical,
  Check,
  X as XIcon,
  Ban,
  Download,
  RefreshCw,
  Clock,
} from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

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
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [spApiFilter, setSpApiFilter] = useState('all'); // 'all', 'connected', 'not-connected'
  const [adsFilter, setAdsFilter] = useState('all'); // 'all', 'connected', 'not-connected'
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [countryStats, setCountryStats] = useState(null); // { countries: [{country, count}], uncategorized } - fetched once, not filter-driven
  const [countryStatsLoading, setCountryStatsLoading] = useState(true);
  const [statusCardFilter, setStatusCardFilter] = useState('all'); // 'all' | 'paid' | 'trial' | 'expired' | 'cancelled' - driven by stat cards
  const [pagination, setPagination] = useState({ currentPage: 1, totalPages: 1, totalCount: 0, limit: ITEMS_PER_PAGE });
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const isFirstFilterRun = useRef(true);
  const [expandedAgencyIds, setExpandedAgencyIds] = useState(new Set());
  const [agencyClientsCache, setAgencyClientsCache] = useState({}); // { [agencyUserId]: clientRow[] }
  const [agencyClientsLoading, setAgencyClientsLoading] = useState(new Set());
  const [loginLoadingUsers, setLoginLoadingUsers] = useState(new Set());
  const [loginError, setLoginError] = useState('');
  const [deletingUsers, setDeletingUsers] = useState(new Set());
  const [deleteError, setDeleteError] = useState('');
  const [deleteConfirmUser, setDeleteConfirmUser] = useState(null);
  const [deleteSuccess, setDeleteSuccess] = useState('');
  const [cancellingUsers, setCancellingUsers] = useState(new Set());
  const [cancelError, setCancelError] = useState('');
  const [cancelConfirmUser, setCancelConfirmUser] = useState(null);
  const [cancelSuccess, setCancelSuccess] = useState('');
  const [refundingUsers, setRefundingUsers] = useState(new Set());
  const [refundError, setRefundError] = useState('');
  const [refundConfirmUser, setRefundConfirmUser] = useState(null);
  const [refundSuccess, setRefundSuccess] = useState('');
  const [trialUser, setTrialUser] = useState(null);
  const [trialDays, setTrialDays] = useState(7);
  const [trialUnit, setTrialUnit] = useState('days');
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState('');
  const [trialSuccess, setTrialSuccess] = useState('');
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState(null);
  const dropdownRef = useRef(null);
  const openDropdownButtonRef = useRef(null);
  const DROPDOWN_MENU_WIDTH = 160;
  const DROPDOWN_MENU_HEIGHT = 124;

  const handleExportCsv = async () => {
    try {
      const response = await axiosInstance.get('/app/auth/admin/accounts/export', {
        responseType: 'blob',
      });

      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');

      // Try to use filename from Content-Disposition header if present
      const disposition = response.headers['content-disposition'] || response.headers['Content-Disposition'];
      let filename = 'accounts-export.csv';
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export accounts CSV:', err);
      alert('Failed to export accounts CSV. Please try again.');
    }
  };

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

  // Debounce free-text search inputs before they trigger a backend request;
  // reset to page 1 alongside the debounced value so only one fetch fires per change.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      setCurrentPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);


  // Fetch accounts data. `quiet` skips the full-page loading spinner - used for
  // page/filter changes and post-mutation refreshes so the table stays visible.
  const fetchAccounts = async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      setError('');
      const response = await axiosInstance.get('/app/auth/admin/accounts', {
        params: {
          page: currentPage,
          limit: ITEMS_PER_PAGE,
          search: debouncedSearchQuery || undefined,
          packageType: filterType !== 'all' ? filterType : undefined,
          statusFilter: statusCardFilter !== 'all' ? statusCardFilter : undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          spApiFilter: spApiFilter !== 'all' ? spApiFilter : undefined,
          adsFilter: adsFilter !== 'all' ? adsFilter : undefined,
        },
      });

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
        const serverPagination = response.data.data.pagination;
        if (serverPagination) {
          setPagination(serverPagination);
          if (serverPagination.totalPages && currentPage > serverPagination.totalPages) {
            setCurrentPage(serverPagination.totalPages);
          }
        }
      } else {
        setError(response.data.message || 'Failed to load accounts data');
      }
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
      // Server returns HTTP 401 for invalid/expired admin session; clear admin auth and send to admin login
      if (error.response?.status === 401) {
        localStorage.removeItem('isAdminAuth');
        localStorage.removeItem('adminAccessType');
        localStorage.removeItem('adminId');
        navigate('/admin-login');
        return;
      }
      setError(error.response?.data?.message || 'Failed to load accounts data');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  // Initial load - shows the full-page spinner
  useEffect(() => {
    fetchAccounts();
  }, []);

  // Country stats power the "users by country" pie chart - fetched once on mount only, not tied
  // to filters/pagination, since it sweeps every Stripe customer live on the backend.
  useEffect(() => {
    const fetchCountryStats = async () => {
      try {
        const response = await axiosInstance.get('/app/auth/admin/accounts/country-stats');
        if (response.data.statusCode === 200) {
          setCountryStats(response.data.data);
        }
      } catch (error) {
        console.error('Failed to fetch country stats:', error);
      } finally {
        setCountryStatsLoading(false);
      }
    };
    fetchCountryStats();
  }, []);

  // Subsequent page/filter changes - quiet refetch, table stays visible
  useEffect(() => {
    if (isFirstFilterRun.current) {
      isFirstFilterRun.current = false;
      return;
    }
    fetchAccounts({ quiet: true });
  }, [currentPage, debouncedSearchQuery, filterType, statusCardFilter, startDate, endDate, spApiFilter, adsFilter]);

  // Fetch (or re-fetch) the client list for one agency and store it in the cache
  const fetchAgencyClients = async (agencyId) => {
    setAgencyClientsLoading(prev => new Set([...prev, agencyId]));
    try {
      const response = await axiosInstance.get(`/app/auth/admin/accounts/${agencyId}/clients`);
      if (response.data.statusCode === 200) {
        setAgencyClientsCache(prev => ({ ...prev, [agencyId]: response.data.data.clients || [] }));
      }
    } catch (error) {
      console.error('Failed to fetch agency clients:', error);
    } finally {
      setAgencyClientsLoading(prev => {
        const next = new Set(prev);
        next.delete(agencyId);
        return next;
      });
    }
  };

  const toggleAgencyExpand = (agencyUser) => {
    const id = agencyUser._id;
    if (expandedAgencyIds.has(id)) {
      setExpandedAgencyIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    setExpandedAgencyIds(prev => new Set([...prev, id]));
    if (!agencyClientsCache[id]) {
      fetchAgencyClients(id);
    }
  };

  // Keep any already-expanded agency's client list fresh after an action (delete/cancel/refund/trial)
  // is performed on one of its clients - mirrors the quiet fetchAccounts() refresh used elsewhere.
  const refreshExpandedAgencyClients = () => {
    expandedAgencyIds.forEach(id => fetchAgencyClients(id));
  };

  // Close dropdown when clicking outside (portal menu or trigger button)
  useEffect(() => {
    const handleClickOutside = (event) => {
      const inMenu = dropdownRef.current?.contains(event.target);
      const onTrigger = openDropdownButtonRef.current?.contains(event.target);
      if (!inMenu && !onTrigger) {
        setOpenDropdownId(null);
        setDropdownPosition(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** Strip trailing "(Inactive)"-style suffix for compact type column (keeps "Agency Client" whole). */
  const typeColumnLabel = (label) => label.replace(/\s*\([^)]*\)\s*$/, '').trim();

  // Helper functions - muted colors to match existing app
  const getPackageTypeInfo = (user) => {
    const isExpiredOrInactive =
      user.isTrialExpired ||
      (user.isInTrialPeriod && user.trialEndsDate && new Date() > new Date(user.trialEndsDate)) ||
      user.subscriptionStatus === 'inactive' ||
      user.subscriptionStatus === 'cancelled';

    if (user.isAgencyClient === true) {
      return {
        icon: Users,
        color: isExpiredOrInactive ? 'text-gray-500' : 'text-yellow-500',
        label: isExpiredOrInactive ? 'Agency Client (Inactive)' : 'Agency Client'
      };
    }

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

  // "User Type" column - simplified to a Seller/"-" signal (Agency owner rows keep the label above instead).
  // Seller = an agency client, or a Pro user with a card on file (no card => not really Pro yet, same
  // card-gating as the Status column below). Everything else ("signed up" free users) shows "-".
  const getUserTypeLabel = (user) => {
    const isSeller = user.isAgencyClient === true || (user.packageType === 'PRO' && user.cardConnected);
    return isSeller ? 'Seller' : '-';
  };

  // Row-level Status column. The status itself is resolved server-side (server/utils/accountStatus.js)
  // and arrives as user.accountStatus, so this row label, the stat card counts and the rows a card
  // filters to are all the same computation - they used to be three separate ones that disagreed
  // (a cancelled customer counted under the Cancelled card while their row read "Signed Up").
  const ACCOUNT_STATUS_DISPLAY = {
    signed_up: { color: 'text-gray-500', label: 'Signed Up' },
    trial: { color: 'text-blue-500', label: 'Trial' },
    paid: { color: 'text-green-500', label: 'Paid' },
    cancelled: { color: 'text-red-500', label: 'Cancelled' },
    refunded: { color: 'text-orange-400', label: 'Refunded' },
    expired: { color: 'text-gray-400', label: 'Expired' },
  };

  const getSubscriptionStatus = (user) => {
    const fromServer = ACCOUNT_STATUS_DISPLAY[user.accountStatus];
    if (fromServer) return fromServer;

    // Fallback for responses without accountStatus (the unpaginated /accounts path deliberately
    // omits it, since it can't resolve a real card status). Degrades to the old plan-based guess
    // rather than showing nothing.
    if (user.packageType !== 'PRO' || !user.cardConnected) {
      return { color: 'text-gray-500', label: 'Signed Up' };
    }
    if (user.isInTrialPeriod) {
      return { color: 'text-blue-500', label: 'Trial' };
    }
    return { color: 'text-green-500', label: 'Paid' };
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
        
        // Clear super admin access type since we're now logged in as a regular user
        // This ensures proper redirect behavior when refreshing or navigating
        localStorage.removeItem('userAccessType');
        
        // Set isAuth for the user session
        localStorage.setItem('isAuth', 'true');
        
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
        // Quietly refresh so stat cards/pagination totals stay accurate
        fetchAccounts({ quiet: true });
        refreshExpandedAgencyClients();

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

  const handleCancelSubscription = async (user) => {
    try {
      // Add user to cancelling set
      setCancellingUsers(prev => new Set([...prev, user._id]));
      setCancelError('');
      
      console.log('Cancelling subscription for user:', user);
      
      // Call the cancel subscription API
      const response = await axiosInstance.post(`/app/auth/admin/users/${user._id}/cancel-subscription`);
      
      if (response.data.statusCode === 200) {
        console.log('Successfully cancelled subscription:', response.data.data);
        
        // Update user in local state
        setUsers(prevUsers => prevUsers.map(u => {
          if (u._id === user._id) {
            return {
              ...u,
              packageType: 'LITE',
              subscriptionStatus: 'cancelled',
              isInTrialPeriod: false
            };
          }
          return u;
        }));
        
        // Close confirmation dialog
        setCancelConfirmUser(null);
        
        // Show success message
        const wasTrialing = response.data.data?.wasTrialing;
        setCancelSuccess(`Subscription for ${user.firstName} ${user.lastName} (${user.email}) has been cancelled successfully${wasTrialing ? ' (was in trial)' : ''}.`);
        // Quietly refresh so stat cards/pagination totals stay accurate
        fetchAccounts({ quiet: true });
        refreshExpandedAgencyClients();

        // Clear success message after 5 seconds
        setTimeout(() => {
          setCancelSuccess('');
        }, 5000);
      } else {
        setCancelError(response.data.message || 'Failed to cancel subscription');
      }
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      setCancelError(error.response?.data?.message || 'Failed to cancel subscription');
    } finally {
      // Remove user from cancelling set
      setCancellingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(user._id);
        return newSet;
      });
    }
  };

  const openCancelConfirm = (user) => {
    setCancelConfirmUser(user);
    setCancelError('');
  };

  const closeCancelConfirm = () => {
    setCancelConfirmUser(null);
    setCancelError('');
  };

  const handleRefund = async (user) => {
    try {
      setRefundingUsers(prev => new Set([...prev, user._id]));
      setRefundError('');

      const response = await axiosInstance.post(`/app/auth/admin/users/${user._id}/refund`);

      if (response.data.statusCode === 200) {
        setRefundConfirmUser(null);
        const data = response.data.data;
        setRefundSuccess(`Refund of ${data.currency?.toUpperCase()} ${(data.amount / 100).toFixed(2)} issued for ${user.firstName} ${user.lastName} (${user.email}).`);
        // Quietly refresh so stat cards/pagination totals stay accurate
        fetchAccounts({ quiet: true });
        refreshExpandedAgencyClients();
        setTimeout(() => setRefundSuccess(''), 5000);
      } else {
        setRefundError(response.data.message || 'Failed to refund payment');
      }
    } catch (error) {
      console.error('Error refunding payment:', error);
      setRefundError(error.response?.data?.message || 'Failed to refund payment');
    } finally {
      setRefundingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(user._id);
        return newSet;
      });
    }
  };

  const openRefundConfirm = (user) => {
    setRefundConfirmUser(user);
    setRefundError('');
  };

  const closeRefundConfirm = () => {
    setRefundConfirmUser(null);
    setRefundError('');
  };

  const handleUpdateTrial = async (user) => {
    try {
      setTrialLoading(true);
      setTrialError('');

      const days = trialUnit === 'months' ? trialDays * 30 : trialDays;

      const response = await axiosInstance.post(`/app/auth/admin/users/${user._id}/update-trial`, { trialDays: days });

      if (response.data.statusCode === 200) {
        const data = response.data.data;
        setUsers(prevUsers => prevUsers.map(u => {
          if (u._id === user._id) {
            return { ...u, subscriptionStatus: 'trialing', isInTrialPeriod: true };
          }
          return u;
        }));
        setTrialUser(null);
        setTrialDays(7);
        setTrialUnit('days');
        setTrialSuccess(`Trial for ${user.firstName} ${user.lastName} set to ${days} days (ends ${new Date(data.trialEnd).toLocaleDateString()}).`);
        // Quietly refresh so stat cards/pagination totals stay accurate
        fetchAccounts({ quiet: true });
        refreshExpandedAgencyClients();
        setTimeout(() => setTrialSuccess(''), 5000);
      } else {
        setTrialError(response.data.message || 'Failed to update trial period');
      }
    } catch (error) {
      console.error('Error updating trial:', error);
      setTrialError(error.response?.data?.message || 'Failed to update trial period');
    } finally {
      setTrialLoading(false);
    }
  };

  const openTrialModal = (user) => {
    setTrialUser(user);
    setTrialDays(7);
    setTrialUnit('days');
    setTrialError('');
  };

  const closeTrialModal = () => {
    setTrialUser(null);
    setTrialError('');
  };

  // Check if user has an active subscription that can be cancelled
  const canCancelSubscription = (user) => {
    // Trial users can always cancel/downgrade early, regardless of packageType
    if (user.isInTrialPeriod) return true;
    // Otherwise: user must have a PRO or AGENCY package, and be in active status
    const hasActivePackage = user.packageType === 'PRO' || user.packageType === 'AGENCY';
    const hasActiveStatus = ['active', 'trialing', 'authenticated'].includes(user.subscriptionStatus);
    return hasActivePackage && hasActiveStatus;
  };

  const getPaginationGroup = () => {
    const group = [];
    const maxButtons = 5;
    const totalPages = pagination.totalPages;

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

  // While any search/filter is active, behave like a normal flat table (agency clients included
  // directly in results) instead of nesting them under a collapsed agency row - matches the
  // backend's hideAgencyClients decision in getAllAccounts. The "Agency" type filter is excluded
  // here on purpose: it's the main way to browse agency owners, so it must keep nesting enabled
  // (agency clients never have packageType 'AGENCY' themselves, so this filter can't reveal them anyway).
  const hasActiveFilters = Boolean(
    searchQuery || (filterType !== 'all' && filterType !== 'AGENCY') || statusCardFilter !== 'all' ||
    startDate || endDate || spApiFilter !== 'all' || adsFilter !== 'all'
  );

  // Renders one account row - shared by top-level rows and an agency's nested client rows,
  // so both look and behave identically (same columns, same actions menu).
  const renderAccountRow = (user, { isChild = false } = {}) => {
    const packageInfo = getPackageTypeInfo(user);
    const statusInfo = getSubscriptionStatus(user);
    const PackageIcon = packageInfo.icon;
    const isDropdownOpen = openDropdownId === user._id;
    // Nesting (chevron + collapsed agency-name display) only applies while browsing with no filters active
    const isAgencyOwner = !isChild && user.packageType === 'AGENCY' && !hasActiveFilters;
    const isExpanded = isAgencyOwner && expandedAgencyIds.has(user._id);
    const isExpandLoading = isAgencyOwner && agencyClientsLoading.has(user._id);

    return (
      <tr key={user._id} className={`group transition-colors hover:bg-white/[0.035] ${isChild ? 'bg-blue-500/[0.035]' : 'bg-transparent'}`}>
        <td className={`px-3 py-2.5 ${isChild ? 'pl-8' : ''}`}>
          <div className="flex items-center gap-2">
            {isAgencyOwner && (
              <button
                type="button"
                onClick={() => toggleAgencyExpand(user)}
                className="p-1 rounded-md text-gray-400 hover:bg-white/[0.06] hover:text-gray-200 shrink-0"
                aria-label={isExpanded ? 'Collapse agency clients' : 'Expand agency clients'}
                aria-expanded={isExpanded}
              >
                {isExpandLoading ? (
                  <div className="w-3.5 h-3.5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                )}
              </button>
            )}
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm border ${
              user.packageType === 'AGENCY'
                ? 'bg-violet-500/15 border-violet-400/20'
                : user.packageType === 'PRO'
                ? 'bg-amber-500/15 border-amber-400/20'
                : 'bg-sky-500/10 border-sky-400/20'
            }`}>
              <span className="text-gray-100 text-xs font-semibold">
                {(user.firstName?.[0] || '') + (user.lastName?.[0] || '')}
              </span>
            </div>
            <div className="min-w-0">
              {isAgencyOwner ? (
                <p className="text-sm font-medium text-gray-100 break-words">{user.agencyName || `${user.firstName} ${user.lastName}`}</p>
              ) : (
                <p className="text-sm font-medium text-gray-100 break-words">
                  {user.firstName} {user.lastName}
                  {user.isInTrialPeriod && <span className="ml-1 text-xs text-gray-500">Trial</span>}
                </p>
              )}
              <p className="text-xs text-gray-500 break-all flex items-center gap-1 mt-0.5">
                <Mail className="w-3 h-3 shrink-0" />{user.email}
              </p>
              <p className="text-xs text-gray-500">{user.phone || '—'}</p>
            </div>
          </div>
        </td>
        <td className="px-2 py-2.5 text-center">
          {user.packageType === 'AGENCY' ? (
            <span className={`inline-flex items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 text-xs font-medium ${packageInfo.color} max-w-[9rem] mx-auto text-center`}>
              <PackageIcon className="w-3 h-3 shrink-0" />{typeColumnLabel(packageInfo.label)}
            </span>
          ) : (
            <span className={`inline-flex items-center justify-center rounded-full border px-2 py-1 text-xs font-medium ${
              getUserTypeLabel(user) === 'Seller'
                ? 'border-yellow-500/20 bg-yellow-500/10 text-yellow-400'
                : 'border-white/10 bg-white/[0.025] text-gray-500'
            }`}>
              {getUserTypeLabel(user)}
            </span>
          )}
        </td>
        <td className="px-2 py-2.5 text-xs text-gray-400">
          <span className="line-clamp-2">{user.brand || '—'}</span>
        </td>
        <td className="px-2 py-2.5 text-center">
          <span className={`inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 text-xs font-medium ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
        </td>
        <td className="px-2 py-2.5 text-center text-xs">
          {getSpApiConnectionStatus(user).connected ? (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20">
              <Check className="w-4 h-4 text-green-400" aria-label="Connected" />
            </span>
          ) : (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
              <XIcon className="w-4 h-4 text-red-400" aria-label="Not connected" />
            </span>
          )}
        </td>
        <td className="px-2 py-2.5 text-center text-xs">
          {getAdsApiConnectionStatus(user).connected ? (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20">
              <Check className="w-4 h-4 text-green-400" aria-label="Connected" />
            </span>
          ) : (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
              <XIcon className="w-4 h-4 text-red-400" aria-label="Not connected" />
            </span>
          )}
        </td>
        <td className="px-2 py-2.5 text-center text-xs">
          {user.cardConnected === true ? (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20">
              <Check className="w-4 h-4 text-green-400" aria-label="Card on file" />
            </span>
          ) : user.cardConnected === false ? (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
              <XIcon className="w-4 h-4 text-red-400" aria-label="No card on file" />
            </span>
          ) : (
            <span className="text-gray-500">—</span>
          )}
        </td>
        <td className="px-2 py-2.5 text-center text-xs text-gray-500 whitespace-nowrap">
          {user.createdAt ? formatDate(user.createdAt) : '—'}
        </td>
        <td className="px-2 py-2.5 text-center text-xs text-gray-500 whitespace-nowrap">
          {user.renewalDate ? formatDate(user.renewalDate) : '—'}
        </td>
        <td className="px-2 py-2.5">
          <div className="flex items-center justify-center">
            <button
              type="button"
              ref={isDropdownOpen ? openDropdownButtonRef : undefined}
              onClick={(e) => {
                if (isDropdownOpen) {
                  setOpenDropdownId(null);
                  setDropdownPosition(null);
                } else {
                  openDropdownButtonRef.current = e.currentTarget;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const spaceBelow = window.innerHeight - rect.bottom;
                  const openAbove = spaceBelow < DROPDOWN_MENU_HEIGHT && rect.top >= spaceBelow;
                  setDropdownPosition({
                    left: Math.max(8, rect.right - DROPDOWN_MENU_WIDTH),
                    top: openAbove ? rect.top - DROPDOWN_MENU_HEIGHT - 4 : rect.bottom + 4,
                  });
                  setOpenDropdownId(user._id);
                }
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-white/[0.06] hover:text-gray-200 disabled:opacity-50"
              aria-label="Actions"
              aria-expanded={isDropdownOpen}
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="relative min-h-full w-full overflow-hidden bg-[#0b0f17] p-4 md:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_30%)]" />
      <div className="relative max-w-[1600px] w-full">
          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-[#101722]/80 py-20 shadow-2xl shadow-black/20">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/10 border-t-blue-500" />
              <p className="ml-3 text-sm text-gray-400">Loading accounts…</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-6 shadow-lg shadow-red-950/10">
              <p className="text-sm font-medium text-red-300">Error: {error}</p>
              <button
                onClick={fetchAccounts}
                className="mt-3 px-3 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Login-in-progress overlay */}
          {loginLoadingUsers.size > 0 && (() => {
            const loggingInUserId = Array.from(loginLoadingUsers)[0];
            const loggingInUser = users.find(u => u._id === loggingInUserId);
            const displayName = loggingInUser ? `${loggingInUser.firstName} ${loggingInUser.lastName}` : 'user';
            return (
              <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="bg-[#101722] rounded-2xl border border-white/10 shadow-2xl px-8 py-6 flex flex-col items-center gap-4 min-w-[240px]">
                  <div className="w-12 h-12 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-gray-200 font-medium">Logging in as {displayName}…</p>
                  <p className="text-gray-500 text-sm">Please wait</p>
                </div>
              </div>
            );
          })()}

          {/* Login Error State */}
          {loginError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-6 shadow-lg shadow-red-950/10">
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
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-6 shadow-lg shadow-red-950/10">
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
            <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 mb-6 shadow-lg shadow-green-950/10">
              <p className="text-sm font-medium text-gray-300">✓ {deleteSuccess}</p>
            </div>
          )}

          {/* Cancel Subscription Error State */}
          {cancelError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-6 shadow-lg shadow-red-950/10">
              <p className="text-sm font-medium text-red-300">Cancel Error: {cancelError}</p>
              <button
                onClick={() => setCancelError('')}
                className="mt-2 px-3 py-2 text-sm rounded-lg bg-[#252525] text-gray-300 hover:bg-[#333] transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Cancel Subscription Success State */}
          {cancelSuccess && (
            <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 mb-6 shadow-lg shadow-green-950/10">
              <p className="text-sm font-medium text-gray-300">✓ {cancelSuccess}</p>
            </div>
          )}

          {/* Refund Error State */}
          {refundError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-6 shadow-lg shadow-red-950/10">
              <p className="text-sm font-medium text-red-300">Refund Error: {refundError}</p>
              <button
                onClick={() => setRefundError('')}
                className="mt-2 px-3 py-2 text-sm rounded-lg bg-[#252525] text-gray-300 hover:bg-[#333] transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Refund Success State */}
          {refundSuccess && (
            <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 mb-6 shadow-lg shadow-green-950/10">
              <p className="text-sm font-medium text-gray-300">✓ {refundSuccess}</p>
            </div>
          )}

          {/* Trial Error State */}
          {trialError && !trialUser && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-6 shadow-lg shadow-red-950/10">
              <p className="text-sm font-medium text-red-300">Trial Error: {trialError}</p>
              <button
                onClick={() => setTrialError('')}
                className="mt-2 px-3 py-2 text-sm rounded-lg bg-[#252525] text-gray-300 hover:bg-[#333] transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Trial Success State */}
          {trialSuccess && (
            <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 mb-6 shadow-lg shadow-green-950/10">
              <p className="text-sm font-medium text-gray-300">✓ {trialSuccess}</p>
            </div>
          )}

          {/* Refund Confirmation Dialog */}
          {refundConfirmUser && (
            <div
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
              onClick={closeRefundConfirm}
            >
              <div
                className="bg-[#161b22] rounded-lg max-w-md w-full p-6 border border-[#30363d]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-full bg-yellow-500/10 flex items-center justify-center">
                    <RefreshCw className="w-4 h-4 text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-100">Refund Payment</h3>
                    <p className="text-xs text-gray-500">This will refund the last payment via Stripe</p>
                  </div>
                </div>
                <div className="mb-5">
                  <p className="text-sm text-gray-400 mb-2">Are you sure you want to refund the last payment for this user?</p>
                  <div className="bg-[#0d1117] rounded-lg p-3 border border-[#30363d]">
                    <p className="text-sm font-medium text-gray-200">{refundConfirmUser.firstName} {refundConfirmUser.lastName}</p>
                    <p className="text-xs text-gray-500">{refundConfirmUser.email}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={closeRefundConfirm}
                    disabled={refundingUsers.has(refundConfirmUser._id)}
                    className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-[#30363d] text-gray-300 hover:bg-[#21262d] transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleRefund(refundConfirmUser)}
                    disabled={refundingUsers.has(refundConfirmUser._id)}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      refundingUsers.has(refundConfirmUser._id)
                        ? 'bg-[#333] text-gray-500 cursor-not-allowed'
                        : 'bg-yellow-600 text-white hover:bg-yellow-500'
                    }`}
                  >
                    {refundingUsers.has(refundConfirmUser._id) ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Refunding...
                      </span>
                    ) : (
                      'Refund Payment'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Change Trial Period Modal */}
          {trialUser && (
            <div
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
              onClick={closeTrialModal}
            >
              <div
                className="bg-[#161b22] rounded-lg max-w-md w-full p-6 border border-[#30363d]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-100">Change Trial Period</h3>
                    <p className="text-xs text-gray-500">Set new trial duration from today</p>
                  </div>
                </div>
                <div className="mb-4">
                  <div className="bg-[#0d1117] rounded-lg p-3 border border-[#30363d] mb-4">
                    <p className="text-sm font-medium text-gray-200">{trialUser.firstName} {trialUser.lastName}</p>
                    <p className="text-xs text-gray-500">{trialUser.email}</p>
                  </div>
                  <label className="block text-sm text-gray-400 mb-2">Trial Period</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      max={trialUnit === 'months' ? 12 : 365}
                      value={trialDays}
                      onChange={(e) => setTrialDays(Math.max(1, parseInt(e.target.value) || 1))}
                      className="flex-1 px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                    />
                    <select
                      value={trialUnit}
                      onChange={(e) => setTrialUnit(e.target.value)}
                      className="px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="days">Days</option>
                      <option value="months">Months</option>
                    </select>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Trial will end on: {new Date(Date.now() + (trialUnit === 'months' ? trialDays * 30 : trialDays) * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                  {trialError && (
                    <p className="text-xs text-red-400 mt-2">{trialError}</p>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={closeTrialModal}
                    disabled={trialLoading}
                    className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-[#30363d] text-gray-300 hover:bg-[#21262d] transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleUpdateTrial(trialUser)}
                    disabled={trialLoading}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      trialLoading
                        ? 'bg-[#333] text-gray-500 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-500'
                    }`}
                  >
                    {trialLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Updating...
                      </span>
                    ) : (
                      'Update Trial'
                    )}
                  </button>
                </div>
              </div>
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

          {/* Cancel Subscription Confirmation Dialog */}
          {cancelConfirmUser && (
            <div
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
              onClick={closeCancelConfirm}
            >
              <div
                className="bg-[#161b22] rounded-lg max-w-md w-full p-6 border border-[#30363d]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                    <Ban className="w-5 h-5 text-orange-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-100">Cancel Subscription</h3>
                    <p className="text-xs text-gray-500">This will downgrade the user to LITE plan</p>
                  </div>
                </div>
                <div className="mb-5">
                  <p className="text-sm text-gray-400 mb-2">Are you sure you want to cancel subscription for this user?</p>
                  <div className="rounded-lg p-3 bg-[#21262d] border border-[#30363d]">
                    <p className="font-medium text-gray-100">
                      {cancelConfirmUser.firstName} {cancelConfirmUser.lastName}
                    </p>
                    <p className="text-xs text-gray-500">{cancelConfirmUser.email}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                        {cancelConfirmUser.isAgencyClient ? 'Agency Client' : cancelConfirmUser.packageType}
                      </span>
                      {cancelConfirmUser.isInTrialPeriod && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                          Trial
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-orange-400 mt-3">
                    This will immediately cancel the subscription and downgrade the user to the free LITE plan.
                  </p>
                </div>
                {cancelError && (
                  <div className="mb-4 p-3 rounded-lg border border-red-500/40 bg-red-500/5">
                    <p className="text-xs text-red-300">{cancelError}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={closeCancelConfirm}
                    disabled={cancellingUsers.has(cancelConfirmUser._id)}
                    className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-[#30363d] text-gray-300 hover:bg-[#21262d] transition-colors disabled:opacity-50"
                  >
                    Keep Subscription
                  </button>
                  <button
                    onClick={() => handleCancelSubscription(cancelConfirmUser)}
                    disabled={cancellingUsers.has(cancelConfirmUser._id)}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      cancellingUsers.has(cancelConfirmUser._id)
                        ? 'bg-[#333] text-gray-500 cursor-not-allowed'
                        : 'bg-orange-600 text-white hover:bg-orange-500'
                    }`}
                  >
                    {cancellingUsers.has(cancelConfirmUser._id) ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Cancelling…
                      </span>
                    ) : (
                      'Cancel Subscription'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Actions dropdown (portal so it is not clipped by table overflow) */}
          {openDropdownId && dropdownPosition && (() => {
            const user = users.find((u) => u._id === openDropdownId)
              || Object.values(agencyClientsCache).flat().find((u) => u._id === openDropdownId);
            if (!user) return null;
            const canCancel = canCancelSubscription(user);
            return createPortal(
              <div
                ref={dropdownRef}
                className="fixed z-[100] min-w-[160px] w-[160px] py-1 rounded-lg bg-[#1a1a1a] border border-[#252525] shadow-lg"
                style={{
                  left: dropdownPosition.left,
                  top: Math.max(8, Math.min(dropdownPosition.top, window.innerHeight - DROPDOWN_MENU_HEIGHT - 8)),
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpenDropdownId(null);
                    setDropdownPosition(null);
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
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenDropdownId(null);
                      setDropdownPosition(null);
                      openCancelConfirm(user);
                    }}
                    disabled={cancellingUsers.has(user._id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-orange-500 hover:bg-[#252525] hover:text-orange-400 disabled:opacity-50"
                  >
                    {cancellingUsers.has(user._id) ? (
                      <div className="w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Ban className="w-3.5 h-3.5" />
                    )}
                    Cancel Sub
                  </button>
                )}
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenDropdownId(null);
                      setDropdownPosition(null);
                      openRefundConfirm(user);
                    }}
                    disabled={refundingUsers.has(user._id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-yellow-500 hover:bg-[#252525] hover:text-yellow-400 disabled:opacity-50"
                  >
                    {refundingUsers.has(user._id) ? (
                      <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Refund
                  </button>
                )}
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenDropdownId(null);
                      setDropdownPosition(null);
                      openTrialModal(user);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-blue-500 hover:bg-[#252525] hover:text-blue-400"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    Change Trial
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOpenDropdownId(null);
                    setDropdownPosition(null);
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
              </div>,
              document.body
            );
          })()}

          {/* Search, Filters, and Actions */}
          {!loading && !error && (
            <>
              <div className="rounded-2xl border border-white/10 bg-[#101722]/90 p-4 md:p-5 mb-6 shadow-2xl shadow-black/20 backdrop-blur">
                <div className="flex flex-col xl:flex-row gap-5 items-stretch">
                {/* LEFT: unified search, export, filters, then chips */}
                <div className="flex flex-col gap-3 w-full xl:w-[52%] 2xl:w-[50%] rounded-xl border border-white/10 bg-[#0b0f17]/70 p-4">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                      <input
                        type="text"
                        placeholder="Search name, email, brand…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-2.5 text-sm border border-white/10 bg-white/[0.04] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10 placeholder-gray-500 transition"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      title="Export CSV"
                      aria-label="Export CSV"
                      className="inline-flex items-center justify-center p-2.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors shrink-0 shadow-lg shadow-blue-950/30"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="relative">
                    <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <select
                      value={filterType}
                      onChange={(e) => { setFilterType(e.target.value); setStatusCardFilter('all'); setCurrentPage(1); }}
                      className="w-full pl-8 pr-8 py-2.5 text-sm border border-white/10 bg-white/[0.04] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10 appearance-none transition"
                    >
                      <option value="all">All types</option>
                      <option value="LITE">Lite</option>
                      <option value="PRO">Pro</option>
                      <option value="AGENCY">Agency</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
<input
                      type="date"
                      value={startDate}
                      onChange={(e) => { setStartDate(e.target.value); setCurrentPage(1); }}
                      className="min-w-0 py-2.5 px-2 text-xs border border-white/10 bg-white/[0.04] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
                    />
                    <span className="text-gray-500 text-[10px] shrink-0">to</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => { setEndDate(e.target.value); setCurrentPage(1); }}
                      className="min-w-0 py-2.5 px-2 text-xs border border-white/10 bg-white/[0.04] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
                    />
                  </div>
                  {(startDate || endDate) && (
                    <button onClick={() => { clearDateFilters(); setCurrentPage(1); }} className="text-[11px] text-gray-400 hover:text-gray-200 rounded-lg border border-white/10 hover:bg-white/[0.05] py-1.5 transition">
                      <X className="w-3 h-3 inline mr-1" /> Clear dates
                    </button>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={spApiFilter}
                      onChange={(e) => { setSpApiFilter(e.target.value); setCurrentPage(1); }}
                      className="min-w-0 py-2.5 px-2 text-xs border border-white/10 bg-white/[0.04] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
                    >
                      <option value="all">All SP-API</option>
                      <option value="connected">SP-API connected</option>
                      <option value="not-connected">SP-API not connected</option>
                    </select>
                    <select
                      value={adsFilter}
                      onChange={(e) => { setAdsFilter(e.target.value); setCurrentPage(1); }}
                      className="min-w-0 py-2.5 px-2 text-xs border border-white/10 bg-white/[0.04] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
                    >
                      <option value="all">All Ads API</option>
                      <option value="connected">Ads connected</option>
                      <option value="not-connected">Ads not connected</option>
                    </select>
                  </div>
                  {(spApiFilter !== 'all' || adsFilter !== 'all') && (
                    <button
                      onClick={() => { setSpApiFilter('all'); setAdsFilter('all'); setCurrentPage(1); }}
                      className="text-[11px] text-gray-400 hover:text-gray-200 rounded-lg border border-white/10 hover:bg-white/[0.05] py-1.5 transition"
                    >
                      Clear API
                    </button>
                  )}

                  {/* Chips - stacked under the filters, same column */}
                  <div className="mt-1 pt-4 border-t border-white/10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {(() => {
                      const isTotalActive = filterType === 'all' && statusCardFilter === 'all';
                      const chipClass = (active, tone = 'slate') => {
                        const tones = {
                          slate: active
                            ? 'border-slate-400/45 bg-slate-400/15 text-slate-100 shadow-lg shadow-black/20'
                            : 'border-slate-400/15 bg-slate-400/[0.06] text-slate-400 hover:border-slate-400/30 hover:bg-slate-400/10 hover:text-slate-200',
                          green: active
                            ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-200 shadow-lg shadow-emerald-950/20'
                            : 'border-emerald-500/15 bg-emerald-500/[0.06] text-emerald-400 hover:border-emerald-400/30 hover:bg-emerald-500/10 hover:text-emerald-200',
                          blue: active
                            ? 'border-blue-400/45 bg-blue-500/15 text-blue-200 shadow-lg shadow-blue-950/20'
                            : 'border-blue-500/15 bg-blue-500/[0.06] text-blue-400 hover:border-blue-400/30 hover:bg-blue-500/10 hover:text-blue-200',
                          amber: active
                            ? 'border-amber-400/45 bg-amber-500/15 text-amber-200 shadow-lg shadow-amber-950/20'
                            : 'border-amber-500/15 bg-amber-500/[0.06] text-amber-400 hover:border-amber-400/30 hover:bg-amber-500/10 hover:text-amber-200',
                          red: active
                            ? 'border-red-400/45 bg-red-500/15 text-red-200 shadow-lg shadow-red-950/20'
                            : 'border-red-500/15 bg-red-500/[0.06] text-red-400 hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-200',
                          orange: active
                            ? 'border-orange-400/45 bg-orange-500/15 text-orange-200 shadow-lg shadow-orange-950/20'
                            : 'border-orange-500/15 bg-orange-500/[0.06] text-orange-400 hover:border-orange-400/30 hover:bg-orange-500/10 hover:text-orange-200',
                          violet: active
                            ? 'border-violet-400/45 bg-violet-500/15 text-violet-200 shadow-lg shadow-violet-950/20'
                            : 'border-violet-500/15 bg-violet-500/[0.06] text-violet-400 hover:border-violet-400/30 hover:bg-violet-500/10 hover:text-violet-200',
                        };

                        return `inline-flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${tones[tone] || tones.slate}`;
                      };
                      const chips = [
                        { label: 'Total', tone: 'slate', count: stats?.total ?? 0, active: isTotalActive, onClick: () => { setFilterType('all'); setStatusCardFilter('all'); setCurrentPage(1); } },
                        { label: 'Paid', tone: 'green', count: stats?.activeSubscriptions ?? 0, active: statusCardFilter === 'paid', onClick: () => { setStatusCardFilter('paid'); setFilterType('all'); setCurrentPage(1); } },
                        { label: 'Trial', tone: 'blue', count: stats?.trialUsers ?? 0, active: statusCardFilter === 'trial', onClick: () => { setStatusCardFilter('trial'); setFilterType('all'); setCurrentPage(1); } },
                        { label: 'Expired', tone: 'amber', count: stats?.expiredUsers ?? 0, active: statusCardFilter === 'expired', onClick: () => { setStatusCardFilter('expired'); setFilterType('all'); setCurrentPage(1); } },
                        { label: 'Cancelled', tone: 'red', count: stats?.cancelledSubscriptions ?? 0, active: statusCardFilter === 'cancelled', onClick: () => { setStatusCardFilter('cancelled'); setFilterType('all'); setCurrentPage(1); } },
                        { label: 'Refunded', tone: 'orange', count: stats?.refundedUsers ?? 0, active: statusCardFilter === 'refunded', onClick: () => { setStatusCardFilter('refunded'); setFilterType('all'); setCurrentPage(1); } },
                        { label: 'Agency', tone: 'violet', count: stats?.packageStats?.AGENCY ?? 0, active: filterType === 'AGENCY', onClick: () => { setFilterType('AGENCY'); setStatusCardFilter('all'); setCurrentPage(1); } },
                      ];
                      return chips.map((chip) => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={chip.onClick}
                          className={chipClass(chip.active, chip.tone)}
                        >
                          <span>{chip.label}</span>
                          <span className="tabular-nums font-semibold text-current">{chip.count}</span>
                        </button>
                      ));
                    })()}
                  </div>
                  {pagination.totalCount > 0 && (
                    <div className="text-xs text-gray-500">
                      {searchQuery || filterType !== 'all' || statusCardFilter !== 'all' || startDate || endDate || spApiFilter !== 'all' || adsFilter !== 'all'
                        ? `${pagination.totalCount} match filters`
                        : `Showing all ${pagination.totalCount} users`}
                    </div>
                  )}
                </div>

                {/* RIGHT: users-by-country pie chart, sourced from Stripe billing address */}
                <div className="w-full xl:flex-1 min-w-0 rounded-xl border border-white/10 bg-[#0b0f17]/70 p-3 sm:p-4 flex flex-col">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Users by Country</p>
                    {countryStats && countryStats.countries.length > 0 && (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-gray-400">
                        {countryStats.countries.reduce((sum, item) => sum + item.count, 0) + (countryStats.uncategorized || 0)} users
                      </span>
                    )}
                  </div>
                  {countryStatsLoading ? (
                    <div className="w-full flex items-center justify-center py-10">
                      <div className="animate-spin rounded-full h-6 w-6 border-2 border-[#333] border-t-blue-500" />
                    </div>
                  ) : !countryStats || countryStats.countries.length === 0 ? (
                    <div className="w-full flex items-center justify-center py-10">
                      <p className="text-xs text-gray-500">No country data available yet</p>
                    </div>
                  ) : (() => {
                    const COUNTRY_PIE_COLORS = ['#60a5fa', '#f59e0b', '#34d399', '#c084fc', '#f472b6', '#2dd4bf', '#fb923c', '#818cf8', '#a3e635', '#f87171'];
                    const slices = [...countryStats.countries];
                    if (countryStats.uncategorized > 0) {
                      slices.push({ country: 'Unknown', count: countryStats.uncategorized });
                    }
                    const totalUsers = slices.reduce((sum, item) => sum + item.count, 0);
                    const chartOptions = {
                      chart: {
                        type: 'donut',
                        fontFamily: "'Inter', sans-serif",
                        parentHeightOffset: 0,
                        toolbar: { show: false },
                        sparkline: { enabled: false },
                      },
                      labels: slices.map((s) => s.country),
                      colors: slices.map((s, i) => s.country === 'Unknown' ? '#4b5563' : COUNTRY_PIE_COLORS[i % COUNTRY_PIE_COLORS.length]),
                      legend: { show: false },
                      plotOptions: {
                        pie: {
                          customScale: 0.92,
                          donut: {
                            size: '64%',
                            labels: {
                              show: true,
                              name: { show: true, color: '#94a3b8', fontSize: '11px', offsetY: 8 },
                              value: { show: true, color: '#f8fafc', fontSize: '20px', fontWeight: 700, offsetY: -10 },
                              total: {
                                show: true,
                                label: 'Total',
                                color: '#94a3b8',
                                fontSize: '11px',
                                formatter: () => totalUsers,
                              },
                            },
                          },
                        },
                      },
                      dataLabels: { enabled: false },
                      stroke: { width: 3, colors: ['#0b0f17'] },
                      tooltip: { theme: 'dark' },
                      states: {
                        hover: { filter: { type: 'lighten', value: 0.08 } },
                        active: { filter: { type: 'none' } },
                      },
                    };
                    return (
                      <div className="grid grid-cols-1 md:grid-cols-[minmax(280px,1fr)_minmax(180px,0.7fr)] items-center gap-4 flex-1 min-h-[300px]">
                        <div className="w-full h-[300px] min-w-0 flex items-center justify-center">
                          <Chart
                            options={chartOptions}
                            series={slices.map((s) => s.count)}
                            type="donut"
                            width="100%"
                            height="100%"
                          />
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 max-h-[220px] sm:max-h-[220px] lg:max-h-[230px] 2xl:max-h-[240px] overflow-y-auto pr-1 min-w-0">
                          {slices.map((slice, index) => {
                            const color = slice.country === 'Unknown' ? '#4b5563' : COUNTRY_PIE_COLORS[index % COUNTRY_PIE_COLORS.length];
                            return (
                              <div key={slice.country} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-2.5 py-2">
                                <span className="flex min-w-0 items-center gap-2 text-xs text-gray-300">
                                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                                  <span className="truncate">{slice.country}</span>
                                </span>
                                <span className="shrink-0 rounded-md bg-white/[0.05] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-gray-100">
                                  {slice.count}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                </div>
              </div>

              {/* Table */}
              <div className="rounded-2xl border border-white/10 bg-[#101722]/90 overflow-hidden shadow-2xl shadow-black/20 backdrop-blur">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px]">
                    <thead>
                      <tr className="border-b border-white/10 bg-[#080c12]/90">
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider min-w-[150px]">User</th>
                        <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">User Type</th>
                        <th className="px-2 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Brand</th>
                        <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                        <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">SpAPI</th>
                        <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Ads</th>
                        <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Card</th>
                        <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Joining Date</th>
                        <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Renewal Date</th>
                        <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {users.map((user) => {
                        const isAgencyOwner = user.packageType === 'AGENCY';
                        const isExpanded = isAgencyOwner && expandedAgencyIds.has(user._id);
                        const clients = agencyClientsCache[user._id] || [];
                        return (
                          <React.Fragment key={user._id}>
                            {renderAccountRow(user)}
                            {isExpanded && !agencyClientsLoading.has(user._id) && (
                              clients.length === 0 ? (
                                <tr>
                                  <td colSpan={10} className="px-3 py-3 text-center text-xs text-gray-500 bg-blue-500/[0.035]">
                                    No clients under this agency
                                  </td>
                                </tr>
                              ) : (
                                clients.map((client) => renderAccountRow(client, { isChild: true }))
                              )
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {pagination.totalPages > 1 && (
                  <div className="flex flex-col items-center gap-2 px-4 py-4 border-t border-white/10 bg-[#080c12]/90">
                    <p className="text-xs text-gray-500">
                      {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, pagination.totalCount)} of {pagination.totalCount}
                    </p>
                    <div className="flex items-center gap-1 justify-center">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-2 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      {getPaginationGroup().map((page) => (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`min-w-[32px] py-2 px-2 rounded-lg text-sm font-medium transition ${
                            currentPage === page ? 'bg-blue-600 text-white shadow-lg shadow-blue-950/30' : 'border border-white/10 text-gray-400 hover:bg-white/[0.05] hover:text-gray-200'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))}
                        disabled={currentPage === pagination.totalPages}
                        className="p-2 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {users.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-[#101722]/90 py-16 text-center shadow-2xl shadow-black/20">
                  <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center mx-auto mb-3">
                    <Users className="w-6 h-6 text-gray-500" />
                  </div>
                  <h4 className="text-sm font-medium text-gray-300">No users found</h4>
                  <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">Adjust search or filters to see results.</p>
                </div>
              )}
            </>
          )}
      </div>
    </div>
  );
};

export default ManageAccounts;

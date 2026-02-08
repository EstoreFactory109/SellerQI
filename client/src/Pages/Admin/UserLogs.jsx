import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Users,
  Search,
  Filter,
  Activity,
  Crown,
  Shield,
  Briefcase,
  Mail,
  X,
  RefreshCw,
} from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

const ITEMS_PER_PAGE = 10;

const AdminUserLogs = () => {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch accounts data (same as ManageAccounts)
  const fetchAccounts = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await axiosInstance.get('/app/auth/admin/accounts');

      if (response.data.statusCode === 401) {
        localStorage.removeItem('isAdminAuth');
        localStorage.removeItem('adminAccessType');
        localStorage.removeItem('adminId');
        navigate('/admin-login');
      }

      if (response.data.statusCode === 200) {
        const accounts = response.data.data.accounts || [];
        setUsers(accounts);
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

  // Filter users
  const filteredUsers = useMemo(() => {
    if (loading || !users || users.length === 0) {
      return [];
    }

    let filtered = [...users];

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

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [filteredUsers.length, totalPages, currentPage]);

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

  const handleCheckLogs = (user) => {
    navigate(`/manage-accounts/logs/user/${user._id}`);
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
          <p className="ml-3 text-sm text-gray-500">Loading users...</p>
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

      {/* Search and Filter Bar */}
      {!loading && !error && (
        <>
          <div className="rounded-lg border border-[#252525] bg-[#161b22] p-4 md:p-5 mb-6">
            <div className="flex flex-col lg:flex-row gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500 placeholder-gray-500"
                />
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
              <button
                onClick={fetchAccounts}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-[#21262d] text-gray-300 border border-[#30363d] hover:bg-[#30363d] transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>

            {/* Stats */}
            <div className="mt-4 pt-4 border-t border-[#252525] flex items-center justify-between">
              <p className="text-sm text-gray-400">
                {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''} found
              </p>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-lg border border-[#252525] bg-[#161b22] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed min-w-[700px]">
                <thead>
                  <tr className="border-b border-[#252525] bg-[#0d0d0d]">
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[28%]">User</th>
                    <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">Type</th>
                    <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">Brand</th>
                    <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">Status</th>
                    <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">Created</th>
                    <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[24%]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#252525]">
                  {paginatedData.map((user) => {
                    const packageInfo = getPackageTypeInfo(user);
                    const statusInfo = getSubscriptionStatus(user);
                    const PackageIcon = packageInfo.icon;
                    return (
                      <tr key={user._id} className="hover:bg-[#1a1a1a] transition-colors">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-9 h-9 rounded-lg bg-[#252525] flex items-center justify-center shrink-0">
                              <span className="text-gray-300 text-xs font-medium">
                                {(user.firstName?.[0] || '') + (user.lastName?.[0] || '')}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-100 break-words">
                                {user.firstName} {user.lastName}
                              </p>
                              <p className="text-xs text-gray-500 break-all flex items-center gap-1">
                                <Mail className="w-3 h-3 shrink-0" />{user.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${packageInfo.color}`}>
                            <PackageIcon className="w-3 h-3" />{packageInfo.label.split(' ')[0]}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-xs text-gray-400">{user.brand || '—'}</td>
                        <td className="px-2 py-3 text-center">
                          <span className={`text-xs font-medium ${statusInfo.color}`}>
                            {statusInfo.label.split(' ')[0]}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center text-xs text-gray-500">{formatDate(user.createdAt)}</td>
                        <td className="px-2 py-3">
                          <div className="flex items-center justify-center">
                            <button
                              onClick={() => handleCheckLogs(user)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                            >
                              <Activity className="w-3.5 h-3.5" />
                              Check Logs
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 px-4 py-3 border-t border-[#252525] bg-[#0d0d0d]">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1">
                  {getPaginationGroup().map((page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`min-w-[32px] py-2 px-2 rounded-lg text-sm font-medium ${currentPage === page ? 'bg-blue-600 text-white' : 'border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a]'
                        }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
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

export default AdminUserLogs;

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Search,
  LogIn,
  Trash2,
  MoreVertical,
  Check,
  X as XIcon,
  Mail,
  UserPlus,
  Settings,
  Loader2,
} from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import AddClientForm from '../../Components/Agency/AddClientForm.jsx';

const ITEMS_PER_PAGE = 10;

const ManageAgencyUsers = () => {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [loginLoadingId, setLoginLoadingId] = useState(null);
  const [loginError, setLoginError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteConfirmClient, setDeleteConfirmClient] = useState(null);
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState(null);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [agencyName, setAgencyName] = useState('');
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

  const fetchClients = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await axiosInstance.get('/app/admin/clients');

      if (response.data.statusCode === 401) {
        localStorage.removeItem('isAuth');
        localStorage.removeItem('userAccessType');
        navigate('/agency-login');
        return;
      }

      if (response.data.statusCode === 200 && Array.isArray(response.data.data)) {
        setClients(response.data.data);
      } else {
        setError(response.data?.message || 'Failed to load clients');
      }
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.removeItem('isAuth');
        localStorage.removeItem('userAccessType');
        navigate('/agency-login');
        return;
      }
      setError(err.response?.data?.message || 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  useEffect(() => {
    const loadAgencyName = async () => {
      try {
        const res = await axiosInstance.get('/app/admin/profile');
        if (res.data?.statusCode === 200 && res.data?.data?.adminInfo?.agencyName) {
          setAgencyName(res.data.data.adminInfo.agencyName);
        }
      } catch (_) {
        // use fallback in links
      }
    };
    loadAgencyName();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setOpenDropdownId(null);
        setDropdownPosition(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredClients = clients.filter((c) => {
    const name = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
    const email = (c.email || '').toLowerCase();
    const q = searchQuery.toLowerCase().trim();
    return !q || name.includes(q) || email.includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / ITEMS_PER_PAGE));
  const paginatedClients = filteredClients.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const handleLoginAsClient = async (client) => {
    try {
      setLoginLoadingId(client._id);
      setLoginError('');
      
      console.log('Logging in as client:', client);
      
      // Call the agency admin login-as-client API (same pattern as super admin)
      const response = await axiosInstance.post('/app/admin/switch-to-client', {
        clientId: client._id
      });
      
      if (response.data.statusCode === 200) {
        console.log('Successfully logged in as client:', response.data.data);
        
        // Store client info in localStorage (for UI purposes - same as super admin)
        localStorage.setItem('loggedInAsClient', JSON.stringify({
          clientId: client._id,
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email
        }));
        
        // Clear agency admin access type since we're now logged in as a client
        // This ensures proper redirect behavior when refreshing or navigating
        localStorage.removeItem('userAccessType');
        
        // Set isAuth for the client session
        localStorage.setItem('isAuth', 'true');
        
        // Navigate to the main dashboard as the selected client
        // The cookies (IbexAccessToken, IbexRefreshToken, LocationToken) are automatically set by the server
        window.location.href = '/seller-central-checker/dashboard';
      } else {
        setLoginError(response.data.message || 'Failed to login as client');
      }
    } catch (error) {
      console.error('Error logging in as client:', error);
      setLoginError(error.response?.data?.message || 'Failed to login as selected client');
    } finally {
      setLoginLoadingId(null);
    }
  };

  const handleRemoveClient = async (client) => {
    try {
      setDeletingId(client._id);
      setDeleteError('');
      const response = await axiosInstance.delete(`/app/admin/clients/${client._id}`);

      if (response.data.statusCode === 200) {
        setClients((prev) => prev.filter((c) => c._id !== client._id));
        setDeleteConfirmClient(null);
      } else {
        setDeleteError(response.data?.message || 'Failed to remove client');
      }
    } catch (err) {
      setDeleteError(err.response?.data?.message || 'Failed to remove client');
    } finally {
      setDeletingId(null);
    }
  };

  const getConnectionBadge = (connected) => {
    if (connected) return { label: 'Connected', color: 'text-green-500', bg: 'bg-green-500/10' };
    return { label: 'Not Connected', color: 'text-red-400', bg: 'bg-red-500/10' };
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto w-full">
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#333] border-t-blue-500" />
          <p className="ml-3 text-sm text-gray-500">Loading clients…</p>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 mb-6">
          <p className="text-sm font-medium text-red-300">Error: {error}</p>
          <button
            onClick={fetchClients}
            className="mt-3 px-3 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500"
          >
            Retry
          </button>
        </div>
      )}

      {loginError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 mb-6">
          <p className="text-sm font-medium text-red-300">{loginError}</p>
          <button onClick={() => setLoginError('')} className="mt-2 px-3 py-2 text-sm rounded-lg bg-[#252525] text-gray-300">
            Dismiss
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="rounded-lg border border-[#252525] bg-[#161b22] p-4 md:p-5 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="relative w-full min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search by name or email…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-[#30363d] bg-[#21262d] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <div className="rounded-lg border border-[#252525] bg-[#0d0d0d] px-4 py-3">
                <p className="text-xl font-semibold tabular-nums text-gray-100">{filteredClients.length}</p>
                <p className="text-xs text-gray-500">Total clients</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddClientModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                Add client
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-[#252525] bg-[#161b22] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-[#252525] bg-[#0d0d0d]">
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[200px]">Client</th>
                    <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                    <th className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Brand name</th>
                    <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Seller account</th>
                    <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Ads account</th>
                    <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                    <th className="px-2 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#252525]">
                  {paginatedClients.map((client) => {
                    const spApiBadge = getConnectionBadge(client.hasSpApi === true);
                    const adsApiBadge = getConnectionBadge(client.hasAdsApi === true);
                    const isDropdownOpen = openDropdownId === client._id;
                    return (
                      <tr key={client._id} className="hover:bg-[#1a1a1a] transition-colors">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-[#252525] flex items-center justify-center shrink-0">
                              <span className="text-gray-300 text-xs font-medium">
                                {(client.firstName?.[0] || '') + (client.lastName?.[0] || '')}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-100">
                                {client.firstName} {client.lastName}
                              </p>
                              <p className="text-xs text-gray-500 flex items-center gap-1">
                                <Mail className="w-3 h-3 shrink-0 text-blue-400" />
                                {client.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-sm text-gray-400">{client.phone || '—'}</td>
                        <td className="px-2 py-2.5 text-sm text-gray-300">{client.brandName || '—'}</td>
                        <td className="px-2 py-2.5 text-center">
                          <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded ${spApiBadge.bg} ${spApiBadge.color}`}>
                            {spApiBadge.label}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded ${adsApiBadge.bg} ${adsApiBadge.color}`}>
                            {adsApiBadge.label}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-center text-xs text-gray-500">{formatDate(client.createdAt)}</td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center justify-center">
                            <button
                              ref={isDropdownOpen ? triggerRef : undefined}
                              type="button"
                              onClick={(e) => {
                                if (isDropdownOpen) {
                                  setOpenDropdownId(null);
                                  setDropdownPosition(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setDropdownPosition({
                                    left: rect.right - 160,
                                    top: rect.bottom + 4,
                                  });
                                  setOpenDropdownId(client._id);
                                }
                              }}
                              className="p-1.5 rounded-lg text-gray-400 hover:bg-[#252525] hover:text-gray-300"
                              aria-label="Actions"
                            >
                              <MoreVertical className="w-4 h-4" />
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
              <div className="flex flex-col items-center gap-2 px-4 py-3 border-t border-[#252525] bg-[#0d0d0d]">
                <p className="text-xs text-gray-500">
                  {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredClients.length)} of {filteredClients.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a] disabled:opacity-40"
                  >
                    ←
                  </button>
                  <span className="px-3 text-sm text-gray-400">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#1a1a1a] disabled:opacity-40"
                  >
                    →
                  </button>
                </div>
              </div>
            )}
          </div>

          {filteredClients.length === 0 && (
            <div className="rounded-lg border border-[#252525] bg-[#161b22] py-16 text-center">
              <Users className="w-12 h-12 text-blue-400 mx-auto mb-3 block" />
              <h4 className="text-sm font-medium text-gray-300">No clients yet</h4>
              <p className="text-xs text-gray-500 mt-1">Click &quot;Add client&quot; above to register a new client.</p>
            </div>
          )}

          {loginLoadingId &&
            createPortal(
              <div
                className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80"
                role="status"
                aria-live="polite"
                aria-label="Logging in as client"
              >
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="w-10 h-10 text-blue-400 animate-spin" aria-hidden="true" />
                  <p className="text-sm font-medium text-gray-300">Logging in as client...</p>
                </div>
              </div>,
              document.body
            )}

          {showAddClientModal &&
            createPortal(
              <div
                className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70"
                onClick={() => setShowAddClientModal(false)}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-client-modal-title"
              >
                <div
                  className="bg-[#161b22] rounded-xl border border-[#252525] w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between p-4 md:p-5 border-b border-[#252525]">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-lg bg-[#1a1a1a] flex items-center justify-center">
                        <UserPlus className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <h2 id="add-client-modal-title" className="text-lg font-semibold text-gray-100">
                          Add client
                        </h2>
                        <p className="text-xs text-gray-500">Create a new client under your agency</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddClientModal(false)}
                      className="p-2 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-[#252525] transition-colors"
                      aria-label="Close"
                    >
                      <XIcon className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="p-4 md:p-6">
                    <AddClientForm
                      showCancelButton
                      onCancel={() => setShowAddClientModal(false)}
                      agencyName={agencyName}
                    />
                  </div>
                </div>
              </div>,
              document.body
            )}

          {openDropdownId && dropdownPosition && (() => {
            const client = paginatedClients.find((c) => c._id === openDropdownId);
            if (!client) return null;
            return createPortal(
              <div
                ref={dropdownRef}
                className="fixed z-[100] min-w-[140px] py-1 rounded-lg bg-[#1a1a1a] border border-[#252525] shadow-lg"
                style={{
                  left: dropdownPosition.left,
                  top: Math.min(dropdownPosition.top, window.innerHeight - 120),
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpenDropdownId(null);
                    setDropdownPosition(null);
                    const slug = encodeURIComponent(agencyName || 'agency');
                    navigate(`/agency/${slug}/client/${client._id}/connect-to-amazon`);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-blue-400 hover:bg-[#252525]"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Setup / Connect
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpenDropdownId(null);
                    setDropdownPosition(null);
                    handleLoginAsClient(client);
                  }}
                  disabled={loginLoadingId === client._id}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-green-500 hover:bg-[#252525] disabled:opacity-50"
                >
                  {loginLoadingId === client._id ? (
                    <div className="w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <LogIn className="w-3.5 h-3.5" />
                  )}
                  Login as client
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpenDropdownId(null);
                    setDropdownPosition(null);
                    setDeleteConfirmClient(client);
                  }}
                  disabled={deletingId === client._id}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-red-500 hover:bg-[#252525] disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove client
                </button>
              </div>,
              document.body
            );
          })()}

          {deleteConfirmClient && (
            <div
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
              onClick={() => !deletingId && setDeleteConfirmClient(null)}
            >
              <div
                className="bg-[#161b22] rounded-lg max-w-md w-full p-6 border border-[#30363d]"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-base font-semibold text-gray-100 mb-2">Remove client</h3>
                <p className="text-sm text-gray-400 mb-4">
                  Are you sure you want to remove {deleteConfirmClient.firstName} {deleteConfirmClient.lastName}? This cannot be undone.
                </p>
                {deleteError && (
                  <p className="text-xs text-red-400 mb-4">{deleteError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteConfirmClient(null)}
                    disabled={!!deletingId}
                    className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-[#30363d] text-gray-300 hover:bg-[#21262d]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleRemoveClient(deleteConfirmClient)}
                    disabled={!!deletingId}
                    className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {deletingId ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ManageAgencyUsers;

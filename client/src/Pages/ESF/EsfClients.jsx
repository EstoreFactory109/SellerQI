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
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import EsfAddClientForm from '../../Components/ESF/EsfAddClientForm.jsx';
import EsfExistingUsersPicker from '../../Components/ESF/EsfExistingUsersPicker.jsx';

const ITEMS_PER_PAGE = 10;
const DROPDOWN_MENU_WIDTH = 160;
const DROPDOWN_MENU_HEIGHT = 90;

const EsfClients = () => {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [loginLoadingId, setLoginLoadingId] = useState(null);
  const [notice, setNotice] = useState('');
  const [successNotice, setSuccessNotice] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteConfirmClient, setDeleteConfirmClient] = useState(null);
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState(null);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [addClientTab, setAddClientTab] = useState('new'); // 'new' | 'existing'
  const dropdownRef = useRef(null);
  const openDropdownButtonRef = useRef(null);

  const fetchClients = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await axiosInstance.get('/app/esf/clients');
      if (res.data?.statusCode === 200 && Array.isArray(res.data.data)) {
        setClients(res.data.data);
      } else {
        setError(res.data?.message || 'Failed to load clients');
      }
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.removeItem('isEsfAuth');
        navigate('/esf-login', { replace: true });
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
    const handleClickOutside = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        openDropdownButtonRef.current &&
        !openDropdownButtonRef.current.contains(e.target)
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
    const brand = (c.brandName || '').toLowerCase();
    const q = searchQuery.toLowerCase().trim();
    return !q || name.includes(q) || email.includes(q) || brand.includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / ITEMS_PER_PAGE));
  const paginatedClients = filteredClients.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const getPaginationGroup = () => Array.from({ length: totalPages }, (_, i) => i + 1);

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // Swaps the IBEX* cookies to the client, then opens their dashboard.
  // The ESFToken cookie is untouched, so the portal session survives underneath.
  const handleLoginAsClient = async (client) => {
    try {
      setLoginLoadingId(client._id);
      setNotice('');

      const res = await axiosInstance.post('/app/esf/clients/switch', { clientId: client._id });

      if (res.data?.statusCode === 200) {
        localStorage.setItem(
          'loggedInAsClient',
          JSON.stringify({
            clientId: client._id,
            firstName: client.firstName,
            lastName: client.lastName,
            email: client.email,
          })
        );
        localStorage.setItem('isAuth', 'true');
        window.location.href = '/seller-central-checker/dashboard';
      } else {
        setNotice(res.data?.message || 'Failed to open this client');
        setLoginLoadingId(null);
      }
    } catch (err) {
      setNotice(err.response?.data?.message || 'Failed to open this client');
      setLoginLoadingId(null);
    }
  };

  const handleRemoveClient = async (client) => {
    try {
      setDeletingId(client._id);
      setDeleteError('');
      const res = await axiosInstance.delete(`/app/esf/clients/${client._id}`);
      if (res.data?.statusCode === 200) {
        setClients((prev) => prev.filter((c) => c._id !== client._id));
        setDeleteConfirmClient(null);
      } else {
        setDeleteError(res.data?.message || 'Failed to remove client');
      }
    } catch (err) {
      setDeleteError(err.response?.data?.message || 'Failed to remove client');
    } finally {
      setDeletingId(null);
    }
  };

  const connectionCell = (connected, label) =>
    connected ? (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20">
        <Check className="w-4 h-4 text-green-400" aria-label={`${label} connected`} />
      </span>
    ) : (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
        <XIcon className="w-4 h-4 text-red-400" aria-label={`${label} not connected`} />
      </span>
    );

  return (
    <div className="relative min-h-full w-full overflow-hidden bg-[#0b0f17] p-4 md:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_30%)]" />
      <div className="relative max-w-[1600px] w-full">
        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-[#101722]/80 py-20 shadow-2xl shadow-black/20">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/10 border-t-blue-500" />
            <p className="ml-3 text-sm text-gray-400">Loading clients…</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-6 shadow-lg shadow-red-950/10">
            <p className="text-sm font-medium text-red-300">Error: {error}</p>
            <button
              onClick={fetchClients}
              className="mt-3 px-3 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {successNotice && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 mb-6 shadow-lg shadow-emerald-950/10">
            <p className="text-sm font-medium text-emerald-300">{successNotice}</p>
            <button
              onClick={() => setSuccessNotice('')}
              className="mt-2 px-3 py-2 text-sm font-medium rounded-lg border border-white/10 text-gray-300 hover:bg-white/[0.05] hover:text-gray-200 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Action-level failures (opening a client, removing one) */}
        {notice && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-6 shadow-lg shadow-red-950/10">
            <p className="text-sm font-medium text-red-300">{notice}</p>
            <button
              onClick={() => setNotice('')}
              className="mt-2 px-3 py-2 text-sm font-medium rounded-lg border border-white/10 text-gray-300 hover:bg-white/[0.05] hover:text-gray-200 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Login-in-progress overlay */}
        {loginLoadingId &&
          createPortal(
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-[#101722] rounded-2xl border border-white/10 shadow-2xl px-8 py-6 flex flex-col items-center gap-4 min-w-[240px]">
                <div className="w-12 h-12 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-200 font-medium">Logging in as client…</p>
                <p className="text-gray-500 text-sm">Please wait</p>
              </div>
            </div>,
            document.body
          )}

        {!loading && !error && (
          <>
            {/* Search and Actions */}
            <div className="rounded-2xl border border-white/10 bg-[#101722]/90 p-4 md:p-5 mb-6 shadow-2xl shadow-black/20 backdrop-blur">
              <div className="flex flex-col xl:flex-row gap-5 items-stretch">
                <div className="flex flex-col gap-3 w-full xl:w-[52%] 2xl:w-[50%] rounded-xl border border-white/10 bg-[#0b0f17]/70 p-4">
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <input
                      type="text"
                      placeholder="Search name, email, brand…"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="w-full pl-8 pr-3 py-2.5 text-sm border border-white/10 bg-white/[0.04] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10 placeholder-gray-500 transition"
                    />
                  </div>
                </div>

                <div className="flex flex-1 items-center justify-end gap-4">
                  <div className="rounded-xl border border-white/10 bg-[#0b0f17]/70 px-4 py-3">
                    <p className="text-xl font-semibold tabular-nums text-gray-100">{filteredClients.length}</p>
                    <p className="text-xs text-gray-500">Total clients</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setAddClientTab('new'); setShowAddClientModal(true); }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-950/30"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add client
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="rounded-2xl border border-white/10 bg-[#101722]/90 overflow-hidden shadow-2xl shadow-black/20 backdrop-blur">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="border-b border-white/10 bg-[#080c12]/90">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider min-w-[150px]">Client</th>
                      <th className="px-2 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Brand</th>
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">SpAPI</th>
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Ads</th>
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Added By</th>
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Joining Date</th>
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {paginatedClients.map((client) => {
                      const isDropdownOpen = openDropdownId === client._id;
                      return (
                        <tr key={client._id} className="group transition-colors hover:bg-white/[0.035] bg-transparent">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm border bg-sky-500/10 border-sky-400/20">
                                <span className="text-gray-100 text-xs font-semibold">
                                  {(client.firstName?.[0] || '') + (client.lastName?.[0] || '')}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-100 break-words">
                                  {client.firstName} {client.lastName}
                                </p>
                                <p className="text-xs text-gray-500 break-all flex items-center gap-1 mt-0.5">
                                  <Mail className="w-3 h-3 shrink-0" />
                                  {client.email}
                                </p>
                                <p className="text-xs text-gray-500">{client.phone || '—'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-xs text-gray-400">
                            <span className="line-clamp-2">{client.brandName || '—'}</span>
                          </td>
                          <td className="px-2 py-2.5 text-center text-xs">
                            {connectionCell(client.hasSpApi === true, 'Seller account')}
                          </td>
                          <td className="px-2 py-2.5 text-center text-xs">
                            {connectionCell(client.hasAdsApi === true, 'Ads account')}
                          </td>
                          <td className="px-2 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 text-xs font-medium text-gray-400">
                              {client.addedByName || '—'}
                            </span>
                          </td>
                          <td className="px-2 py-2.5 text-center text-xs text-gray-500 whitespace-nowrap">
                            {formatDate(client.createdAt)}
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
                                    setOpenDropdownId(client._id);
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
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex flex-col items-center gap-2 px-4 py-4 border-t border-white/10 bg-[#080c12]/90">
                  <p className="text-xs text-gray-500">
                    {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredClients.length)} of {filteredClients.length}
                  </p>
                  <div className="flex items-center gap-1 justify-center">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
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
                          currentPage === page
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-950/30'
                            : 'border border-white/10 text-gray-400 hover:bg-white/[0.05] hover:text-gray-200'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="p-2 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {filteredClients.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-[#101722]/90 py-16 text-center shadow-2xl shadow-black/20">
                <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center mx-auto mb-3">
                  <Users className="w-6 h-6 text-gray-500" />
                </div>
                <h4 className="text-sm font-medium text-gray-300">No clients found</h4>
                <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                  Click &quot;Add client&quot; above to register a new client.
                </p>
              </div>
            )}

            {/* Add client modal */}
            {showAddClientModal &&
              createPortal(
                <div
                  className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                  onClick={() => setShowAddClientModal(false)}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="esf-add-client-modal-title"
                >
                  <div
                    className="bg-[#101722] rounded-2xl border border-white/10 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between p-4 md:p-5 border-b border-white/10">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-400/20 flex items-center justify-center">
                          <UserPlus className="w-4 h-4 text-blue-400" />
                        </div>
                        <div>
                          <h2 id="esf-add-client-modal-title" className="text-lg font-semibold text-gray-100">
                            Add client
                          </h2>
                          <p className="text-xs text-gray-500">
                            {addClientTab === 'new'
                              ? 'Create a brand new client account'
                              : 'Adopt an existing SellerQI seller'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAddClientModal(false)}
                        className="p-2 rounded-lg text-gray-400 hover:bg-white/[0.06] hover:text-gray-200 transition-colors"
                        aria-label="Close"
                      >
                        <XIcon className="w-5 h-5" />
                      </button>
                    </div>
                    {/* Two ways in: create a fresh account, or adopt a seller
                        who already has one. */}
                    <div className="flex items-center gap-1 px-4 md:px-6 pt-4 border-b border-white/10">
                      {[
                        { key: 'new', label: 'New client' },
                        { key: 'existing', label: 'Existing users' },
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setAddClientTab(tab.key)}
                          className={`px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2 ${
                            addClientTab === tab.key
                              ? 'text-gray-100 border-blue-500'
                              : 'text-gray-300 border-transparent hover:text-white hover:border-white/25'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="p-4 md:p-6">
                      {addClientTab === 'new' ? (
                        <EsfAddClientForm
                          showCancelButton
                          onCancel={() => setShowAddClientModal(false)}
                          onCreated={(client) => {
                            setClients((prev) => [client, ...prev]);
                            setShowAddClientModal(false);
                            setCurrentPage(1);
                            // TEMPORARY: onboarding is bypassed, so go straight to
                            // the dashboard. Restore the line below to send a new
                            // client into the Amazon connect flow instead.
                            // navigate(`/esf/client/${client._id}/connect-to-amazon`);
                            window.location.href = '/seller-central-checker/dashboard';
                          }}
                        />
                      ) : (
                        <EsfExistingUsersPicker
                          onCancel={() => setShowAddClientModal(false)}
                          onLinked={(message) => {
                            setShowAddClientModal(false);
                            setSuccessNotice(message || 'Clients added successfully');
                            setCurrentPage(1);
                            fetchClients();
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>,
                document.body
              )}

            {/* Actions dropdown (portal so it is not clipped by table overflow) */}
            {openDropdownId && dropdownPosition && (() => {
              const client = paginatedClients.find((c) => c._id === openDropdownId);
              if (!client) return null;
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
                      handleLoginAsClient(client);
                    }}
                    disabled={loginLoadingId === client._id}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-green-500 hover:bg-[#252525] hover:text-green-400 disabled:opacity-50"
                  >
                    <LogIn className="w-3.5 h-3.5" />
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
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-red-500 hover:bg-[#252525] hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove from portal
                  </button>
                </div>,
                document.body
              );
            })()}

            {/* Remove confirmation */}
            {deleteConfirmClient && (
              <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[210] p-4"
                onClick={() => !deletingId && setDeleteConfirmClient(null)}
              >
                <div
                  className="bg-[#101722] rounded-2xl max-w-md w-full p-6 border border-white/10 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-base font-semibold text-gray-100 mb-2">Remove from portal</h3>
                  <p className="text-sm text-gray-400 mb-4">
                    Remove {deleteConfirmClient.firstName} {deleteConfirmClient.lastName}
                    {deleteConfirmClient.email ? ` (${deleteConfirmClient.email})` : ''} from the eStore Factory
                    portal? Their SellerQI account, Amazon connection and data are kept — they simply stop being
                    an ESF client, and the team can no longer open or manage their account.
                  </p>
                  <p className="text-xs text-gray-500 mb-4">
                    Deleting a seller account entirely is done by a super admin, not from this portal.
                  </p>
                  {deleteError && <p className="text-xs text-red-400 mb-4">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeleteConfirmClient(null)}
                      disabled={!!deletingId}
                      className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-white/10 text-gray-300 hover:bg-white/[0.05] hover:text-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleRemoveClient(deleteConfirmClient)}
                      disabled={!!deletingId}
                      className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
                    >
                      {deletingId ? 'Removing…' : 'Remove from portal'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default EsfClients;

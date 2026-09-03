import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  UserCog,
  Search,
  Trash2,
  MoreVertical,
  X as XIcon,
  Mail,
  UserPlus,
  Key,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axiosInstance from '../../config/axios.config.js';
import EsfAddUserForm from '../../Components/ESF/EsfAddUserForm.jsx';

const ITEMS_PER_PAGE = 10;
const DROPDOWN_MENU_WIDTH = 160;
const DROPDOWN_MENU_HEIGHT = 90;

const EsfUsers = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteConfirmUser, setDeleteConfirmUser] = useState(null);
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState(null);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const dropdownRef = useRef(null);
  const openDropdownButtonRef = useRef(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await axiosInstance.get('/app/esf/users');
      if (res.data?.statusCode === 200 && Array.isArray(res.data.data)) {
        setUsers(res.data.data);
      } else {
        setError(res.data?.message || 'Failed to load team members');
      }
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.removeItem('isEsfAuth');
        navigate('/esf-login', { replace: true });
        return;
      }
      setError(err.response?.data?.message || 'Failed to load team members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
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

  const filteredUsers = users.filter((u) => {
    const name = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
    const email = (u.email || '').toLowerCase();
    const q = searchQuery.toLowerCase().trim();
    return !q || name.includes(q) || email.includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / ITEMS_PER_PAGE));
  const paginatedUsers = filteredUsers.slice(
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

  const handleRemoveUser = async (user) => {
    try {
      setDeletingId(user._id);
      setDeleteError('');
      const res = await axiosInstance.delete(`/app/esf/users/${user._id}`);
      if (res.data?.statusCode === 200) {
        setUsers((prev) => prev.filter((u) => u._id !== user._id));
        setDeleteConfirmUser(null);
      } else {
        setDeleteError(res.data?.message || 'Failed to remove team member');
      }
    } catch (err) {
      setDeleteError(err.response?.data?.message || 'Failed to remove team member');
    } finally {
      setDeletingId(null);
    }
  };

  const handleResetPassword = async (user) => {
    const newPassword = window.prompt(`Enter a new password for ${user.firstName} ${user.lastName} (min 8 characters):`);
    if (!newPassword) return;
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    try {
      const res = await axiosInstance.post(`/app/esf/users/${user._id}/reset-password`, { newPassword });
      if (res.data?.statusCode !== 200) {
        setError(res.data?.message || 'Failed to reset password');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password');
    }
  };

  return (
    <div className="relative min-h-full w-full overflow-hidden bg-[#0b0f17] p-4 md:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_30%)]" />
      <div className="relative max-w-[1600px] w-full">
        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-[#101722]/80 py-20 shadow-2xl shadow-black/20">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/10 border-t-blue-500" />
            <p className="ml-3 text-sm text-gray-400">Loading team members…</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-6 shadow-lg shadow-red-950/10">
            <p className="text-sm font-medium text-red-300">Error: {error}</p>
            <button
              onClick={fetchUsers}
              className="mt-3 px-3 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
            >
              Retry
            </button>
          </div>
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
                      placeholder="Search name, email…"
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
                    <p className="text-xl font-semibold tabular-nums text-gray-100">{filteredUsers.length}</p>
                    <p className="text-xs text-gray-500">Team members</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddUserModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-950/30"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add user
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="rounded-2xl border border-white/10 bg-[#101722]/90 overflow-hidden shadow-2xl shadow-black/20 backdrop-blur">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px]">
                  <thead>
                    <tr className="border-b border-white/10 bg-[#080c12]/90">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider min-w-[150px]">Member</th>
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Clients Added</th>
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Last Login</th>
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Joining Date</th>
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {paginatedUsers.map((user) => {
                      const isDropdownOpen = openDropdownId === user._id;
                      return (
                        <tr key={user._id} className="group transition-colors hover:bg-white/[0.035] bg-transparent">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm border bg-violet-500/15 border-violet-400/20">
                                <span className="text-gray-100 text-xs font-semibold">
                                  {(user.firstName?.[0] || '') + (user.lastName?.[0] || '')}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-100 break-words">
                                  {user.firstName} {user.lastName}
                                </p>
                                <p className="text-xs text-gray-500 break-all flex items-center gap-1 mt-0.5">
                                  <Mail className="w-3 h-3 shrink-0" />
                                  {user.email}
                                </p>
                                <p className="text-xs text-gray-500">{user.phone || '—'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 text-xs font-medium text-gray-300 tabular-nums">
                              {user.clientsAdded ?? 0}
                            </span>
                          </td>
                          <td className="px-2 py-2.5 text-center text-xs text-gray-500 whitespace-nowrap">
                            {formatDate(user.lastLoginAt)}
                          </td>
                          <td className="px-2 py-2.5 text-center text-xs text-gray-500 whitespace-nowrap">
                            {formatDate(user.createdAt)}
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
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex flex-col items-center gap-2 px-4 py-4 border-t border-white/10 bg-[#080c12]/90">
                  <p className="text-xs text-gray-500">
                    {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredUsers.length)} of {filteredUsers.length}
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

            {filteredUsers.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-[#101722]/90 py-16 text-center shadow-2xl shadow-black/20">
                <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center mx-auto mb-3">
                  <UserCog className="w-6 h-6 text-gray-500" />
                </div>
                <h4 className="text-sm font-medium text-gray-300">No team members found</h4>
                <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                  Click &quot;Add user&quot; above to give a colleague access.
                </p>
              </div>
            )}

            {/* Add user modal */}
            {showAddUserModal &&
              createPortal(
                <div
                  className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                  onClick={() => setShowAddUserModal(false)}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="esf-add-user-modal-title"
                >
                  <div
                    className="bg-[#101722] rounded-2xl border border-white/10 w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between p-4 md:p-5 border-b border-white/10">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-400/20 flex items-center justify-center">
                          <UserPlus className="w-4 h-4 text-blue-400" />
                        </div>
                        <div>
                          <h2 id="esf-add-user-modal-title" className="text-lg font-semibold text-gray-100">
                            Add user
                          </h2>
                          <p className="text-xs text-gray-500">Give a colleague access to this portal</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAddUserModal(false)}
                        className="p-2 rounded-lg text-gray-400 hover:bg-white/[0.06] hover:text-gray-200 transition-colors"
                        aria-label="Close"
                      >
                        <XIcon className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="p-4 md:p-6">
                      <EsfAddUserForm
                        showCancelButton
                        onCancel={() => setShowAddUserModal(false)}
                        onCreated={(user) => {
                          setUsers((prev) => [user, ...prev]);
                          setShowAddUserModal(false);
                          setCurrentPage(1);
                        }}
                      />
                    </div>
                  </div>
                </div>,
                document.body
              )}

            {/* Actions dropdown (portal so it is not clipped by table overflow) */}
            {openDropdownId && dropdownPosition && (() => {
              const user = paginatedUsers.find((u) => u._id === openDropdownId);
              if (!user) return null;
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
                      handleResetPassword(user);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-blue-400 hover:bg-[#252525] hover:text-blue-300"
                  >
                    <Key className="w-3.5 h-3.5" />
                    Reset password
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenDropdownId(null);
                      setDropdownPosition(null);
                      setDeleteConfirmUser(user);
                    }}
                    disabled={deletingId === user._id}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-red-500 hover:bg-[#252525] hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove access
                  </button>
                </div>,
                document.body
              );
            })()}

            {/* Remove confirmation */}
            {deleteConfirmUser && (
              <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[210] p-4"
                onClick={() => !deletingId && setDeleteConfirmUser(null)}
              >
                <div
                  className="bg-[#101722] rounded-2xl max-w-md w-full p-6 border border-white/10 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-base font-semibold text-gray-100 mb-2">Remove access</h3>
                  <p className="text-sm text-gray-400 mb-4">
                    Are you sure you want to remove {deleteConfirmUser.firstName} {deleteConfirmUser.lastName}? They will no longer be able to sign in to this portal.
                  </p>
                  {deleteError && <p className="text-xs text-red-400 mb-4">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeleteConfirmUser(null)}
                      disabled={!!deletingId}
                      className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-white/10 text-gray-300 hover:bg-white/[0.05] hover:text-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleRemoveUser(deleteConfirmUser)}
                      disabled={!!deletingId}
                      className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
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
    </div>
  );
};

export default EsfUsers;

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Loader2, ChevronLeft, ChevronRight, Check, X as XIcon, UserPlus } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import { extractServerError } from '../../utils/passwordCriteria.js';

/**
 * Adopt existing SellerQI sellers into the ESF portal.
 *
 * Only shows accounts nobody else manages — the server excludes agency clients,
 * agency owners, staff and existing ESF clients, so anything listed here is safe
 * to take on. Selecting does not touch their account; it only marks them as ours.
 */

const CAPSULES = [
  { key: 'all', label: 'All', tone: 'slate' },
  { key: 'PRO', label: 'Pro', tone: 'green' },
  { key: 'LITE', label: 'Lite', tone: 'blue' },
  { key: 'connected', label: 'Connected', tone: 'violet' },
  { key: 'notConnected', label: 'Not connected', tone: 'amber' },
];

// Same capsule treatment as the admin portal's Manage Accounts.
const TONES = {
  slate: ['border-slate-400/45 bg-slate-400/15 text-slate-100', 'border-slate-400/15 bg-slate-400/[0.06] text-slate-400 hover:border-slate-400/30 hover:text-slate-200'],
  green: ['border-emerald-400/45 bg-emerald-500/15 text-emerald-200', 'border-emerald-500/15 bg-emerald-500/[0.06] text-emerald-400 hover:border-emerald-400/30 hover:text-emerald-200'],
  blue: ['border-blue-400/45 bg-blue-500/15 text-blue-200', 'border-blue-500/15 bg-blue-500/[0.06] text-blue-400 hover:border-blue-400/30 hover:text-blue-200'],
  violet: ['border-violet-400/45 bg-violet-500/15 text-violet-200', 'border-violet-500/15 bg-violet-500/[0.06] text-violet-400 hover:border-violet-400/30 hover:text-violet-200'],
  amber: ['border-amber-400/45 bg-amber-500/15 text-amber-200', 'border-amber-500/15 bg-amber-500/[0.06] text-amber-400 hover:border-amber-400/30 hover:text-amber-200'],
};

const chipClass = (active, tone) =>
  `inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
    (TONES[tone] || TONES.slate)[active ? 0 : 1]
  }`;

const EsfExistingUsersPicker = ({ onCancel, onLinked }) => {
  const [users, setUsers] = useState([]);
  const [counts, setCounts] = useState({});
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, totalCount: 0 });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Debounced so typing does not fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const firstLoad = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      if (!firstLoad.current) setPage(1);
      firstLoad.current = false;
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await axiosInstance.get('/app/esf/linkable-users', {
        params: { search: debouncedSearch, filter, page, limit: 10 },
      });
      if (res.data?.statusCode === 200) {
        setUsers(res.data.data.users || []);
        setCounts(res.data.data.counts || {});
        setPagination(res.data.data.pagination || { page: 1, totalPages: 1, totalCount: 0 });
      }
    } catch (err) {
      setError(extractServerError(err, 'Failed to load users'));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filter, page]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (!selected.size) return;
    try {
      setSaving(true);
      setError('');
      const res = await axiosInstance.post('/app/esf/clients/link', { userIds: [...selected] });
      if (res.data?.statusCode === 200) {
        // The parent closes the modal and shows the confirmation on the page.
        onLinked?.(res.data.message);
      } else {
        setError(res.data?.message || 'Failed to add the selected users');
      }
    } catch (err) {
      setError(extractServerError(err, 'Failed to add the selected users'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {error && (
        <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or phone…"
          className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-white/10 bg-white/[0.04] text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10 transition"
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {CAPSULES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => { setFilter(c.key); setPage(1); }}
            className={chipClass(filter === c.key, c.tone)}
          >
            <span>{c.label}</span>
            <span className="tabular-nums font-semibold">{counts[c.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0b0f17]/70 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
            <span className="ml-2 text-sm text-gray-400">Loading users…</span>
          </div>
        ) : users.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-gray-300">No matching users</p>
            <p className="text-xs text-gray-500 mt-1">
              Only sellers who are not already managed by an agency or this portal appear here.
            </p>
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto divide-y divide-white/10">
            {users.map((u) => {
              const isSelected = selected.has(u._id);
              return (
                <label
                  key={u._id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-500/[0.08]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(u._id)}
                    className="w-4 h-4 rounded border-white/20 bg-white/[0.04] accent-blue-600 cursor-pointer shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-100 truncate">
                      {u.firstName} {u.lastName}
                      {u.brandName && <span className="text-gray-500 font-normal"> · {u.brandName}</span>}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{u.email}</p>
                  </div>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.035] text-gray-400 shrink-0">
                    {u.packageType}
                  </span>
                  <span
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${
                      u.hasSpApi && u.hasAdsApi
                        ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-white/10 bg-white/[0.035] text-gray-500'
                    }`}
                  >
                    {u.hasSpApi && u.hasAdsApi ? 'Connected' : 'Not connected'}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-white/10 bg-[#080c12]/60">
            <span className="text-xs text-gray-500">
              Page {pagination.page} of {pagination.totalPages} · {pagination.totalCount} users
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pagination.page <= 1}
                className="p-1.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={pagination.page >= pagination.totalPages}
                className="p-1.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {selected.size > 0 ? (
            <>
              <Check className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-gray-300">{selected.size} selected</span>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-300"
              >
                <XIcon className="w-3 h-3" /> clear
              </button>
            </>
          ) : (
            <span>Select one or more users to add</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-400 border border-white/10 hover:bg-white/[0.05] hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || selected.size === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-lg shadow-blue-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Add {selected.size > 0 ? `${selected.size} ` : ''}client{selected.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-500 border-t border-white/10 pt-4">
        Their account, password and Amazon connection stay exactly as they are — they simply become
        managed by this portal. Removing them later only unlinks them.
      </p>
    </>
  );
};

export default EsfExistingUsersPicker;

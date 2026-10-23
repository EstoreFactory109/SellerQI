import React, { useCallback, useEffect, useState } from 'react';
import { Search, Loader2, Activity, ChevronRight } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import LastActiveBadge from './LastActiveBadge.jsx';
import UserActivityDrawer from './UserActivityDrawer.jsx';
import { useNow, usePolling } from './useNow.js';
import { formatDuration } from '../../utils/activityFormat.js';

/**
 * Activity page body, shared by the super admin (all sellers) and the ESF portal (ESF clients).
 * "Active now" on top, "Recently active" below; refreshes every 30 s; a row opens the drawer.
 * `overviewUrl` / `timelineUrlFor` decide whose data it is — the server enforces access.
 */
const RANGES = [
  { key: '1h', label: 'Last hour' },
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
];
const REFRESH_MS = 30 * 1000;

const Initials = ({ name }) => {
  const letters = String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-blue-500/15 text-xs font-semibold text-blue-200">
      {letters}
    </span>
  );
};

const ActivityOverview = ({ overviewUrl, timelineUrlFor, subjectLabel = 'sellers' }) => {
  const [range, setRange] = useState('24h');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const now = useNow(10000);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      const res = await axiosInstance.get(overviewUrl, { params: { since: range, search: query || undefined } });
      setData(res.data?.data || null);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load activity');
    }
  }, [overviewUrl, range, query]);

  usePolling(load, REFRESH_MS);

  const activeNow = data?.activeNow || [];
  const recent = data?.recent || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500/70 focus:outline-none"
          />
        </div>
        <div className="flex rounded-lg border border-white/10 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`rounded-md px-3 py-1.5 text-xs ${range === r.key ? 'bg-white/10 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-gray-600">Updates every 30 seconds</span>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {/* Active now */}
      <section className="rounded-2xl border border-white/10 bg-[#101722]/90 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <h2 className="text-sm font-semibold text-gray-100">Active now</h2>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">{activeNow.length}</span>
        </div>
        {!data ? (
          <div className="flex items-center py-6 text-sm text-gray-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</div>
        ) : activeNow.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-500">No {subjectLabel} are using SellerQI right now.</div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {activeNow.map((u) => (
              <button
                key={u.userId}
                type="button"
                onClick={() => setSelected(u)}
                className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2.5 text-left transition-colors hover:border-emerald-400/40"
              >
                <Initials name={u.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-100">{u.name}</div>
                  <div className="truncate text-xs text-gray-400">
                    {u.currentPage ? <>On <span className="text-gray-200">{u.currentPage.label}</span>{u.currentPage.seconds != null && ` · ${formatDuration(u.currentPage.seconds)}`}</> : 'Using SellerQI'}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 flex-none text-gray-600" />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Recently active */}
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#101722]/90">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Activity className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-100">Recently active</h2>
          <span className="text-xs text-gray-500">{recent.length}</span>
        </div>
        {data && recent.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">Nobody else was active in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-[#080c12]/90 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <th className="px-4 py-2.5">{subjectLabel === 'clients' ? 'Client' : 'Seller'}</th>
                  <th className="px-3 py-2.5">Brand</th>
                  <th className="px-3 py-2.5">Last active</th>
                  <th className="px-3 py-2.5">Last page</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {recent.map((u) => (
                  <tr key={u.userId} className="cursor-pointer hover:bg-white/[0.035]" onClick={() => setSelected(u)}>
                    <td className="px-4 py-2.5">
                      <div className="text-sm text-gray-100">{u.name}</div>
                      <div className="text-xs text-gray-500">{u.email}</div>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-400">{u.brand || '—'}</td>
                    <td className="px-3 py-2.5"><LastActiveBadge lastActiveAt={u.lastActiveAt} isActiveNow={false} now={now} /></td>
                    <td className="px-3 py-2.5 text-sm text-gray-400">{u.currentPage?.label || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-blue-300">View activity</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <UserActivityDrawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        timelineUrl={selected ? timelineUrlFor(selected.userId) : null}
        title={selected?.name}
      />
    </div>
  );
};

export default ActivityOverview;

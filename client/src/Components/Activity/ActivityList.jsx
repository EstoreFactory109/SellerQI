import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Clock, MousePointerClick, Eye, Activity, ChevronLeft, ChevronRight, Loader2, Info } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import { formatDuration, formatWhen, formatNumber, PERIODS } from './activityFormat.js';

export const StatTile = ({ icon: Icon, label, value, hint }) => (
  <div className="rounded-xl border border-white/10 bg-[#101722]/90 px-4 py-3">
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </div>
    <p className="mt-1 text-xl font-semibold tabular-nums text-gray-100">{value}</p>
    {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
  </div>
);

export const PeriodPicker = ({ days, onChange }) => (
  <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5" role="group" aria-label="Period">
    {PERIODS.map((value) => (
      <button
        key={value}
        type="button"
        onClick={() => onChange(value)}
        aria-pressed={days === value}
        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
          days === value ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        {value} days
      </button>
    ))}
  </div>
);

/**
 * Who uses the app, and how much — the list half of the User activity pages.
 * Shared by the super-admin page (every seller) and the ESF portal (ESF clients);
 * the server scopes the users by `apiBase`.
 */
const ActivityList = ({ apiBase, detailPath, emptyHint }) => {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    axiosInstance
      .get(apiBase, { params: { days, search: debouncedSearch || undefined, page, limit: 20 } })
      .then((res) => { if (alive) setData(res.data?.data || null); })
      .catch((err) => { if (alive) setError(err.response?.data?.message || 'Failed to load activity'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [apiBase, days, debouncedSearch, page]);

  const totals = data?.totals || {};
  const users = data?.users || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0 };

  return (
    <div className="relative min-h-full w-full bg-[#0b0f17] p-4 md:p-6">
      <div className="max-w-[1600px] w-full space-y-5">
        <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email…"
              className="w-full pl-8 pr-3 py-2.5 text-sm border border-white/10 bg-white/[0.04] text-gray-100 rounded-lg focus:outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10 placeholder-gray-500"
            />
          </div>
          <PeriodPicker days={days} onChange={(value) => { setDays(value); setPage(1); }} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatTile icon={Users} label="Active users" value={formatNumber(totals.activeUsers)} hint={`in the last ${days} days`} />
          <StatTile icon={Activity} label="Sessions" value={formatNumber(totals.sessions)} hint="visits, 30 min idle = new visit" />
          <StatTile icon={Clock} label="Active time" value={formatDuration(totals.activeSeconds)} hint="tab open and in use" />
          <StatTile icon={Eye} label="Page views" value={formatNumber(totals.pageViews)} />
          <StatTile icon={MousePointerClick} label="Actions" value={formatNumber(totals.actions)} hint="saves, deletes, exports…" />
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#101722]/90 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-white/10 bg-[#080c12]/90">
                  {['User', 'Last active', 'Sessions', 'Active days', 'Active time', 'Page views', 'Actions', 'Most used page'].map((label, index) => (
                    <th key={label} className={`px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider ${index === 0 || index === 7 ? 'text-left' : 'text-center'}`}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {loading ? (
                  <tr><td colSpan={8} className="py-16 text-center text-sm text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-blue-400" />Loading activity…
                  </td></tr>
                ) : error ? (
                  <tr><td colSpan={8} className="py-12 text-center text-sm text-red-300">{error}</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={8} className="py-14 text-center">
                    <p className="text-sm text-gray-300">No activity in the last {days} days{debouncedSearch ? ' for this search' : ''}.</p>
                    <p className="text-xs text-gray-500 mt-1">{emptyHint}</p>
                  </td></tr>
                ) : (
                  users.map((user) => (
                    <tr
                      key={user.userId}
                      onClick={() => navigate(detailPath(user.userId))}
                      className="cursor-pointer hover:bg-white/[0.035] transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        <p className="text-sm font-medium text-gray-100 break-words">{user.name}</p>
                        <p className="text-xs text-gray-500 break-all">{user.email}</p>
                        {user.memberSessions > 0 && (
                          <p className="text-[11px] text-blue-300 mt-0.5">{user.memberSessions} session{user.memberSessions === 1 ? '' : 's'} by members</p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-gray-300 whitespace-nowrap">{formatWhen(user.lastSeenAt)}</td>
                      <td className="px-3 py-2.5 text-center text-sm tabular-nums text-gray-200">{formatNumber(user.sessions)}</td>
                      <td className="px-3 py-2.5 text-center text-sm tabular-nums text-gray-200">{user.activeDays}</td>
                      <td className="px-3 py-2.5 text-center text-sm tabular-nums text-gray-200">{formatDuration(user.activeSeconds)}</td>
                      <td className="px-3 py-2.5 text-center text-sm tabular-nums text-gray-200">{formatNumber(user.pageViews)}</td>
                      <td className="px-3 py-2.5 text-center text-sm tabular-nums text-gray-200">{formatNumber(user.actions)}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-300">
                        {user.topPage ? `${user.topPage.label} (${user.topPage.views})` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 bg-[#080c12]/90">
              <p className="text-xs text-gray-500">{formatNumber(pagination.total)} users</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                  className="p-2 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] disabled:opacity-40" aria-label="Previous page">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-400 tabular-nums">{page} / {pagination.totalPages}</span>
                <button type="button" onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages}
                  className="p-2 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] disabled:opacity-40" aria-label="Next page">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="flex items-start gap-2 text-xs text-gray-500">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Only the account&apos;s own people are counted (the owner and their members). Admins or staff opening an
          account are not. Data is kept for 90 days. Click a user for the full breakdown.
        </p>
      </div>
    </div>
  );
};

export default ActivityList;

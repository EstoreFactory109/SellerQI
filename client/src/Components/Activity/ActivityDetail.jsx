import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ArrowLeft, Activity, Clock, Eye, MousePointerClick, CalendarDays, LogIn, Loader2, ChevronDown } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import { StatTile, PeriodPicker } from './ActivityList.jsx';
import { formatDuration, formatWhen, formatDate, formatNumber } from './activityFormat.js';

// Validated against the #101722 surface (dataviz validate_palette: all checks pass).
const BAR = '#3B82F6';

/** Every day in the window, oldest first, as YYYY-MM-DD in the viewer's zone. */
const daysInWindow = (count) => {
  const out = [];
  const today = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    out.push(day.toLocaleDateString('en-CA')); // en-CA formats as YYYY-MM-DD
  }
  return out;
};

const shortDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-gray-100 mb-1">{new Date(`${row.day}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
      <p className="text-gray-300">Active time: <span className="text-gray-100 font-medium">{formatDuration(row.activeSeconds)}</span></p>
      <p className="text-gray-400">Sessions: {row.sessions} · Pages: {row.pageViews} · Actions: {row.actions}</p>
    </div>
  );
};

const Card = ({ title, subtitle, children, right }) => (
  <div className="rounded-2xl border border-white/10 bg-[#101722]/90 overflow-hidden">
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
      <div>
        <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      {right}
    </div>
    {children}
  </div>
);

/**
 * One user's use of the app — the detail half of the User activity pages.
 * Shared by the super-admin and ESF portals; `apiBase` scopes it server-side.
 */
const ActivityDetail = ({ apiBase, backPath, backLabel }) => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openSession, setOpenSession] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    axiosInstance
      .get(`${apiBase}/${userId}`, { params: { days, tz } })
      .then((res) => { if (alive) setData(res.data?.data || null); })
      .catch((err) => { if (alive) setError(err.response?.data?.message || 'Failed to load activity'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [apiBase, userId, days]);

  const chartData = useMemo(() => {
    const byDay = new Map((data?.daily || []).map((row) => [row.day, row]));
    return daysInWindow(days).map((day) => {
      const row = byDay.get(day) || { sessions: 0, activeSeconds: 0, pageViews: 0, actions: 0 };
      return { day, label: shortDay(day), minutes: Math.round((row.activeSeconds / 60) * 10) / 10, ...row };
    });
  }, [data, days]);

  const totals = data?.totals || {};
  const maxPageViews = Math.max(1, ...(data?.pages || []).map((page) => page.views));

  return (
    <div className="relative min-h-full w-full bg-[#0b0f17] p-4 md:p-6">
      <div className="max-w-[1600px] w-full space-y-5">
        <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate(backPath)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-400 border border-white/10 hover:bg-white/[0.05] hover:text-gray-200 shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              {backLabel}
            </button>
            {data?.user && (
              <div className="min-w-0">
                <p className="text-base font-semibold text-gray-100 truncate">{data.user.name}</p>
                <p className="text-xs text-gray-500 truncate">
                  {data.user.email} · {data.user.packageType || '—'} · joined {formatDate(data.user.joinedAt)}
                </p>
              </div>
            )}
          </div>
          <PeriodPicker days={days} onChange={setDays} />
        </div>

        {loading ? (
          <div className="py-24 text-center text-sm text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-blue-400" />Loading activity…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <StatTile icon={Activity} label="Sessions" value={formatNumber(totals.sessions)}
                hint={totals.memberSessions ? `${totals.memberSessions} by members` : `last active ${formatWhen(totals.lastSeenAt)}`} />
              <StatTile icon={CalendarDays} label="Active days" value={`${totals.activeDays || 0} / ${data.days}`} />
              <StatTile icon={Clock} label="Active time" value={formatDuration(totals.activeSeconds)} />
              <StatTile icon={Eye} label="Page views" value={formatNumber(totals.pageViews)} />
              <StatTile icon={MousePointerClick} label="Actions" value={formatNumber(totals.actions)} />
              <StatTile icon={LogIn} label="Logins" value={formatNumber(totals.logins)} />
            </div>

            <Card title="Active time per day" subtitle={`Minutes the app was open and in use · ${data.timezone}`}>
              <div className="h-64 px-2 py-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }} barCategoryGap={days > 30 ? 1 : 2}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#6B7486', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
                    <YAxis tick={{ fill: '#6B7486', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} unit="m" width={44} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="minutes" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <Card title="Pages" subtitle="Where they spent their visits">
                {data.pages.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-gray-500">No pages visited in this period.</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase tracking-wider">
                        <th className="px-4 py-2 text-left font-semibold">Page</th>
                        <th className="px-4 py-2 text-right font-semibold">Views</th>
                        <th className="px-4 py-2 text-right font-semibold">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.pages.map((page) => (
                        <tr key={page.key}>
                          <td className="px-4 py-2">
                            <p className="text-sm text-gray-200">{page.label}</p>
                            <div className="mt-1 h-1 rounded-full bg-white/[0.06]">
                              <div className="h-1 rounded-full" style={{ width: `${(page.views / maxPageViews) * 100}%`, background: BAR }} />
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right text-sm tabular-nums text-gray-200">{formatNumber(page.views)}</td>
                          <td className="px-4 py-2 text-right text-sm tabular-nums text-gray-300">{formatDuration(page.seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Actions" subtitle="What they did: saves, deletes, exports, questions…">
                {data.actions.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-gray-500">No actions in this period.</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase tracking-wider">
                        <th className="px-4 py-2 text-left font-semibold">Action</th>
                        <th className="px-4 py-2 text-right font-semibold">Count</th>
                        <th className="px-4 py-2 text-right font-semibold">Last</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.actions.map((action) => (
                        <tr key={action.label}>
                          <td className="px-4 py-2 text-sm text-gray-200">{action.label}</td>
                          <td className="px-4 py-2 text-right text-sm tabular-nums text-gray-200">{formatNumber(action.count)}</td>
                          <td className="px-4 py-2 text-right text-xs text-gray-400 whitespace-nowrap">{formatWhen(action.lastAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>

            <Card title="Recent sessions" subtitle="Latest 20 visits — open one to see the pages in order">
              {data.sessions.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-500">No sessions in this period.</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {data.sessions.map((session) => {
                    const open = openSession === session.id;
                    return (
                      <div key={session.id}>
                        <button
                          type="button"
                          onClick={() => setOpenSession(open ? null : session.id)}
                          aria-expanded={open}
                          className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left hover:bg-white/[0.03]"
                        >
                          <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                          <span className="text-sm text-gray-200 min-w-[150px]">{formatWhen(session.startedAt)}</span>
                          <span className="text-xs text-gray-400">{session.by}</span>
                          <span className="text-xs text-gray-400 tabular-nums">{formatDuration(session.activeSeconds)} active</span>
                          <span className="text-xs text-gray-400 tabular-nums">{session.pageViews} pages</span>
                          <span className="text-xs text-gray-400 tabular-nums">{session.actions} actions</span>
                        </button>
                        {open && (
                          <ol className="px-12 pb-3 space-y-1">
                            {session.trail.length === 0 ? (
                              <li className="text-xs text-gray-500">No page details recorded.</li>
                            ) : session.trail.map((step, index) => (
                              <li key={index} className="flex items-center gap-3 text-xs">
                                <span className="text-gray-500 tabular-nums w-12 shrink-0">
                                  {new Date(step.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className={step.type === 'action' ? 'text-amber-300' : 'text-gray-300'}>
                                  {step.type === 'action' ? `↳ ${step.label}` : step.label}
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

export default ActivityDetail;

import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X as XIcon, Loader2, Eye, Clock, MousePointerClick, Users } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import LastActiveBadge from './LastActiveBadge.jsx';
import { useNow, usePolling } from './useNow.js';
import { formatDuration, formatPageTime, actorLabel, isStaffActor } from '../../utils/activityFormat.js';

/**
 * A seller's activity: status, time spent, and every sitting with the pages opened in it and
 * the time on each. Shared by the super admin and the ESF portal; `timelineUrl` decides whose
 * view it is (the server enforces who may read it). Refreshes every 30 s while open.
 */
const DAY_OPTIONS = [7, 30, 90];
const REFRESH_MS = 30 * 1000;

const dayHeading = (date) => {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

const clock = (date) => new Date(date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const Stat = ({ icon: Icon, label, value }) => (
  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gray-500">
      <Icon className="w-3.5 h-3.5" /> {label}
    </div>
    <div className="mt-1 text-base font-semibold text-gray-100 tabular-nums">{value}</div>
  </div>
);

const Sitting = ({ sitting }) => {
  const staff = isStaffActor(sitting.actor);
  const who = actorLabel(sitting.actor);
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${staff ? 'border-dashed border-white/10 bg-transparent' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-gray-200 tabular-nums">{clock(sitting.startedAt)} – {clock(sitting.endedAt)}</span>
        <span className="text-gray-500">· {formatPageTime(sitting.seconds)}</span>
        {who && (
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${staff ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20' : 'bg-blue-500/10 text-blue-300 border border-blue-500/20'}`}>
            {staff ? <Eye className="w-3 h-3" /> : <Users className="w-3 h-3" />} {who}
          </span>
        )}
      </div>
      <ol className="mt-2.5 space-y-1.5">
        {sitting.pages.map((page, i) => (
          <li key={`${page.startedAt}-${i}`} className="flex items-center gap-2.5 text-[13px]">
            <span className={`h-1.5 w-1.5 flex-none rounded-full ${staff ? 'bg-gray-600' : 'bg-blue-400'}`} />
            <span className={`truncate ${staff ? 'text-gray-400' : 'text-gray-200'}`} title={page.path}>{page.label}</span>
            <span className="ml-auto flex-none text-xs text-gray-500 tabular-nums">{clock(page.startedAt)} · {formatPageTime(page.seconds)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
};

const UserActivityDrawer = ({ open, onClose, timelineUrl, title }) => {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const now = useNow(10000);

  const load = useCallback(async () => {
    if (!timelineUrl) return;
    try {
      const res = await axiosInstance.get(timelineUrl, { params: { days } });
      setData(res.data?.data || null);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load activity');
    }
  }, [timelineUrl, days]);

  usePolling(load, REFRESH_MS, open && Boolean(timelineUrl));

  const byDay = useMemo(() => {
    const groups = [];
    for (const sitting of data?.sittings || []) {
      const heading = dayHeading(sitting.startedAt);
      const last = groups[groups.length - 1];
      if (last?.heading === heading) last.sittings.push(sitting);
      else groups.push({ heading, sittings: [sitting] });
    }
    return groups;
  }, [data]);

  if (!open) return null;

  const user = data?.user;
  const current = data?.sittings?.find((s) => !isStaffActor(s.actor))?.pages?.slice(-1)[0];

  return createPortal(
    <div className="fixed inset-0 z-[120] flex justify-end" role="dialog" aria-modal="true" aria-label="User activity">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[520px] overflow-y-auto border-l border-white/10 bg-[#0d131c] shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0d131c]/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Activity</div>
              <h2 className="mt-0.5 truncate text-lg font-semibold text-gray-100">{user?.name || title || '…'}</h2>
              {user?.email && <div className="truncate text-xs text-gray-500">{user.email}</div>}
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-white/[0.06] hover:text-gray-200" aria-label="Close">
              <XIcon className="w-5 h-5" />
            </button>
          </div>
          {data && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <LastActiveBadge lastActiveAt={user?.lastActiveAt} isActiveNow={data.isActiveNow} now={now} />
              {data.isActiveNow && current && (
                <span className="text-gray-400">on <span className="text-gray-200">{current.label}</span></span>
              )}
              {!data.isActiveNow && user?.lastActiveAt && <span className="text-gray-500">last active</span>}
            </div>
          )}
        </div>

        <div className="px-5 py-4">
          {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
          {!data && !error && (
            <div className="flex items-center justify-center py-16 text-sm text-gray-400">
              <Loader2 className="mr-2 w-4 h-4 animate-spin" /> Loading activity…
            </div>
          )}

          {data && (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <Stat icon={Clock} label="Last 24 hours" value={formatDuration(data.totals.last24hSeconds)} />
                <Stat icon={MousePointerClick} label="Last 7 days" value={formatDuration(data.totals.last7dSeconds)} />
              </div>

              <div className="mt-5 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-200">Pages viewed</h3>
                <div className="flex rounded-lg border border-white/10 p-0.5">
                  {DAY_OPTIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => { setDays(d); setData(null); }}
                      className={`rounded-md px-2.5 py-1 text-xs ${days === d ? 'bg-white/10 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      {d} days
                    </button>
                  ))}
                </div>
              </div>

              {byDay.length === 0 ? (
                <div className="mt-6 rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-gray-500">
                  No pages viewed in the last {days} days.
                </div>
              ) : (
                <div className="mt-3 space-y-5">
                  {byDay.map((group) => (
                    <section key={group.heading}>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{group.heading}</div>
                      <div className="space-y-2">
                        {group.sittings.map((s) => <Sitting key={`${s.activityId}-${s.actor.kind}`} sitting={s} />)}
                      </div>
                    </section>
                  ))}
                </div>
              )}
              <p className="mt-6 text-[11px] leading-4 text-gray-600">
                Time counts only while the page is open and the person is using it. Visits by staff are shown
                dashed and never count as the seller being active. History is kept for 90 days.
              </p>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
};

export default UserActivityDrawer;

/**
 * Formatting for activity monitoring.
 *
 * Separate from dateUtils.formatTimeAgo on purpose: that one deliberately stops at minutes/hours
 * for logs; "last active" needs seconds for someone who just left and days for someone who left
 * last week.
 */

/** "12s ago", "5m ago", "3h ago", "2d ago"; null for nothing. */
export const formatLastActive = (value, now = Date.now()) => {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/** Time spent: "45s", "3m 20s", "1h 05m". */
export const formatDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

/** Time on one page: like formatDuration, but "<5s" for a glance rather than a misleading "0s". */
export const formatPageTime = (seconds) => (Math.round(Number(seconds) || 0) < 5 ? '<5s' : formatDuration(seconds));

/** Who made a visit, for staff and member entries. */
export const actorLabel = (actor) => {
  switch (actor?.kind) {
    case 'super_admin': return `Viewed by super admin${actor.name ? ` · ${actor.name}` : ''}`;
    case 'esf_staff': return `Viewed by ESF staff${actor.name ? ` · ${actor.name}` : ''}`;
    case 'agency': return `Viewed by agency${actor.name ? ` · ${actor.name}` : ''}`;
    case 'member': return `Team member${actor.name ? ` · ${actor.name}` : ''}`;
    default: return null;
  }
};

export const isStaffActor = (actor) => ['super_admin', 'esf_staff', 'agency'].includes(actor?.kind);

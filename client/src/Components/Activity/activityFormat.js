/** Shared formatting for the User activity pages. */

/** 4523 -> "1h 15m", 95 -> "1m 35s", 40 -> "40s", 0 -> "0m". */
export const formatDuration = (seconds = 0) => {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return s && m < 10 ? `${m}m ${s}s` : `${m}m`;
  return total ? `${s}s` : '0m';
};

/** "Just now", "12 min ago", "3 h ago", else "8 Oct 2026, 14:05". */
export const formatWhen = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffMin < 24 * 60) return `${Math.floor(diffMin / 60)} h ago`;
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const formatNumber = (value = 0) => Number(value || 0).toLocaleString('en-US');

export const PERIODS = [7, 30, 90];

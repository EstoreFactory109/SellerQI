import React from 'react';
import { formatLastActive } from '../../utils/activityFormat.js';

/**
 * "Active now" (green, pulsing) / "Active 5m ago" / "Never".
 * Used in the Manage Accounts and ESF Clients tables and the activity pages.
 */
const LastActiveBadge = ({ lastActiveAt, isActiveNow, now }) => {
  if (isActiveNow) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 whitespace-nowrap">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        Active now
      </span>
    );
  }
  const ago = formatLastActive(lastActiveAt, now);
  if (!ago) return <span className="text-xs text-gray-600 whitespace-nowrap">Never</span>;
  return (
    <span className="text-xs text-gray-400 whitespace-nowrap" title={new Date(lastActiveAt).toLocaleString()}>
      {ago}
    </span>
  );
};

export default LastActiveBadge;

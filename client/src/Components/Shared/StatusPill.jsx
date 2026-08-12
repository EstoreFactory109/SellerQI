import React from 'react';
import { STATUS, getStatusConfig } from './tokens.js';

// Component 1.2 — the three-tier status chip (Good/Watch/Fix/Set up).
// Color is never the only signal: word + icon always ride along.
const StatusPill = ({ status = STATUS.SETUP, label, compact = false }) => {
  const config = getStatusConfig(status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-bold uppercase tracking-wide whitespace-nowrap ${
        compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
      }`}
      style={{ backgroundColor: config.bg, color: config.color }}
    >
      <span aria-hidden="true">{config.icon}</span>
      {label || config.label}
    </span>
  );
};

export default StatusPill;

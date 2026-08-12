import React from 'react';
import StatusPill from './StatusPill.jsx';
import { COLORS, getStatusConfig } from './tokens.js';

// Component 2.5 — Verdict Banner: the single most important takeaway at the
// top of a data-heavy page, color-coded to the overall status, with one CTA.
const VerdictBanner = ({ status, eyebrow = "Today's verdict", children, actionLabel, onAction }) => {
  const config = getStatusConfig(status);

  return (
    <section
      className="relative overflow-hidden rounded-[14px] flex items-center gap-6 p-5"
      style={{
        border: `1px solid ${config.color}47`,
        background: `linear-gradient(90deg, ${config.color}1A, ${config.color}05 55%, transparent)`,
      }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: config.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-[7px]">
          <StatusPill status={status} />
          <span className="text-xs" style={{ color: COLORS.textMuted }}>{eyebrow}</span>
        </div>
        <p className="m-0 text-[19px] leading-7 font-medium tracking-[-0.01em]" style={{ color: COLORS.textPrimary }}>
          {children}
        </p>
      </div>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="flex-none px-[18px] py-[11px] rounded-[9px] text-sm font-semibold"
          style={{ background: config.color, color: '#16120A' }}
        >
          {actionLabel}
        </button>
      )}
    </section>
  );
};

export default VerdictBanner;

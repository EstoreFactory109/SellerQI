import React from 'react';
import { COLORS, getStatusConfig } from './tokens.js';

// Component 2.3 — Action Card ("thing to fix"). One row in the "Top Things to
// Fix" list: severity stripe, plain-English title + category badge, why-it-
// matters line, the impact figure (dollar or count), and a single CTA.
// No effort chip — the app has no real per-issue effort estimate to show yet.
const ActionCard = ({ rank, status, title, badge, why, value, valueLabel, ctaLabel, onCta, onLater }) => {
  const color = getStatusConfig(status).color;

  return (
    <div className="flex border-b" style={{ borderColor: COLORS.border }}>
      <div className="w-[3px] flex-none" style={{ background: color }} />
      <div className="flex-1 min-w-0 flex items-center gap-5 px-6 py-5 flex-wrap">
        <div className="flex-none w-6 text-sm font-bold tabular-nums" style={{ color: COLORS.textMuted }}>
          {String(rank).padStart(2, '0')}
        </div>

        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-base font-semibold" style={{ color: COLORS.textPrimary }}>{title}</span>
            {badge && (
              <span
                className="px-2 py-0.5 rounded text-xs font-semibold"
                style={{ background: COLORS.surfaceElevated, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}
              >
                {badge}
              </span>
            )}
          </div>
          {why && <div className="text-sm" style={{ color: COLORS.textSecondary }}>{why}</div>}
        </div>

        <div className="flex-none text-right min-w-[110px]">
          <div className="text-lg font-bold tabular-nums" style={{ color }}>{value}</div>
          {valueLabel && <div className="text-xs" style={{ color: COLORS.textMuted }}>{valueLabel}</div>}
        </div>

        <div className="flex-none flex items-center gap-2">
          {onLater && (
            <button
              type="button"
              onClick={onLater}
              className="px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
              style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
            >
              Later
            </button>
          )}
          <button
            type="button"
            onClick={onCta}
            className="px-3.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors"
            style={{ background: COLORS.accent, color: '#061021' }}
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActionCard;

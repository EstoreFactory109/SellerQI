import React from 'react';
import { COLORS, getStatusConfig } from './tokens.js';

// Component 2.3 — Action Card ("thing to fix"). One row in the "Top Things to
// Fix" list: severity stripe, plain-English title + category badge, why-it-
// matters line, the impact figure (dollar or count), and a single CTA.
// No effort chip — the app has no real per-issue effort estimate to show yet.
// Fixed column widths so every row lines up identically regardless of how long
// its title, dollar value, or CTA label happens to be — a "$43.81" row and a
// "1 issues open" row must still put their buttons at the exact same x position.
const RANK_COL_WIDTH = 'w-8';
const VALUE_COL_WIDTH = 'w-[132px]';
const LATER_BTN_WIDTH = 'w-[64px]';
const CTA_BTN_WIDTH = 'w-[164px]';

const ActionCard = ({ rank, status, title, badge, why, value, valueLabel, ctaLabel, onCta, onLater }) => {
  const color = getStatusConfig(status).color;

  return (
    <div className="flex border-b" style={{ borderColor: COLORS.border }}>
      <div className="w-[3px] flex-none" style={{ background: color }} />
      <div className="flex-1 min-w-0 flex flex-nowrap items-center gap-5 px-6 py-5">
        <div className={`flex-none ${RANK_COL_WIDTH} text-sm font-bold tabular-nums self-start pt-1`} style={{ color: COLORS.textMuted }}>
          {String(rank).padStart(2, '0')}
        </div>

        <div className="flex-1 min-w-0 py-1">
          <div className="flex items-start gap-2 mb-1 flex-wrap">
            <span className="text-base font-semibold" style={{ color: COLORS.textPrimary }}>{title}</span>
            {badge && (
              <span
                className="flex-none px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap"
                style={{ background: COLORS.surfaceElevated, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}
              >
                {badge}
              </span>
            )}
          </div>
          {/* Full error detail, never truncated — wraps and grows the row's height instead. */}
          {why && <div className="text-sm" style={{ color: COLORS.textSecondary }}>{why}</div>}
        </div>

        <div className={`flex-none ${VALUE_COL_WIDTH} text-right self-start pt-1`}>
          <div className="text-lg font-bold tabular-nums truncate" style={{ color }}>{value}</div>
          {valueLabel && <div className="text-xs truncate" style={{ color: COLORS.textMuted }}>{valueLabel}</div>}
        </div>

        <div className="flex-none flex items-center justify-end gap-2 self-start pt-1">
          {onLater && (
            <button
              type="button"
              onClick={onLater}
              className={`${LATER_BTN_WIDTH} flex-none px-2 py-1.5 rounded-md text-xs font-medium border text-center transition-colors`}
              style={{ borderColor: COLORS.border, color: COLORS.textMuted }}
            >
              Later
            </button>
          )}
          <button
            type="button"
            onClick={onCta}
            className={`${CTA_BTN_WIDTH} flex-none px-2 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap text-center truncate transition-colors`}
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

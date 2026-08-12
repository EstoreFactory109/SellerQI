import React from 'react';
import InfoTooltip from './InfoTooltip.jsx';
import StatusPill from './StatusPill.jsx';
import BenchmarkBar from './BenchmarkBar.jsx';
import { COLORS, STATUS } from './tokens.js';

const SkeletonLine = ({ width = '100%', height = 12 }) => (
  <div className="rounded animate-pulse" style={{ width, height, background: COLORS.border }} />
);

// Component 2.1 — the KPI Card. Anatomy: label + plain meaning + info icon,
// big value, status pill, benchmark line, footnote (trend / money impact).
// Handles all three required states: value present, no-data ("Set up"),
// and loading — plus a compact variant (label + value + pill only).
const KPICard = ({
  label,
  meaning,
  tooltip,
  value,
  secondaryValue,
  status,
  statusLabel,
  benchmark,
  footnote,
  compact = false,
  loading = false,
  noData,
  onClick,
  className = '',
}) => {
  const clickable = typeof onClick === 'function';

  const baseClasses = `rounded-[13px] border flex flex-col transition-colors ${
    compact ? 'p-3 gap-2' : 'p-[17px] gap-[11px]'
  } ${clickable ? 'cursor-pointer' : ''} ${className}`;
  const baseStyle = { background: COLORS.surface, borderColor: COLORS.border };

  if (loading) {
    return (
      <div className={baseClasses} style={baseStyle} aria-busy="true">
        <SkeletonLine width="60%" height={11} />
        <SkeletonLine width="45%" height={compact ? 20 : 28} />
        {!compact && <SkeletonLine width="35%" height={18} />}
      </div>
    );
  }

  return (
    <div
      className={baseClasses}
      style={baseStyle}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(e);
              }
            }
          : undefined
      }
    >
      <div className="flex items-start gap-1.5 min-h-[34px]">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLORS.textSecondary }}>
            {label}
          </div>
          {meaning && (
            <div className="text-xs mt-0.5" style={{ color: COLORS.textMuted }}>
              {meaning}
            </div>
          )}
        </div>
        {tooltip && (
          <div className="ml-auto">
            <InfoTooltip text={tooltip} position="right" />
          </div>
        )}
      </div>

      {noData ? (
        <>
          <StatusPill status={STATUS.SETUP} label={statusLabel} compact={compact} />
          {noData.message && (
            <div className="text-xs" style={{ color: COLORS.textSecondary }}>
              {noData.message}
            </div>
          )}
          {noData.actionLabel && (
            <a
              href={noData.href || '#'}
              onClick={noData.onAction}
              className="text-xs font-semibold"
              style={{ color: COLORS.accent }}
            >
              {noData.actionLabel} →
            </a>
          )}
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <div
              className={`font-bold tracking-tight tabular-nums ${compact ? 'text-xl' : 'text-[30px] leading-9'}`}
              style={{ color: COLORS.textPrimary }}
            >
              {value}
            </div>
            {secondaryValue && (
              <div className="text-sm font-medium" style={{ color: COLORS.textSecondary }}>
                {secondaryValue}
              </div>
            )}
          </div>

          {status && <StatusPill status={status} label={statusLabel} compact={compact} />}

          {!compact && benchmark && <BenchmarkBar status={status} {...benchmark} />}

          {!compact && footnote && (
            <>
              <div className="h-px" style={{ background: COLORS.border }} />
              <div className="text-xs" style={{ color: COLORS.textMuted }}>
                {footnote}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default KPICard;

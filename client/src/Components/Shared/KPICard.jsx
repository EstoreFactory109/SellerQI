import React from 'react';
import InfoTooltip from './InfoTooltip.jsx';
import StatusPill from './StatusPill.jsx';
import BenchmarkBar from './BenchmarkBar.jsx';
import { COLORS, STATUS, getStatusConfig } from './tokens.js';

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
  // Opt-in: tints the border to the status color for Fix/Watch (mock does this only on
  // the Your Products tiles, not the Dashboard KPI cards, so it defaults off).
  tintBorder = false,
}) => {
  const clickable = typeof onClick === 'function';

  const baseClasses = `rounded-2xl border flex flex-col transition-colors ${
    compact ? 'px-4 py-3 gap-2' : 'p-5 gap-2.5'
  } ${clickable ? 'cursor-pointer' : ''} ${className}`;
  const borderColor = tintBorder && (status === STATUS.FIX || status === STATUS.WATCH)
    ? `${getStatusConfig(status).color}38`
    : COLORS.border;
  const baseStyle = { background: COLORS.surface, borderColor };

  if (loading) {
    return (
      <div className={baseClasses} style={baseStyle} aria-busy="true">
        <SkeletonLine width="60%" height={13} />
        <SkeletonLine width="45%" height={compact ? 26 : 38} />
        {!compact && <SkeletonLine width="35%" height={20} />}
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
      <div className={`flex items-start gap-2 ${compact ? '' : 'min-h-[32px]'}`}>
        <div>
          <div className={`${compact ? 'text-[11px]' : 'text-sm'} font-semibold uppercase tracking-wide`} style={{ color: COLORS.textSecondary }}>
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
            <div className="text-sm" style={{ color: COLORS.textSecondary }}>
              {noData.message}
            </div>
          )}
          {noData.actionLabel && (
            <a
              href={noData.href || '#'}
              onClick={noData.onAction}
              className="text-sm font-semibold"
              style={{ color: COLORS.accent }}
            >
              {noData.actionLabel} →
            </a>
          )}
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <div
              className={`font-bold tracking-tight tabular-nums ${compact ? 'text-2xl' : 'text-[32px] leading-[38px]'}`}
              style={{ color: COLORS.textPrimary }}
            >
              {value}
            </div>
            {secondaryValue && (
              <div className="text-base font-medium" style={{ color: COLORS.textSecondary }}>
                {secondaryValue}
              </div>
            )}
            {/* Compact tiles (e.g. Your Products) put the pill beside the number, mock-style */}
            {compact && status && <StatusPill status={status} label={statusLabel} compact />}
          </div>

          {!compact && status && <StatusPill status={status} label={statusLabel} />}

          {!compact && benchmark && <BenchmarkBar status={status} {...benchmark} />}

          {!compact && footnote && (
            <>
              <div className="h-px" style={{ background: COLORS.border }} />
              <div className="text-sm" style={{ color: COLORS.textMuted }}>
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

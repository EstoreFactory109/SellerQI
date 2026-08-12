import React from 'react';
import { COLORS, getStatusConfig } from './tokens.js';

// Component 2.2 (compact variant) — circular health gauge: big % in the
// center, one-word status beneath, colored to the current status tier.
const HealthGauge = ({ percentage = 0, status, size = 92, trackSize = 72 }) => {
  const config = getStatusConfig(status);
  const turn = Math.max(0, Math.min(100, percentage)) / 100;

  return (
    <div
      className="relative grid place-items-center rounded-full flex-none"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${config.color} 0turn ${turn}turn, ${COLORS.border} ${turn}turn 1turn)`,
      }}
    >
      <div
        className="rounded-full grid place-items-center"
        style={{ width: trackSize, height: trackSize, background: COLORS.surface }}
      >
        <div className="text-[22px] font-bold tracking-tight leading-6" style={{ color: COLORS.textPrimary }}>
          {Math.round(percentage)}
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: config.color }}>
          {config.label}
        </div>
      </div>
    </div>
  );
};

export default HealthGauge;

import React from 'react';
import { COLORS, getStatusConfig } from './tokens.js';

// Part of Component 2.1 (KPI Card) — "Healthy: under 25% · You: 19%" line
// with a tiny inline bar showing where the user sits vs. the healthy range.
const BenchmarkBar = ({ healthyText, valueText, rangeStart = 0, rangeEnd, markerPosition, status }) => {
  const markerColor = getStatusConfig(status).color;

  return (
    <div>
      {(healthyText || valueText) && (
        <div className="flex items-center justify-between text-xs mb-[5px]" style={{ color: COLORS.textSecondary }}>
          {healthyText && <span>{healthyText}</span>}
          {valueText && <span style={{ color: markerColor }}>{valueText}</span>}
        </div>
      )}
      <div className="relative h-[5px] rounded-full overflow-hidden" style={{ background: COLORS.border }}>
        {rangeEnd != null && (
          <div
            className="absolute top-0 bottom-0 rounded-full"
            style={{
              left: `${rangeStart}%`,
              width: `${Math.max(0, rangeEnd - rangeStart)}%`,
              background: 'rgba(34,197,94,0.35)',
            }}
          />
        )}
        {markerPosition != null && (
          <div
            className="absolute -top-[2px] w-[3px] h-[9px] rounded-sm"
            style={{ left: `${markerPosition}%`, background: markerColor }}
          />
        )}
      </div>
    </div>
  );
};

export default BenchmarkBar;

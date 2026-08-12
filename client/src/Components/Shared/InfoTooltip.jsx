import React, { useState } from 'react';
import { COLORS } from './tokens.js';

// Component 2.6 — consistent "?" info affordance. Reachable by hover AND
// keyboard focus (not hover-only), per the accessibility requirement (1.9).
const InfoTooltip = ({ text, position = 'right' }) => {
  const [open, setOpen] = useState(false);

  if (!text) return null;

  const alignClass = position === 'left' ? 'right-0' : 'left-0';

  return (
    <span className="relative inline-flex flex-none">
      <button
        type="button"
        aria-label="More information"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="grid place-items-center w-4 h-4 rounded-full border text-[10px] leading-none cursor-help bg-transparent"
        style={{ borderColor: COLORS.borderStrong, color: COLORS.textMuted }}
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          className={`absolute top-5 z-40 w-60 rounded-[10px] p-2.5 text-xs leading-[18px] shadow-xl pointer-events-none ${alignClass}`}
          style={{ background: COLORS.surfaceElevated, border: `1px solid ${COLORS.borderStrong}`, color: '#E2E7F0' }}
        >
          {text}
        </div>
      )}
    </span>
  );
};

export default InfoTooltip;

import React from 'react';

/**
 * Renders follow-up suggestions as clickable chips.
 *
 * Each follow-up can be a legacy string ("Show me X") or a structured
 * { label, prompt } object emitted by FollowUpGenerator. We display `label`
 * and send `prompt` on click — both collapse to the same string for plain
 * entries.
 *
 * Presentational only — receives data and an `onSelect` callback via props.
 * It does not call axios, manage chat state, or import global state.
 *
 * Markup/styling is the exact Tailwind used inline in QMate.jsx before this
 * extraction, so rendering is unchanged.
 */
export default function FollowUpChips({ followUps, onSelect, disabled }) {
  if (!followUps || followUps.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold text-gray-400 mb-1">
        You can ask:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {followUps.map((item, idx) => {
          const isStructured = item && typeof item === 'object' && typeof item.label === 'string';
          const label = isStructured ? item.label : String(item || '');
          const prompt = isStructured ? (item.prompt || item.label) : String(item || '');
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelect(prompt)}
              disabled={disabled}
              className="text-[11px] px-2 py-1 rounded-full bg-[#161b22] border border-[#30363d] hover:border-blue-500/60 text-gray-300 hover:text-white transition-colors"
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import React from 'react';

/**
 * Renders structured clarification options as clickable buttons.
 * Falls back to rendering old-format string questions as clickable chips.
 *
 * Presentational only — receives data and an `onSelectOption` callback via
 * props. It does not call axios, manage chat state, or import global state.
 *
 * Markup/styling is the exact Tailwind used inline in QMate.jsx before this
 * extraction, so rendering is unchanged.
 */
export default function ClarificationCard({
  clarificationOptions,
  clarifyingQuestions,
  onSelectOption,
  disabled,
}) {
  // Prefer new structured options (each entry is { id, label, resolved_prompt }).
  if (clarificationOptions && clarificationOptions.length > 0) {
    return (
      <div className="mt-3">
        <p className="text-[11px] font-semibold text-amber-400/90 mb-1.5">
          I need a bit more detail to give you the best answer:
        </p>
        <div className="flex flex-col gap-1.5">
          {clarificationOptions.map((option, idx) => (
            <button
              key={option.id || idx}
              type="button"
              onClick={() => onSelectOption(option.resolved_prompt || option.label)}
              disabled={disabled}
              className="text-left text-[12px] px-3 py-2 rounded-lg bg-[#161b22] border border-amber-500/40 hover:border-amber-400/70 hover:bg-[#1a2028] text-gray-200 hover:text-white transition-colors flex items-center gap-2"
            >
              <span className="flex-1 leading-snug">{option.label}</span>
              {option.needs_followup && (
                <span className="text-[10px] text-amber-400/70 shrink-0">needs detail</span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Fallback: old string-based clarifying_questions rendered as clickable chips.
  if (clarifyingQuestions && clarifyingQuestions.length > 0) {
    return (
      <div className="mt-3">
        <p className="text-[11px] font-semibold text-amber-400/90 mb-1">
          Please choose one so I can help:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {clarifyingQuestions.map((q, idx) => {
            // Strip "Option N:" prefix if present for the button label.
            const labelMatch = typeof q === 'string' && q.match(/^Option\s*\d+[:\s]*(.*)/i);
            const label = labelMatch ? labelMatch[1] : q;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectOption(q)}
                disabled={disabled}
                className="text-[11px] px-2 py-1 rounded-full bg-[#161b22] border border-amber-500/40 hover:border-amber-400/70 text-gray-300 hover:text-white transition-colors"
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}

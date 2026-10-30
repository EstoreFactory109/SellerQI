import React from 'react';
import { COLORS } from '../Shared/index.js';
import { fieldStyle } from '../Actions/Dialog.jsx';

const MATCH = [['EXACT', 'Exact'], ['PHRASE', 'Phrase'], ['BROAD', 'Broad']];

/** Turns "one keyword per line" text into keyword rows (duplicates removed). */
export function parseKeywordLines(text, matchType, bid) {
  const seen = new Set();
  return String(text || '').split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean)
    .filter((k) => { const key = `${k.toLowerCase()}|${matchType}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .map((keywordText) => ({ keywordText, matchType, bid: bid === '' ? undefined : Number(bid) }));
}

/**
 * Keywords as typed text plus a match type and bid for all of them, with Amazon's
 * suggestions (when there are any) to tick.
 */
const KeywordListEditor = ({ idPrefix, text, onText, matchType, onMatchType, bid, onBid, suggestions = [], picked = [], onPick }) => (
  <div className="flex flex-col gap-3">
    {suggestions.length > 0 && (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: COLORS.textSecondary }}>Amazon's suggestions for this product</span>
        <div className="max-h-48 overflow-y-auto rounded-lg border p-2 flex flex-col gap-1" style={{ borderColor: COLORS.border }}>
          {suggestions.map((s) => {
            const id = `${idPrefix}-sug-${s.keywordText}`;
            const on = picked.includes(s.keywordText);
            return (
              <label key={s.keywordText} htmlFor={id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: COLORS.textPrimary }}>
                <input id={id} type="checkbox" checked={on} onChange={() => onPick?.(s.keywordText)} />
                <span className="flex-1 min-w-0 truncate">{s.keywordText}</span>
                {s.suggestedBid ? <span className="text-xs" style={{ color: COLORS.textMuted }}>suggested bid {Number(s.suggestedBid).toFixed(2)}</span> : null}
              </label>
            );
          })}
        </div>
      </div>
    )}
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${idPrefix}-text`} className="text-xs font-semibold" style={{ color: COLORS.textSecondary }}>Your own keywords, one per line</label>
      <textarea id={`${idPrefix}-text`} rows={5} value={text} onChange={(e) => onText(e.target.value)} className="w-full rounded-lg border p-2.5 text-sm" style={fieldStyle} />
    </div>
    <div className="flex flex-wrap gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-match`} className="text-xs font-semibold" style={{ color: COLORS.textSecondary }}>Match type</label>
        <select id={`${idPrefix}-match`} value={matchType} onChange={(e) => onMatchType(e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
          {MATCH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-bid`} className="text-xs font-semibold" style={{ color: COLORS.textSecondary }}>Bid (blank = default bid)</label>
        <input id={`${idPrefix}-bid`} type="number" min="0" step="0.01" value={bid} onChange={(e) => onBid(e.target.value)} className="w-36 rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} />
      </div>
    </div>
  </div>
);

export default KeywordListEditor;

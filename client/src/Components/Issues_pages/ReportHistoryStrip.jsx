import React from 'react';
import { COLORS, STATUS, getStatusConfig } from '../Shared/index.js';

const formatDay = (iso) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * One dot per daily Amazon report (oldest left, newest right): coloured on the days
 * Amazon reported a problem. Shows why a metric is "Unstable" rather than failing —
 * see checkAccountHealth's `days` / `badDays`.
 *
 * @param {{ days: string[], badDays: string[], tone: 'fix'|'watch' }} props
 */
const ReportHistoryStrip = ({ days = [], badDays = [], tone = STATUS.FIX }) => {
    if (!Array.isArray(days) || days.length < 2) return null;
    const bad = new Set(badDays);
    const ordered = [...days].sort();
    const badColor = getStatusConfig(tone).color;
    const goodColor = getStatusConfig(STATUS.GOOD).color;

    return (
        <div className="mt-2.5 flex items-center gap-2 flex-wrap" data-testid="report-history-strip">
            <span className="text-[11px]" style={{ color: COLORS.textMuted }}>
                Last {ordered.length} daily reports
            </span>
            <span className="flex items-center gap-1" role="list" aria-label="Daily report history">
                {ordered.map((day) => {
                    const isBad = bad.has(day);
                    return (
                        <span
                            key={day}
                            role="listitem"
                            title={`${formatDay(day)}: ${isBad ? 'problem reported' : 'good'}`}
                            aria-label={`${formatDay(day)}: ${isBad ? 'problem reported' : 'good'}`}
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ background: isBad ? badColor : goodColor, opacity: isBad ? 1 : 0.45 }}
                        />
                    );
                })}
            </span>
        </div>
    );
};

export default ReportHistoryStrip;

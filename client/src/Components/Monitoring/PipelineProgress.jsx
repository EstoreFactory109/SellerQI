/**
 * Pipeline progress — stage dots for the daily / integration data fetch.
 *
 * Deliberately SELF-CONTAINED (no shared design-system imports): the newer Components/Shared
 * primitives live only on the sqi-nui branch, not on main, so importing them would make this
 * undeployable. Colours mirror UserLogging.jsx's getStatusColor so it sits natively on that page,
 * and can be swapped for StatusPill once that branch merges.
 *
 * DESIGN NOTE — why every stage shows elapsed time.
 * A bar reading "7 of 8" is actively misleading here: a single stage legitimately runs for hours
 * (calc_review reached 23.8h in production). Position alone would imply "nearly done" while eight
 * hours of work remain, so elapsed time per stage is the primary signal and position is secondary.
 */

import React from 'react';
import { CheckCircle, AlertCircle, Loader2, Clock, AlertTriangle } from 'lucide-react';

/** Matches UserLogging.jsx's palette so the widget doesn't look foreign on its host page. */
const STATE_STYLE = {
    completed: { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.2)',  border: 'rgba(34, 197, 94, 0.35)' },
    failed:    { color: '#f87171', bg: 'rgba(239, 68, 68, 0.2)',  border: 'rgba(239, 68, 68, 0.35)' },
    stalled:   { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.2)', border: 'rgba(251, 191, 36, 0.35)' },
    running:   { color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.2)', border: 'rgba(96, 165, 250, 0.35)' },
    pending:   { color: '#9ca3af', bg: 'rgba(156, 163, 175, 0.15)', border: 'rgba(156, 163, 175, 0.3)' },
};

const STATE_ICON = {
    completed: CheckCircle,
    failed: AlertCircle,
    stalled: AlertTriangle,
    running: Loader2,
    pending: Clock,
};

/** Compact duration: minutes under an hour, then h/m. Long runs are the norm here. */
export function formatElapsed(ms) {
    if (ms == null) return null;
    const mins = Math.round(ms / 60000);
    if (mins < 1) return '<1m';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
}

function agoLabel(iso) {
    if (!iso) return null;
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    return `${formatElapsed(mins * 60000)} ago`;
}

/** Short label — the raw phase minus its pipeline prefix. Internal tool: real names, not euphemisms. */
function shortPhase(phase) {
    return String(phase || '').replace(/^sched_/, '');
}

function StageDot({ stage, isLast }) {
    const style = STATE_STYLE[stage.state] || STATE_STYLE.pending;
    const Icon = STATE_ICON[stage.state] || Clock;
    const elapsed = formatElapsed(stage.elapsedMs);

    return (
        <div className="flex-1 min-w-0 flex flex-col items-center relative">
            {/* Connector sits behind the dot; the last stage has nothing to connect to. */}
            {!isLast && (
                <div
                    className="absolute top-[14px] left-1/2 w-full h-[2px] -z-0"
                    style={{ backgroundColor: stage.state === 'completed' ? STATE_STYLE.completed.color : 'rgba(156,163,175,0.25)' }}
                />
            )}
            <div
                className="relative z-10 w-7 h-7 rounded-full flex items-center justify-center border"
                style={{ backgroundColor: style.bg, borderColor: style.border }}
                title={`${stage.phase} — ${stage.label}`}
            >
                <Icon
                    className={`w-3.5 h-3.5 ${stage.state === 'running' ? 'animate-spin' : ''} ${stage.state === 'stalled' ? 'animate-pulse' : ''}`}
                    style={{ color: style.color }}
                />
            </div>
            <div className="mt-1.5 text-center px-0.5 w-full">
                <div className="text-[10px] font-medium truncate" style={{ color: style.color }}>
                    {shortPhase(stage.phase)}
                </div>
                {/* Elapsed is the point — see the design note at the top of this file. */}
                {elapsed && <div className="text-[10px] text-gray-400 tabular-nums">{elapsed}</div>}
                {stage.pollCount > 0 && (
                    <div className="text-[9px] text-gray-500">{stage.pollCount} poll{stage.pollCount === 1 ? '' : 's'}</div>
                )}
            </div>
        </div>
    );
}

export default function PipelineProgress({ data, loading, error, onRefresh }) {
    if (loading && !data) {
        return (
            <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 text-sm text-gray-400">
                Loading pipeline progress…
            </div>
        );
    }
    if (error) {
        return (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                Could not load pipeline progress: {error}
            </div>
        );
    }
    if (!data || !Array.isArray(data.stages) || data.stages.length === 0) return null;

    const { stages, currentStage, completedCount, totalCount, overallStatus, runStartedAt, dataRange } = data;
    const active = stages.find((s) => s.phase === currentStage);
    const stalled = stages.some((s) => s.state === 'stalled');
    const failed = stages.filter((s) => s.state === 'failed');
    const pct = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

    return (
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-gray-100">Pipeline progress</h3>
                        {overallStatus && (
                            <span
                                className="text-[10px] px-1.5 py-0.5 rounded border"
                                style={{
                                    color: (STATE_STYLE[overallStatus] || STATE_STYLE.pending).color,
                                    backgroundColor: (STATE_STYLE[overallStatus] || STATE_STYLE.pending).bg,
                                    borderColor: (STATE_STYLE[overallStatus] || STATE_STYLE.pending).border,
                                }}
                            >
                                {overallStatus}
                            </span>
                        )}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                        {runStartedAt ? `started ${agoLabel(runStartedAt)}` : 'no run recorded'}
                        {dataRange?.endDate ? ` · through ${dataRange.endDate}` : ''}
                        {` · ${completedCount}/${totalCount} stages`}
                    </div>
                </div>
                {onRefresh && (
                    <button
                        onClick={onRefresh}
                        className="text-[11px] px-2 py-1 rounded border border-[#30363d] text-gray-300 hover:border-blue-500/50 transition-colors shrink-0"
                    >
                        Refresh
                    </button>
                )}
            </div>

            <div className="h-1 w-full rounded bg-[#21262d] overflow-hidden mb-4">
                <div
                    className="h-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: failed.length ? STATE_STYLE.failed.color : STATE_STYLE.completed.color }}
                />
            </div>

            <div className="flex items-start gap-0 overflow-x-auto pb-1">
                {stages.map((s, i) => (
                    <StageDot key={s.phase} stage={s} isLast={i === stages.length - 1} />
                ))}
            </div>

            {/* The line that answers "stuck or just slow?" without opening a database. */}
            {active && (active.state === 'running' || active.state === 'stalled') && (
                <div
                    className="mt-3 text-[11px] px-2.5 py-1.5 rounded border"
                    style={{
                        color: STATE_STYLE[active.state].color,
                        backgroundColor: STATE_STYLE[active.state].bg,
                        borderColor: STATE_STYLE[active.state].border,
                    }}
                >
                    <span className="font-medium">{shortPhase(active.phase)}</span>
                    {active.state === 'stalled' ? ' appears stalled' : ' running'}
                    {active.elapsedMs != null && ` for ${formatElapsed(active.elapsedMs)}`}
                    {active.lastHeartbeatAt
                        ? ` · last heartbeat ${agoLabel(active.lastHeartbeatAt)}`
                        : ' · no heartbeat recorded'}
                    {active.label ? ` — ${active.label}` : ''}
                </div>
            )}

            {failed.map((f) => (
                <div
                    key={f.phase}
                    className="mt-2 text-[11px] px-2.5 py-1.5 rounded border break-words"
                    style={{ color: STATE_STYLE.failed.color, backgroundColor: STATE_STYLE.failed.bg, borderColor: STATE_STYLE.failed.border }}
                >
                    <span className="font-medium">{shortPhase(f.phase)}</span> failed
                    {f.error ? `: ${f.error}` : ''}
                </div>
            ))}

            {stalled && (
                <div className="mt-2 text-[10px] text-gray-500">
                    A stalled stage is still marked running but has stopped reporting. It is not necessarily dead —
                    check the worker before intervening.
                </div>
            )}
        </div>
    );
}

import { useCallback, useEffect, useState } from 'react';
import { PALETTE, dividerStyle } from '../../../Components/ESF/estoreFactoryTheme.js';
import axiosInstance from '../../../config/axios.config.js';

/**
 * Estore Factory > Status — recreates deploy/status.html exactly.
 *
 * Every interaction here (expand a task, post a comment, stage a file,
 * approve a budget, request a task) is local UI state only, exactly matching
 * the mock's own Component class — a plain in-memory object with no API
 * calls. There is no staff task-queue, ticket-comment, or approval-request
 * model on the backend yet (see the data-reality note in
 * ClientDashboard.jsx), so nothing here persists past a page refresh, same as
 * the source design.
 */
const inputStyle = { background: PALETTE.input, border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textBody };

/**
 * One thing the team is blocked on.
 *
 * Read-only on purpose: what the client supplies has to land back in the Zoho
 * task to be worth anything, and that write path does not exist yet — the
 * OAuth scopes are task-READ and the connected Zoho account has the Read Only
 * profile. An upload button here would be a button that silently loses files.
 * See the note in Services/AI/ZohoTaskSummaryService.js on how these are found.
 */
const ASK_LABEL = {
    photos: 'Photos needed',
    video: 'Video needed',
    approval: 'Approval needed',
    information: 'Information needed',
    content: 'Content needed',
    access: 'Access needed',
    other: 'Needs your input',
};

const waitingSince = (value) => {
    if (!value) return null;
    const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
    if (Number.isNaN(days)) return null;
    if (days <= 0) return 'Asked today';
    if (days === 1) return 'Waiting 1 day';
    return `Waiting ${days} days`;
};

const WaitingItem = ({ item, isFirst }) => (
    <div
        className="flex flex-wrap items-start gap-x-5 gap-y-2 py-4"
        style={isFirst ? undefined : { borderTop: '1px solid rgba(245,166,35,.16)' }}
    >
        <div className="flex-1 min-w-[260px] flex flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold tracking-[.04em]" style={{ color: '#9C8354' }}>
                {(ASK_LABEL[item.kind] || ASK_LABEL.other).toUpperCase()}
            </span>
            <span className="text-sm font-semibold" style={{ color: PALETTE.textPrimary }}>{item.ask}</span>
            <span className="text-[12.5px]" style={{ color: '#B99A63' }}>
                Blocking: {String(item.taskName || '').replace(/\s+/g, ' ').trim()}
                {item.owners?.length ? ` · ${item.owners.join(', ')}` : ''}
            </span>
        </div>
        {waitingSince(item.since) && (
            <span className="flex-none text-[12.5px] pt-5" style={{ color: PALETTE.amberSub }}>
                {waitingSince(item.since)}
            </span>
        )}
    </div>
);

/** Zoho portals name their own statuses (this one uses Open/Content/Design), so
 *  the badge falls back to neutral for anything not explicitly mapped rather
 *  than crashing on an unknown key. */
const NEUTRAL_BADGE = { bg: 'rgba(255,255,255,.06)', color: PALETTE.textTertiary };
const PRIORITY_STYLE = {
    none: NEUTRAL_BADGE,
    low: { bg: 'rgba(255,255,255,.035)', color: PALETTE.textMuted },
    medium: NEUTRAL_BADGE,
    high: { bg: 'rgba(245,166,35,.13)', color: PALETTE.amberValue },
};
const badgeFor = (map, value) => map[String(value || '').toLowerCase()] || NEUTRAL_BADGE;

const GRID_COLS = '96px minmax(0,1fr) 96px 120px 150px 110px 20px';

/** "2 hours ago" / "Yesterday" / "Aug 24" — matching the mock's relative style. */
const relativeTime = (value) => {
    if (!value) return '—';
    const then = new Date(value);
    if (Number.isNaN(then.getTime())) return '—';
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const shortDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? null
        : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/**
 * One task row, expanding to the AI progress summary of its Zoho discussion.
 *
 * The raw thread is never sent to the browser — it is the agency's internal
 * chatter. The server ships a summary generated at sync time plus a count, so
 * the client sees what happened without reading how it was discussed.
 */
const TaskRow = ({ task, isFirst }) => {
    const [open, setOpen] = useState(false);
    const priority = badgeFor(PRIORITY_STYLE, task.priority);
    const hasDetail = Boolean(task.summary) || task.updateCount > 0;

    return (
        <>
            <div
                role="button"
                tabIndex={0}
                onClick={() => setOpen((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
                className="grid items-center gap-[18px] py-4 cursor-pointer"
                style={{ gridTemplateColumns: GRID_COLS, ...(isFirst ? undefined : dividerStyle()) }}
            >
                {/* Zoho task ids are 19-digit numbers — useless in a narrow column.
                    The task list ("Meta", "TikTok", "Google") is the short, real,
                    meaningful identifier in this portal. */}
                <span className="text-xs truncate" style={{ color: PALETTE.textMuted }}>{task.tasklist || '—'}</span>
                <span className="text-[13.5px] min-w-0 truncate" style={{ color: PALETTE.textBody }} title={task.name}>{task.name}</span>
                <span className="justify-self-start text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: priority.bg, color: priority.color }}>
                    {task.priority || 'Normal'}
                </span>
                <span className="justify-self-start text-[11.5px] font-semibold rounded-md px-[10px] py-1 truncate max-w-full" style={{ background: NEUTRAL_BADGE.bg, color: PALETTE.good }}>
                    {task.status || '—'}
                </span>
                <span className="flex items-center gap-2 min-w-0">
                    {task.owners?.length > 0 && (
                        <span className="w-[22px] h-[22px] flex-none rounded-full" style={{ background: 'repeating-linear-gradient(135deg, #1E2228 0 4px, #252A31 4px 8px)', border: '1px solid rgba(255,255,255,.09)' }} />
                    )}
                    <span className="text-[12.5px] truncate" style={{ color: PALETTE.textTertiary }}>
                        {task.owners?.length ? task.owners.join(', ') : 'Unassigned'}
                    </span>
                </span>
                <span className="text-xs text-right" style={{ color: PALETTE.textMuted }}>{relativeTime(task.updatedAt)}</span>
                <span className="text-[10px] text-right" style={{ color: PALETTE.textFaint, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
                    {hasDetail ? '▾' : ''}
                </span>
            </div>

            {open && (
                <div className="flex flex-col gap-3 pb-5" style={dividerStyle()}>
                    {task.summary ? (
                        <p className="m-0 text-[13px] leading-[1.65] max-w-[80ch] whitespace-pre-line" style={{ color: '#B7BDC6' }}>
                            {task.summary}
                        </p>
                    ) : (
                        <p className="m-0 text-[12.5px]" style={{ color: PALETTE.textMuted }}>No updates on this task yet.</p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: PALETTE.textMuted }}>
                        {task.updateCount > 0 && (
                            <span>
                                Summarised from {task.updateCount} update{task.updateCount === 1 ? '' : 's'}
                                {task.lastUpdateAt ? `, latest ${shortDate(task.lastUpdateAt)}` : ''}
                            </span>
                        )}
                        {task.endDate && <span>Due {shortDate(task.endDate)}</span>}
                        {task.hasAttachments && <span>Has attachments in Zoho</span>}
                    </div>
                </div>
            )}
        </>
    );
};

const SectionEmpty = ({ children }) => (
    <div className="py-8 text-center text-[13px]" style={{ color: PALETTE.textMuted }}>{children}</div>
);

const TableHeader = ({ dim }) => (
    <div
        className="grid items-center gap-[18px] py-[15px] pb-[11px] text-[11px] tracking-[.09em]"
        style={{ gridTemplateColumns: GRID_COLS, borderBottom: `1px solid ${dim ? PALETTE.dividerFaint : PALETTE.borderHover}`, color: dim ? PALETTE.textDim : PALETTE.textMuted }}
    >
        <span>LIST</span><span>TASK</span><span>PRIORITY</span><span>STATUS</span><span>OWNER</span><span className="text-right">UPDATED</span><span />
    </div>
);

const Status = () => {
    // Tasks come from the nightly Zoho sync (server/Services/Zoho/ZohoTaskSync.js),
    // never from Zoho on page load — walking a project's comments is one API call
    // per task and would put Zoho's rate limiter in front of this page.
    const [board, setBoard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    const loadBoard = useCallback(async () => {
        try {
            setLoading(true);
            setLoadError('');
            const res = await axiosInstance.get('/api/pagewise/esf/project-status');
            setBoard(res.data?.data || null);
        } catch (err) {
            setLoadError(err.response?.data?.message || 'Could not load your project status');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadBoard(); }, [loadBoard]);

    const [formOpen, setFormOpen] = useState(false);
    const [name, setName] = useState('');
    const [due, setDue] = useState('');
    const [requests, setRequests] = useState([]);
    const [doneOpen, setDoneOpen] = useState(false);

    const waitingOnYou = board?.waitingOnYou || [];
    const inProgress = board?.inProgress || [];
    const comingUp = board?.comingUp || [];
    const completed = board?.completed || [];

    const addTask = () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const dueLabel = due
            ? `Needed ${new Date(`${due}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : 'No date';
        setRequests((r) => [{ name: trimmed, due: dueLabel }, ...r]);
        setName('');
        setDue('');
        setFormOpen(false);
    };

    return (
        <div className="min-h-full w-full" style={{ background: PALETTE.bg, color: PALETTE.textPrimary, fontFamily: "system-ui, -apple-system, 'Helvetica Neue', Helvetica, sans-serif" }}>
            <div className="max-w-[1170px] mx-auto flex flex-col gap-[26px] px-8 md:px-10 py-9 md:py-11">

                <header className="flex flex-col gap-[7px]">
                    <h1 className="m-0 text-[29px] font-semibold tracking-[-0.02em]">Status</h1>
                    <p className="m-0 text-[13.5px]" style={{ color: PALETTE.textSecondary }}>
                        Everything your eStore Factory team is working on
                        {board?.projectName ? ` in ${board.projectName}` : ''}.
                        {/* Said out loud because this is a nightly sync — showing day-old
                            work as if it were live would be worse than admitting the lag. */}
                        {board?.syncedAt && (
                            <span style={{ color: PALETTE.textMuted }}> Updated {relativeTime(board.syncedAt)}.</span>
                        )}
                    </p>
                </header>

                {/* Only rendered when something is actually outstanding — an
                    empty amber "Waiting on you" banner reads as a warning about
                    nothing. */}
                {waitingOnYou.length > 0 && (
                    <section className="rounded-lg" style={{ background: PALETTE.amberBg, border: `1px solid ${PALETTE.amberBorder}`, padding: '20px 24px 8px' }}>
                        <div className="flex items-center gap-2.5 pb-1.5 flex-wrap">
                            <span className="w-[7px] h-[7px] rounded-full" style={{ background: PALETTE.amberValue }} />
                            <h2 className="m-0 text-[15px] font-bold tracking-[-0.01em]" style={{ color: '#F7C173' }}>Waiting on you</h2>
                            <span className="text-xs" style={{ color: PALETTE.amberSub }}>
                                {waitingOnYou.length === 1
                                    ? 'Work is paused until this comes back'
                                    : `Work is paused on ${waitingOnYou.length} items until these come back`}
                            </span>
                        </div>
                        <div style={{ borderTop: '1px solid rgba(245,166,35,.16)' }}>
                            {waitingOnYou.map((item, i) => (
                                <WaitingItem key={`${item.taskId}-${i}`} item={item} isFirst={i === 0} />
                            ))}
                        </div>
                        {/* Said plainly rather than offering an upload button that
                            cannot deliver: replying into Zoho needs write scopes
                            and a non-read-only Zoho account, neither of which
                            exists yet. */}
                        <p className="m-0 pb-4 pt-1 text-xs" style={{ color: PALETTE.amberSub }}>
                            Send these to your account manager and we will pick them up from there.
                        </p>
                    </section>
                )}

                <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h2 className="m-0 text-base font-bold tracking-[-0.01em]">In progress</h2>
                        <span className="flex-1 text-[12.5px]" style={{ color: PALETTE.textMuted }}>
                            {loading ? 'Loading…' : `${inProgress.length} task${inProgress.length === 1 ? '' : 's'} · your team is handling these`}
                        </span>
                        <button
                            type="button"
                            onClick={() => setFormOpen((v) => !v)}
                            className="flex-none text-[12.5px] font-bold px-[15px] py-2.5 rounded-lg"
                            style={{ background: PALETTE.accent, color: PALETTE.onAccentText }}
                        >
                            ＋ Request a task
                        </button>
                    </div>

                    {formOpen && (
                        <div className="rounded-lg flex flex-col gap-3.5" style={{ background: PALETTE.surface, border: '1px solid rgba(59,130,246,.24)', padding: '20px 24px' }}>
                            <div className="flex flex-col gap-1">
                                <span className="text-sm font-semibold">Request a task</span>
                                <span className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>Your account manager reviews requests and confirms the timeline.</span>
                            </div>
                            <div className="flex flex-col md:flex-row gap-3 md:items-end">
                                <label className="flex-1 flex flex-col gap-1.5">
                                    <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>WHAT DO YOU NEED</span>
                                    <input
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="e.g. Add a size chart to the mixing bowl listing"
                                        className="rounded-lg px-3 py-2.5 text-[13px] outline-none"
                                        style={inputStyle}
                                    />
                                </label>
                                <label className="md:flex-none md:w-[180px] flex flex-col gap-1.5">
                                    <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>NEEDED BY</span>
                                    <input
                                        type="date"
                                        value={due}
                                        onChange={(e) => setDue(e.target.value)}
                                        className="rounded-lg px-3 py-2.5 text-[13px] outline-none"
                                        style={{ ...inputStyle, colorScheme: 'dark' }}
                                    />
                                </label>
                                <button type="button" onClick={addTask} className="flex-none text-[12.5px] font-bold px-[18px] py-2.5 rounded-lg" style={{ background: PALETTE.accent, color: PALETTE.onAccentText }}>Send request</button>
                                <button type="button" onClick={() => setFormOpen(false)} className="flex-none text-[12.5px] px-4 py-2.5 rounded-lg" style={{ color: PALETTE.textSecondary, border: `1px solid ${PALETTE.border}` }}>Cancel</button>
                            </div>
                        </div>
                    )}

                    {requests.length > 0 && (
                        <div className="rounded-lg" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '4px 24px 6px' }}>
                            {requests.map((r, i) => (
                                <div key={i} className="grid items-center gap-[18px] py-[15px]" style={{ gridTemplateColumns: GRID_COLS, ...(i > 0 ? dividerStyle() : undefined) }}>
                                    <span className="text-xs" style={{ color: PALETTE.textDim, fontFamily: 'ui-monospace, Menlo, monospace' }}>Pending</span>
                                    <span className="flex flex-col gap-[3px] min-w-0">
                                        <span className="text-[13.5px]" style={{ color: PALETTE.textBody }}>{r.name}</span>
                                        <span className="text-xs" style={{ color: PALETTE.textMuted }}>{r.due}</span>
                                    </span>
                                    <span />
                                    <span className="justify-self-start text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: 'rgba(59,130,246,.12)', color: '#7EA8F8' }}>Requested by you</span>
                                    <span className="text-[12.5px]" style={{ color: PALETTE.textMuted }}>Awaiting confirm</span>
                                    <span className="text-xs text-right" style={{ color: PALETTE.textMuted }}>Just now</span>
                                    <span />
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="rounded-lg" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '4px 24px 6px' }}>
                        <div className="overflow-x-auto">
                            <div className="min-w-[760px]">
                                <TableHeader />
                                {loading ? (
                                    <SectionEmpty>Loading your team&rsquo;s work…</SectionEmpty>
                                ) : loadError ? (
                                    <SectionEmpty>{loadError}</SectionEmpty>
                                ) : !board?.linked ? (
                                    <SectionEmpty>
                                        No Zoho project is connected to your account yet — your account manager connects one from the portal.
                                    </SectionEmpty>
                                ) : inProgress.length === 0 ? (
                                    <SectionEmpty>Nothing is in progress right now.</SectionEmpty>
                                ) : (
                                    inProgress.map((task, i) => (
                                        <TaskRow key={task.id} task={task} isFirst={i === 0} />
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="flex flex-col gap-3">
                    <div className="flex items-baseline gap-2.5">
                        <h2 className="m-0 text-[14.5px] font-semibold tracking-[-0.01em]" style={{ color: PALETTE.textTertiary }}>Coming up</h2>
                        <span className="text-[12.5px]" style={{ color: PALETTE.textDim }}>
                            {comingUp.length ? 'Scheduled to start later' : 'Not started yet'}
                        </span>
                    </div>
                    <div className="rounded-lg overflow-x-auto" style={{ border: `1px solid ${PALETTE.dividerFaint}`, background: 'rgba(255,255,255,.012)', padding: '2px 24px 4px' }}>
                        <div className="min-w-[760px]">
                            <div className="grid items-center gap-[18px] py-[13px] pb-[10px] text-[11px] tracking-[.09em]" style={{ gridTemplateColumns: GRID_COLS, borderBottom: `1px solid ${PALETTE.dividerFaint}`, color: PALETTE.textDim }}>
                                <span>LIST</span><span>TASK</span><span>PRIORITY</span><span>STARTS</span><span>OWNER</span><span /><span />
                            </div>
                            {comingUp.length === 0 ? (
                                <SectionEmpty>{board?.linked ? 'Nothing scheduled to start yet.' : ' '}</SectionEmpty>
                            ) : (
                                comingUp.map((t, i) => {
                                    const priority = badgeFor(PRIORITY_STYLE, t.priority);
                                    return (
                                        <div key={t.id} className="grid items-center gap-[18px] py-[14px]" style={{ gridTemplateColumns: GRID_COLS, ...(i > 0 ? dividerStyle('rgba(255,255,255,.04)') : undefined) }}>
                                            <span className="text-xs truncate" style={{ color: PALETTE.textDim }}>{t.tasklist || '—'}</span>
                                            <span className="text-[13px] min-w-0 truncate" style={{ color: PALETTE.textTertiary }} title={t.name}>{t.name}</span>
                                            <span className="justify-self-start text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: priority.bg, color: priority.color }}>{t.priority || 'Normal'}</span>
                                            <span className="text-xs" style={{ color: PALETTE.textMuted }}>{shortDate(t.startDate) || '—'}</span>
                                            <span className="text-[12.5px] truncate" style={{ color: PALETTE.textMuted }}>{t.owners?.length ? t.owners.join(', ') : 'Unassigned'}</span>
                                            <span /><span />
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </section>

                <div>
                    <button
                        type="button"
                        onClick={() => setDoneOpen((v) => !v)}
                        className="w-full flex items-center gap-3 rounded-lg cursor-pointer"
                        style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '17px 24px' }}
                    >
                        <span className="flex-1 text-left text-[13.5px] font-semibold" style={{ color: PALETTE.textBody }}>Completed, last 30 days</span>
                        <span className="flex-none text-[12.5px]" style={{ color: PALETTE.textSecondary }}>
                            {completed.length} task{completed.length === 1 ? '' : 's'}
                        </span>
                        <span className="flex-none text-[10px]" style={{ color: PALETTE.textFaint, transform: doneOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
                    </button>
                </div>

                {doneOpen && (
                    <div className="rounded-lg -mt-4" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '4px 24px 6px' }}>
                        {completed.length === 0 ? (
                            <SectionEmpty>Nothing was completed in the last 30 days.</SectionEmpty>
                        ) : (
                            completed.map((c, i) => (
                                <div key={c.id} className="flex items-center gap-4 py-[14px]" style={i > 0 ? dividerStyle('rgba(255,255,255,.04)') : undefined}>
                                    <span className="flex-1 text-[13px] min-w-0 truncate" style={{ color: PALETTE.textTertiary }} title={c.name}>{c.name}</span>
                                    {c.owners?.length > 0 && (
                                        <span className="flex-none text-xs" style={{ color: PALETTE.textDim }}>{c.owners.join(', ')}</span>
                                    )}
                                    <span className="flex-none text-xs" style={{ color: PALETTE.textMuted }}>Completed {shortDate(c.updatedAt) || '—'}</span>
                                </div>
                            ))
                        )}
                    </div>
                )}

            </div>
        </div>
    );
};

export default Status;

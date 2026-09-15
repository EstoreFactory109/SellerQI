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
 * One thing the team is blocked on, and the form to clear it.
 *
 * What the client types and attaches is posted straight onto the Zoho task, so
 * the team sees it in the thread they already work in rather than in a second
 * inbox. See Services/AI/ZohoTaskSummaryService.js for how these asks are found.
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

/**
 * Marketplace-local money. The currency travels with the amount from the audit rather
 * than being assumed, so a EU seller's figures are not rendered in dollars.
 */
const money = (amount, currencyCode = 'USD') => {
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currencyCode || 'USD',
            maximumFractionDigits: 0,
        }).format(amount);
    } catch {
        // An unrecognised currency code must not blank the row.
        return `${Math.round(amount).toLocaleString('en-US')}`;
    }
};

const waitingSince = (value) => {
    if (!value) return null;
    const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
    if (Number.isNaN(days)) return null;
    if (days <= 0) return 'Asked today';
    if (days === 1) return 'Waiting 1 day';
    return `Waiting ${days} days`;
};

/** What this kind of ask is usually answered with, used to label the file picker. */
const ASK_ACCEPT = {
    photos: 'image/*',
    video: 'video/*,image/*',
};

const MAX_REPLY_FILES = 5;
const MAX_REPLY_FILE_MB = 50;

const repliedWhen = (value) => {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return '';
    const days = Math.floor((Date.now() - at.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const WaitingItem = ({ item, isFirst, onReplied, canAttachFiles }) => {
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [files, setFiles] = useState([]);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [note, setNote] = useState('');

    const replies = item.yourReplies || [];
    const nothingToSend = !message.trim() && files.length === 0;

    const pickFiles = (event) => {
        setError('');
        const chosen = Array.from(event.target.files || []);
        const tooBig = chosen.find((f) => f.size > MAX_REPLY_FILE_MB * 1024 * 1024);

        // Caught here as well as on the server so a client on a slow connection is not
        // told about the size limit only after uploading the whole file.
        if (tooBig) {
            setError(`"${tooBig.name}" is larger than ${MAX_REPLY_FILE_MB}MB`);
            return;
        }
        if (chosen.length + files.length > MAX_REPLY_FILES) {
            setError(`Please attach at most ${MAX_REPLY_FILES} files`);
            return;
        }
        setFiles((current) => [...current, ...chosen]);
        event.target.value = '';
    };

    const send = async () => {
        if (nothingToSend || sending) return;

        setSending(true);
        setError('');
        setNote('');

        try {
            const payload = new FormData();
            if (message.trim()) payload.append('message', message.trim());
            files.forEach((file) => payload.append('files', file));

            const res = await axiosInstance.post(
                `/api/pagewise/esf/project-status/tasks/${encodeURIComponent(item.taskId)}/reply`,
                payload
            );

            const data = res.data?.data || {};
            const failed = data.attachmentsFailed || [];

            // The GET is cached for 300s, so refetching here could show a board that
            // predates this reply. The reply is folded into local state instead.
            onReplied(item.taskId, {
                text: message.trim(),
                at: data.respondedAt || new Date().toISOString(),
                attachments: data.attachmentsSent || [],
            });

            setMessage('');
            setFiles([]);
            if (failed.length > 0) {
                setNote(`Your reply was sent, but we could not upload: ${failed.join(', ')}`);
            } else {
                setOpen(false);
            }
        } catch (err) {
            setError(err.response?.data?.message || 'We could not send your reply. Please try again.');
        } finally {
            setSending(false);
        }
    };

    return (
        <div
            className="flex flex-col gap-3 py-4"
            style={isFirst ? undefined : { borderTop: '1px solid rgba(245,166,35,.16)' }}
        >
            <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
                <div className="flex-1 min-w-[260px] flex flex-col gap-1.5">
                    <span className="text-[11.5px] font-semibold tracking-[.04em]" style={{ color: '#9C8354' }}>
                        {(ASK_LABEL[item.kind] || ASK_LABEL.other).toUpperCase()}
                    </span>
                    <span className="text-sm font-semibold" style={{ color: PALETTE.textPrimary }}>{item.ask}</span>
                    <span className="text-[12.5px]" style={{ color: '#B99A63' }}>
                        Blocking: {String(item.taskName || '').replace(/\s+/g, ' ').trim()}
                        {item.team ? ` · ${item.team}` : ''}
                    </span>
                </div>
                <div className="flex-none flex items-center gap-3 pt-1">
                    {waitingSince(item.since) && (
                        <span className="text-[12.5px]" style={{ color: PALETTE.amberSub }}>
                            {waitingSince(item.since)}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => { setOpen((v) => !v); setError(''); setNote(''); }}
                        className="text-[12.5px] font-semibold rounded-md px-3 py-1.5 transition-colors"
                        style={{ background: open ? 'transparent' : PALETTE.accent, color: open ? PALETTE.amberSub : PALETTE.onAccentText, border: open ? `1px solid ${PALETTE.amberBorder}` : 'none' }}
                    >
                        {open ? 'Cancel' : replies.length > 0 ? 'Send more' : 'Respond'}
                    </button>
                </div>
            </div>

            {/* Their own earlier replies. Shown because the ask itself stays put until
                the next nightly sync re-reads the thread, and without this the page
                would keep asking for something they already sent. */}
            {replies.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-md px-3 py-2.5" style={{ background: 'rgba(255,255,255,.03)' }}>
                    {replies.map((reply, i) => (
                        <div key={i} className="flex flex-col gap-0.5">
                            <span className="text-[11.5px] font-semibold" style={{ color: PALETTE.good }}>
                                You replied {repliedWhen(reply.at)}
                            </span>
                            {reply.text && (
                                <span className="text-[12.5px] whitespace-pre-wrap" style={{ color: PALETTE.textSecondary }}>{reply.text}</span>
                            )}
                            {reply.attachments?.length > 0 && (
                                <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>
                                    Sent: {reply.attachments.join(', ')}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {open && (
                <div className="flex flex-col gap-2.5">
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={3}
                        placeholder="Add anything your team should know…"
                        className="w-full rounded-md px-3 py-2.5 text-[13px] outline-none resize-y"
                        style={inputStyle}
                    />

                    {files.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {files.map((file, i) => (
                                <span
                                    key={`${file.name}-${i}`}
                                    className="flex items-center gap-2 text-[11.5px] rounded-md px-2.5 py-1"
                                    style={{ background: PALETTE.input, color: PALETTE.textSecondary, border: `1px solid ${PALETTE.border}` }}
                                >
                                    {file.name}
                                    <button
                                        type="button"
                                        aria-label={`Remove ${file.name}`}
                                        onClick={() => setFiles((current) => current.filter((_, idx) => idx !== i))}
                                        style={{ color: PALETTE.textMuted }}
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                        {/* Hidden while Zoho is not provisioned for API uploads — a picker
                            that always fails is worse than no picker. Server-driven, so
                            enabling uploads needs no release. */}
                        {canAttachFiles && (
                            <label
                                className="text-[12.5px] font-medium rounded-md px-3 py-1.5 cursor-pointer"
                                style={{ border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textSecondary }}
                            >
                                Attach files
                                <input
                                    type="file"
                                    multiple
                                    accept={ASK_ACCEPT[item.kind] || undefined}
                                    onChange={pickFiles}
                                    className="hidden"
                                />
                            </label>
                        )}
                        <button
                            type="button"
                            onClick={send}
                            disabled={nothingToSend || sending}
                            className="text-[12.5px] font-semibold rounded-md px-4 py-1.5 transition-opacity"
                            style={{
                                background: PALETTE.accent,
                                color: PALETTE.onAccentText,
                                opacity: nothingToSend || sending ? 0.5 : 1,
                                cursor: nothingToSend || sending ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {sending ? 'Sending…' : 'Send to team'}
                        </button>
                        <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>
                            {canAttachFiles
                                ? 'Goes straight onto this task in your project.'
                                : 'Goes straight onto this task. To send files, reply to your account manager.'}
                        </span>
                    </div>

                    {error && <span className="text-[12px]" style={{ color: '#F87171' }}>{error}</span>}
                    {note && <span className="text-[12px]" style={{ color: PALETTE.amberSub }}>{note}</span>}
                </div>
            )}
        </div>
    );
};

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
                {/* The team handling it, never the individual — see the note on
                    ZohoProjectTaskModel.team. */}
                <span className="flex items-center gap-2 min-w-0">
                    <span className="w-[22px] h-[22px] flex-none rounded-full" style={{ background: 'repeating-linear-gradient(135deg, #1E2228 0 4px, #252A31 4px 8px)', border: '1px solid rgba(255,255,255,.09)' }} />
                    <span className="text-[12.5px] truncate" style={{ color: PALETTE.textTertiary }}>
                        {task.team || '—'}
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
        <span>LIST</span><span>TASK</span><span>PRIORITY</span><span>STATUS</span><span>TEAM</span><span className="text-right">UPDATED</span><span />
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

    /**
     * Fold a just-sent reply into the board in place.
     *
     * Not a refetch: the GET is cached for 300s server-side, so re-reading it here
     * would very often return a board captured before this reply existed and the
     * client's own message would appear to vanish.
     */
    const recordReply = useCallback((taskId, reply) => {
        setBoard((current) => {
            if (!current) return current;
            const append = (task) => (task.taskId === taskId || task.id === taskId
                ? { ...task, yourReplies: [...(task.yourReplies || []), reply] }
                : task);

            return {
                ...current,
                waitingOnYou: (current.waitingOnYou || []).map(append),
                inProgress: (current.inProgress || []).map(append),
                comingUp: (current.comingUp || []).map(append),
            };
        });
    }, []);

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
                                <WaitingItem
                                    key={`${item.taskId}-${i}`}
                                    item={item}
                                    isFirst={i === 0}
                                    onReplied={recordReply}
                                    canAttachFiles={Boolean(board?.canAttachFiles)}
                                />
                            ))}
                        </div>
                        {/* The ask stays listed until the next nightly sync re-reads the
                            thread and decides it is satisfied — said out loud so a client
                            who just replied does not think it failed to register. */}
                        <p className="m-0 pb-4 pt-1 text-xs" style={{ color: PALETTE.amberSub }}>
                            Replies go straight to your team on the task. Items clear from this list after tonight&apos;s update.
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
                            {(() => {
                                if (!comingUp.length) return 'Not started yet';
                                const recommended = comingUp.filter((t) => t.source === 'suggested').length;
                                if (recommended === 0) return 'Scheduled to start later';
                                if (recommended === comingUp.length) return 'Found in your audit, not scheduled yet';
                                return `Scheduled work, plus ${recommended} found in your audit`;
                            })()}
                        </span>
                    </div>
                    <div className="rounded-lg overflow-x-auto" style={{ border: `1px solid ${PALETTE.dividerFaint}`, background: 'rgba(255,255,255,.012)', padding: '2px 24px 4px' }}>
                        <div className="min-w-[760px]">
                            <div className="grid items-center gap-[18px] py-[13px] pb-[10px] text-[11px] tracking-[.09em]" style={{ gridTemplateColumns: GRID_COLS, borderBottom: `1px solid ${PALETTE.dividerFaint}`, color: PALETTE.textDim }}>
                                <span>LIST</span><span>TASK</span><span>PRIORITY</span><span>STARTS</span><span>TEAM</span><span /><span />
                            </div>
                            {comingUp.length === 0 ? (
                                <SectionEmpty>{board?.linked ? 'Nothing scheduled to start yet.' : ' '}</SectionEmpty>
                            ) : (
                                comingUp.map((t, i) => {
                                    const priority = badgeFor(PRIORITY_STYLE, t.priority);
                                    const suggested = t.source === 'suggested';

                                    return (
                                        <div key={t.id} className="grid items-center gap-[18px] py-[14px]" style={{ gridTemplateColumns: GRID_COLS, ...(i > 0 ? dividerStyle('rgba(255,255,255,.04)') : undefined) }}>
                                            <span className="text-xs truncate" style={{ color: suggested ? PALETTE.accentLight : PALETTE.textDim }}>
                                                {suggested ? 'Recommended' : (t.tasklist || '—')}
                                            </span>
                                            <span className="text-[13px] min-w-0 truncate" style={{ color: PALETTE.textTertiary }} title={t.action || t.name}>
                                                {t.name}
                                                {/* The money is why this is worth doing — the same figure the
                                                    Dashboard already shows, so the two cannot disagree. */}
                                                {suggested && t.amount > 0 && (
                                                    <span style={{ color: PALETTE.good }}> · {money(t.amount, t.currencyCode)}</span>
                                                )}
                                            </span>
                                            {suggested ? (
                                                <span className="justify-self-start text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: 'rgba(59,130,246,.13)', color: PALETTE.accentLight }}>
                                                    From your audit
                                                </span>
                                            ) : (
                                                <span className="justify-self-start text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: priority.bg, color: priority.color }}>{t.priority || 'Normal'}</span>
                                            )}
                                            {/* Deliberately blank, not a fake date: nobody has scheduled
                                                these yet, and inventing a start would misrepresent them. */}
                                            <span className="text-xs" style={{ color: PALETTE.textMuted }}>
                                                {suggested ? 'Not scheduled' : (shortDate(t.startDate) || '—')}
                                            </span>
                                            <span className="text-[12.5px] truncate" style={{ color: PALETTE.textMuted }}>
                                                {suggested ? '—' : (t.team || '—')}
                                            </span>
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
                                    {c.team && (
                                        <span className="flex-none text-xs" style={{ color: PALETTE.textDim }}>{c.team}</span>
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

import { useState } from 'react';
import { PALETTE, dividerStyle } from '../../../Components/ESF/estoreFactoryTheme.js';

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

const fileSize = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const CommentThread = ({ comments, draft, onDraftChange, onPost, placeholder = 'Add a comment or question for your team…', tint = 'rgba(255,122,26,.16)' }) => (
    <div className="flex flex-col gap-3 pt-3.5" style={dividerStyle()}>
        {comments.map((c, i) => (
            <div key={i} className="flex gap-2.5 items-start">
                <span className="w-[22px] h-[22px] flex-none rounded-full" style={{ background: c.tint || tint, border: '1px solid rgba(255,255,255,.12)' }} />
                <div className="flex flex-col gap-[3px]">
                    <span className="text-xs" style={{ color: PALETTE.textSecondary }}>
                        <span className="font-semibold" style={{ color: PALETTE.textBody }}>{c.who}</span> · {c.time}
                    </span>
                    <span className="text-[12.5px] leading-[1.55]" style={{ color: PALETTE.textInputBody }}>{c.text}</span>
                </div>
            </div>
        ))}
        <div className="flex gap-2.5 items-start">
            <textarea
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                placeholder={placeholder}
                className="flex-1 rounded-lg px-3 py-2.5 text-[12.5px] leading-[1.5] outline-none resize-y"
                style={{ ...inputStyle, minHeight: 40 }}
            />
            <button type="button" onClick={onPost} className="flex-none text-[12.5px] font-semibold px-4 py-2.5 rounded-lg" style={{ color: PALETTE.amberLabel, border: `1px solid ${PALETTE.amberBorder}` }}>
                Comment
            </button>
        </div>
    </div>
);

/** "Waiting on you" #1 — needs product photos. */
const PhotoWaitingItem = () => {
    const [mode, setMode] = useState('pending'); // pending | open | done
    const [files, setFiles] = useState([]);
    const [draft, setDraft] = useState('');
    const [comments, setComments] = useState([
        { who: 'You', time: 'Aug 31', text: 'Please keep the phrase "dishwasher safe" in the second bullet — customers ask about it constantly.' },
    ]);

    const post = () => {
        const t = draft.trim();
        if (!t) return;
        setComments((c) => [...c, { who: 'You', time: 'Just now', text: t, tint: 'rgba(255,122,26,.16)' }]);
        setDraft('');
    };

    if (mode === 'done') {
        return (
            <div className="flex items-center gap-3.5">
                <span className="w-[22px] h-[22px] flex-none rounded-md flex items-center justify-center" style={{ background: 'rgba(95,211,196,.12)' }}>
                    <span className="w-[9px] h-[9px] rounded-full" style={{ background: PALETTE.teal }} />
                </span>
                <div className="flex-1 flex flex-col gap-1">
                    <span className="text-sm font-semibold line-through" style={{ color: '#C6CBD2', textDecorationColor: 'rgba(255,255,255,.2)' }}>We need your product photos for the espresso tamper</span>
                    <span className="text-[12.5px]" style={{ color: PALETTE.teal }}>{files.length} photos sent to your team — Priya is picking the hero shot</span>
                </div>
                <button type="button" onClick={() => setMode('open')} className="flex-none text-[12.5px]" style={{ color: PALETTE.textSecondary }}>View thread</button>
            </div>
        );
    }

    return (
        <>
            <div className="flex items-center gap-5 flex-wrap">
                <div className="flex-1 min-w-[240px] flex flex-col gap-[5px]">
                    <span className="text-[11.5px]" style={{ color: '#9C8354', fontFamily: 'ui-monospace, Menlo, monospace' }}>EF-1028</span>
                    <span className="text-sm font-semibold" style={{ color: PALETTE.textPrimary }}>We need your product photos for the espresso tamper</span>
                    <span className="text-[12.5px]" style={{ color: '#B99A63' }}>Blocking: Building A+ content for the espresso tamper</span>
                </div>
                <span className="flex-none text-[12.5px]" style={{ color: PALETTE.amberSub }}>Waiting 5 days</span>
                <button type="button" onClick={() => setMode(mode === 'open' ? 'pending' : 'open')} className="flex-none text-[12.5px]" style={{ color: PALETTE.amberSub }}>Comment</button>
                <button
                    type="button"
                    onClick={() => setMode(mode === 'open' ? 'pending' : 'open')}
                    className="flex-none text-[12.5px] font-bold px-4 py-2.5 rounded-lg"
                    style={{ background: PALETTE.accent, color: '#141414' }}
                >
                    Upload photos
                </button>
            </div>

            {mode === 'open' && (
                <div className="rounded-lg flex flex-col gap-4 mt-4" style={{ background: 'rgba(0,0,0,.24)', border: `1px solid ${PALETTE.amberBorder}`, padding: '18px 20px' }}>
                    <label
                        className="flex flex-col items-center gap-[7px] rounded-lg py-[26px] px-5 cursor-pointer"
                        style={{ border: `1px dashed ${PALETTE.amberBorder}`, background: 'rgba(245,166,35,.03)' }}
                    >
                        <span className="text-[13.5px] font-semibold" style={{ color: PALETTE.textPrimary }}>Choose photos, or drop them here</span>
                        <span className="text-xs" style={{ color: '#B99A63' }}>JPG or PNG, at least 1600px on the long edge — four lifestyle shots is ideal</span>
                        <input
                            type="file" multiple accept="image/*" className="hidden"
                            onChange={(e) => {
                                const list = Array.from(e.target.files || []).map((f) => ({ name: f.name, size: fileSize(f.size) }));
                                if (list.length) setFiles((prev) => [...prev, ...list]);
                            }}
                        />
                    </label>

                    {files.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {files.map((f, i) => (
                                <span key={i} className="flex items-center gap-2.5 rounded-md px-3 py-2" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)' }}>
                                    <span className="w-3.5 h-3.5 rounded-sm" style={{ background: '#8FA0B8' }} />
                                    <span className="text-[12.5px]" style={{ color: PALETTE.textBody }}>{f.name}</span>
                                    <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>{f.size}</span>
                                </span>
                            ))}
                        </div>
                    )}
                    {files.length > 0 && (
                        <div className="flex items-center gap-3">
                            <button type="button" onClick={() => setMode('done')} className="text-[12.5px] font-bold px-[18px] py-2.5 rounded-lg" style={{ background: PALETTE.accent, color: '#141414' }}>
                                Send {files.length === 1 ? '1 photo' : `${files.length} photos`} to your team
                            </button>
                            <span className="text-xs" style={{ color: PALETTE.textSecondary }}>Priya is notified the moment these land.</span>
                        </div>
                    )}

                    <CommentThread comments={comments} draft={draft} onDraftChange={setDraft} onPost={post} />
                </div>
            )}
        </>
    );
};

/** "Waiting on you" #2 — needs Q4 ad budget approval. */
const BudgetWaitingItem = () => {
    const [mode, setMode] = useState('pending'); // pending | open | done
    const [draft, setDraft] = useState('');
    const [comments, setComments] = useState([
        { who: 'Marcus Oyelaran', time: 'Aug 31', text: 'Happy to walk through the forecast on a call if that is easier — the increase pays for itself at a 2.4 ROAS.', tint: 'rgba(95,211,196,.16)' },
    ]);

    const post = () => {
        const t = draft.trim();
        if (!t) return;
        setComments((c) => [...c, { who: 'You', time: 'Just now', text: t, tint: 'rgba(255,122,26,.16)' }]);
        setDraft('');
    };

    if (mode === 'done') {
        return (
            <div className="flex items-center gap-3.5">
                <span className="w-[22px] h-[22px] flex-none rounded-md flex items-center justify-center" style={{ background: 'rgba(95,211,196,.12)' }}>
                    <span className="w-[9px] h-[9px] rounded-full" style={{ background: PALETTE.teal }} />
                </span>
                <div className="flex-1 flex flex-col gap-1">
                    <span className="text-sm font-semibold line-through" style={{ color: '#C6CBD2', textDecorationColor: 'rgba(255,255,255,.2)' }}>Approve the Q4 ad budget increase to $9,500 / month</span>
                    <span className="text-[12.5px]" style={{ color: PALETTE.teal }}>Approved — Marcus is applying it to your campaigns</span>
                </div>
                <button type="button" onClick={() => setMode('open')} className="flex-none text-[12.5px]" style={{ color: PALETTE.textSecondary }}>View thread</button>
            </div>
        );
    }

    return (
        <>
            <div className="flex items-center gap-5 flex-wrap">
                <div className="flex-1 min-w-[240px] flex flex-col gap-[5px]">
                    <span className="text-[11.5px]" style={{ color: '#9C8354', fontFamily: 'ui-monospace, Menlo, monospace' }}>EF-1039</span>
                    <span className="text-sm font-semibold" style={{ color: PALETTE.textPrimary }}>Approve the Q4 ad budget increase to $9,500 / month</span>
                    <span className="text-[12.5px]" style={{ color: '#B99A63' }}>Blocking: Restructuring your Sponsored Products campaigns</span>
                </div>
                <span className="flex-none text-[12.5px]" style={{ color: PALETTE.amberSub }}>Waiting 2 days</span>
                <button type="button" onClick={() => setMode(mode === 'open' ? 'pending' : 'open')} className="flex-none text-[12.5px]" style={{ color: PALETTE.amberSub }}>Comment</button>
                <button
                    type="button"
                    onClick={() => setMode(mode === 'open' ? 'pending' : 'open')}
                    className="flex-none text-[12.5px] font-bold px-4 py-2.5 rounded-lg"
                    style={{ background: PALETTE.accent, color: '#141414' }}
                >
                    Review budget
                </button>
            </div>

            {mode === 'open' && (
                <div className="rounded-lg flex flex-col gap-4 mt-4" style={{ background: 'rgba(0,0,0,.24)', border: `1px solid ${PALETTE.amberBorder}`, padding: '18px 20px' }}>
                    <div className="flex items-end gap-[34px] flex-wrap">
                        <div className="flex flex-col gap-[5px]">
                            <span className="text-[11.5px] tracking-[.04em]" style={{ color: '#8A7654' }}>CURRENT</span>
                            <span className="text-[22px] font-semibold tracking-[-0.02em]" style={{ color: PALETTE.textTertiary }}>$7,200<span className="text-[13px] font-medium"> /mo</span></span>
                        </div>
                        <span className="text-base pb-1" style={{ color: PALETTE.textMuted }}>→</span>
                        <div className="flex flex-col gap-[5px]">
                            <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.amberSub }}>PROPOSED FOR Q4</span>
                            <span className="text-[26px] font-bold tracking-[-0.02em]" style={{ color: PALETTE.textPrimary }}>$9,500<span className="text-sm font-medium" style={{ color: PALETTE.textTertiary }}> /mo</span></span>
                        </div>
                        <p className="m-0 flex-1 text-[12.5px] leading-[1.6] max-w-[420px]" style={{ color: '#B7BDC6' }}>
                            Marcus wants the extra spend on the three keyword groups that already convert above 14%, running from Oct 1 to Dec 24. It is reversible at any point.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setMode('done')} className="text-[12.5px] font-bold px-[18px] py-2.5 rounded-lg" style={{ background: PALETTE.accent, color: '#141414' }}>
                            Approve $9,500 / month
                        </button>
                        <button
                            type="button"
                            onClick={() => setDraft((d) => d || 'We could do $8,400 — tell me what that buys.')}
                            className="text-[12.5px] px-4 py-2.5 rounded-lg"
                            style={{ color: PALETTE.textBody, border: `1px solid ${PALETTE.borderHover}` }}
                        >
                            Suggest a different amount
                        </button>
                    </div>
                    <CommentThread comments={comments} draft={draft} onDraftChange={setDraft} onPost={post} />
                </div>
            )}
        </>
    );
};

const PRIORITY_STYLE = {
    Low: { bg: 'rgba(255,255,255,.035)', color: PALETTE.textMuted },
    Medium: { bg: 'rgba(255,255,255,.06)', color: PALETTE.textTertiary },
    High: { bg: PALETTE.amberBg.replace('.07', '.13'), color: PALETTE.amberValue },
};
const TASK_STATUS_STYLE = {
    'In progress': { bg: 'rgba(95,211,196,.11)', color: PALETTE.teal },
    'In review': { bg: 'rgba(95,211,196,.11)', color: PALETTE.teal },
    'Waiting on Amazon': { bg: 'rgba(255,255,255,.06)', color: PALETTE.textTertiary },
    'Waiting on you': { bg: PALETTE.amberBg.replace('.07', '.13'), color: PALETTE.amberValue },
};

const GRID_COLS = '88px minmax(0,1fr) 90px 130px 130px 100px 20px';

const IN_PROGRESS_TASKS = [
    {
        id: 'EF-1042', name: 'Rewriting the bullet points on your digital kitchen scale listing', priority: 'Medium', status: 'In progress', owner: 'Priya', updated: '2 hours ago', due: 'Sep 5',
        log: [
            { date: 'Sep 2', text: 'Second draft sent to Priya for review — bullets now lead with the 11 lb capacity and the tare function.' },
            { date: 'Aug 30', text: 'Pulled the top 25 converting search terms from the last 90 days to work into the copy.' },
            { date: 'Aug 28', text: 'Reviewed the three closest competitor listings and noted the claims they lead with.' },
        ],
        file: { name: 'kitchen-scale-bullets-v2.docx', size: '28 KB' },
        comments: [],
    },
    {
        id: 'EF-1039', name: 'Restructuring your Sponsored Products campaigns around top converting keywords', priority: 'High', status: 'Waiting on you', owner: 'Marcus', updated: 'Yesterday', due: 'Sep 9',
        log: [
            { date: 'Sep 1', text: 'New campaign structure built in draft — waiting on your budget approval before it goes live.' },
            { date: 'Aug 27', text: 'Split the single catch-all campaign into three: exact, phrase, and discovery.' },
        ],
        comments: [],
    },
    {
        id: 'EF-1031', name: "Filing reimbursement claims for 214 units lost in Amazon's warehouses", priority: 'Medium', status: 'Waiting on Amazon', owner: 'Devika', updated: '3 days ago', due: 'Sep 18',
        log: [
            { date: 'Aug 30', text: 'Six cases opened covering $7,120 of inventory. Amazon usually responds within two weeks.' },
            { date: 'Aug 22', text: 'Reconciled 18 months of shipment records against inventory ledgers to find the gaps.' },
        ],
        comments: [],
    },
    {
        id: 'EF-1028', name: 'Building A+ content for the espresso tamper', priority: 'High', status: 'Waiting on you', owner: 'Priya', updated: '5 days ago', due: 'Sep 12',
        log: [
            { date: 'Aug 28', text: 'Module layout and copy approved internally. We need four lifestyle photos from you to finish it.' },
            { date: 'Aug 21', text: 'Drafted five comparison modules based on the questions buyers ask most in your reviews.' },
        ],
        comments: [],
    },
    {
        id: 'EF-1047', name: 'Keyword research for the milk frother range ahead of Q4', priority: 'Low', status: 'In review', owner: 'Devika', updated: '6 days ago', due: 'Sep 8',
        log: [
            { date: 'Aug 27', text: '41 new terms shortlisted. Priya is checking them against your ad spend before we apply them.' },
            { date: 'Aug 19', text: "Mapped seasonal demand for frothers and gift-set terms from last year's Q4 data." },
        ],
        comments: [],
    },
];

const COMING_UP = [
    { id: 'EF-1053', name: 'Refreshing the main images across the kettle range', priority: 'Low', when: 'Mid September' },
    { id: 'EF-1054', name: 'Inventory forecast for the Q4 gifting season', priority: 'Medium', when: 'Late September' },
    { id: 'EF-1055', name: 'Building your brand store', priority: 'Medium', when: 'October' },
    { id: 'EF-1056', name: 'Sponsored Brands video campaign for the frother line', priority: 'Low', when: 'October' },
];

const COMPLETED = [
    { text: 'Backend search terms updated across 12 ASINs', when: 'Completed Sep 1' },
    { text: 'Negative keywords added to 6 campaigns to cut wasted ad spend', when: 'Completed Aug 28' },
    { text: 'Main image on the stainless steel kettle replaced with the new hero shot', when: 'Completed Aug 24' },
    { text: 'Reimbursement claim for 38 damaged units — $1,290 recovered', when: 'Completed Aug 19' },
    { text: 'A+ content published for the digital kitchen scale', when: 'Completed Aug 12' },
];

const TaskRow = ({ task, isFirst }) => {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const [comments, setComments] = useState(task.comments);

    const post = () => {
        const t = draft.trim();
        if (!t) return;
        setComments((c) => [...c, { who: 'You', time: 'Just now', text: t }]);
        setDraft('');
    };

    const priority = PRIORITY_STYLE[task.priority];
    const status = TASK_STATUS_STYLE[task.status];

    return (
        <>
            <div
                role="button"
                tabIndex={0}
                onClick={() => setOpen((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen((v) => !v); }}
                className="grid items-center gap-[18px] py-4 cursor-pointer"
                style={{ gridTemplateColumns: GRID_COLS, ...(isFirst ? undefined : dividerStyle()) }}
            >
                <span className="text-xs" style={{ color: PALETTE.textMuted, fontFamily: 'ui-monospace, Menlo, monospace' }}>{task.id}</span>
                <span className="text-[13.5px] min-w-0 truncate" style={{ color: PALETTE.textBody }}>{task.name}</span>
                <span className="justify-self-start text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: priority.bg, color: priority.color }}>{task.priority}</span>
                <span className="justify-self-start text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: status.bg, color: status.color }}>{task.status}</span>
                <span className="flex items-center gap-2 min-w-0">
                    <span className="w-[22px] h-[22px] flex-none rounded-full" style={{ background: 'repeating-linear-gradient(135deg, #1E2228 0 4px, #252A31 4px 8px)', border: '1px solid rgba(255,255,255,.09)' }} />
                    <span className="text-[12.5px]" style={{ color: PALETTE.textTertiary }}>{task.owner}</span>
                </span>
                <span className="text-xs text-right" style={{ color: PALETTE.textMuted }}>{task.updated}</span>
                <span className="text-[10px] text-right" style={{ color: PALETTE.textFaint, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
            </div>

            {open && (
                <div className="flex flex-col gap-3.5 pb-5" style={dividerStyle()}>
                    {task.log.map((entry) => (
                        <div key={entry.date} className="flex gap-3.5 text-[12.5px] leading-[1.55]">
                            <span className="flex-none w-[74px]" style={{ color: PALETTE.textMuted }}>{entry.date}</span>
                            <span style={{ color: '#B7BDC6' }}>{entry.text}</span>
                        </div>
                    ))}
                    {task.file && (
                        <div className="ml-[88px] flex items-center gap-2.5 self-start rounded-md px-3 py-2" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}>
                            <span className="w-3.5 h-4 rounded-sm" style={{ background: '#8FA0B8' }} />
                            <span className="text-[12.5px]" style={{ color: PALETTE.textBody }}>{task.file.name}</span>
                            <span className="text-[11.5px]" style={{ color: PALETTE.textMuted }}>{task.file.size}</span>
                        </div>
                    )}
                    <div className="ml-[88px]" onClick={(e) => e.stopPropagation()}>
                        <CommentThread comments={comments} draft={draft} onDraftChange={setDraft} onPost={post} />
                    </div>
                    <div className="ml-[88px] text-xs" style={{ color: PALETTE.textMuted }}>Due {task.due} · Reference {task.id} when you message us about this</div>
                </div>
            )}
        </>
    );
};

const Status = () => {
    const [formOpen, setFormOpen] = useState(false);
    const [name, setName] = useState('');
    const [due, setDue] = useState('');
    const [requests, setRequests] = useState([]);
    const [doneOpen, setDoneOpen] = useState(false);

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
                    <p className="m-0 text-[13.5px]" style={{ color: PALETTE.textSecondary }}>Everything your eStore Factory team is doing on the Kessler Home Goods account right now.</p>
                </header>

                <section className="rounded-lg" style={{ background: PALETTE.amberBg, border: `1px solid ${PALETTE.amberBorder}`, padding: '20px 24px 8px' }}>
                    <div className="flex items-center gap-2.5 pb-1.5">
                        <span className="w-[7px] h-[7px] rounded-full" style={{ background: PALETTE.amberValue }} />
                        <h2 className="m-0 text-[15px] font-bold tracking-[-0.01em]" style={{ color: '#F7C173' }}>Waiting on you</h2>
                        <span className="text-xs" style={{ color: PALETTE.amberSub }}>Work is paused until these come back</span>
                    </div>
                    <div className="flex flex-col gap-4 py-4" style={{ borderTop: `1px solid rgba(245,166,35,.16)` }}>
                        <PhotoWaitingItem />
                    </div>
                    <div className="flex flex-col gap-4 py-4" style={{ borderTop: `1px solid rgba(245,166,35,.16)` }}>
                        <BudgetWaitingItem />
                    </div>
                </section>

                <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h2 className="m-0 text-base font-bold tracking-[-0.01em]">In progress</h2>
                        <span className="flex-1 text-[12.5px]" style={{ color: PALETTE.textMuted }}>5 tasks · your team is handling these</span>
                        <button
                            type="button"
                            onClick={() => setFormOpen((v) => !v)}
                            className="flex-none text-[12.5px] font-bold px-[15px] py-2.5 rounded-lg"
                            style={{ background: PALETTE.accent, color: '#141414' }}
                        >
                            ＋ Request a task
                        </button>
                    </div>

                    {formOpen && (
                        <div className="rounded-lg flex flex-col gap-3.5" style={{ background: PALETTE.surface, border: '1px solid rgba(255,122,26,.24)', padding: '20px 24px' }}>
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
                                <button type="button" onClick={addTask} className="flex-none text-[12.5px] font-bold px-[18px] py-2.5 rounded-lg" style={{ background: PALETTE.accent, color: '#141414' }}>Send request</button>
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
                                    <span className="justify-self-start text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: 'rgba(255,122,26,.12)', color: '#FF9A4D' }}>Requested by you</span>
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
                                <div className="grid items-center gap-[18px] py-[15px] pb-[11px] text-[11px] tracking-[.09em]" style={{ gridTemplateColumns: GRID_COLS, borderBottom: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textMuted }}>
                                    <span>TASK ID</span><span>TASK</span><span>PRIORITY</span><span>STATUS</span><span>OWNER</span><span className="text-right">UPDATED</span><span />
                                </div>
                                {IN_PROGRESS_TASKS.map((task, i) => (
                                    <TaskRow key={task.id} task={task} isFirst={i === 0} />
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="flex flex-col gap-3">
                    <div className="flex items-baseline gap-2.5">
                        <h2 className="m-0 text-[14.5px] font-semibold tracking-[-0.01em]" style={{ color: PALETTE.textTertiary }}>Coming up</h2>
                        <span className="text-[12.5px]" style={{ color: PALETTE.textDim }}>Not started yet</span>
                    </div>
                    <div className="rounded-lg overflow-x-auto" style={{ border: `1px solid ${PALETTE.dividerFaint}`, background: 'rgba(255,255,255,.012)', padding: '2px 24px 4px' }}>
                        <div className="min-w-[760px]">
                            <div className="grid items-center gap-[18px] py-[13px] pb-[10px] text-[11px] tracking-[.09em]" style={{ gridTemplateColumns: GRID_COLS, borderBottom: `1px solid ${PALETTE.dividerFaint}`, color: PALETTE.textDim }}>
                                <span>TASK ID</span><span>TASK</span><span>PRIORITY</span><span>STATUS</span><span>OWNER</span><span className="text-right">UPDATED</span><span />
                            </div>
                            {COMING_UP.map((t, i) => {
                                const priority = PRIORITY_STYLE[t.priority];
                                return (
                                    <div key={t.id} className="grid items-center gap-[18px] py-[14px]" style={{ gridTemplateColumns: GRID_COLS, ...(i > 0 ? dividerStyle('rgba(255,255,255,.04)') : undefined) }}>
                                        <span className="text-xs" style={{ color: PALETTE.textDim, fontFamily: 'ui-monospace, Menlo, monospace' }}>{t.id}</span>
                                        <span className="text-[13px] min-w-0 truncate" style={{ color: PALETTE.textTertiary }}>{t.name}</span>
                                        <span className="justify-self-start text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: priority.bg, color: priority.color }}>{t.priority}</span>
                                        <span className="text-xs" style={{ color: PALETTE.textMuted }}>{t.when}</span>
                                        <span /><span /><span />
                                    </div>
                                );
                            })}
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
                        <span className="flex-none text-[12.5px]" style={{ color: PALETTE.textSecondary }}>14 tasks</span>
                        <span className="flex-none text-[10px]" style={{ color: PALETTE.textFaint, transform: doneOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
                    </button>
                </div>

                {doneOpen && (
                    <div className="rounded-lg -mt-4" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '4px 24px 6px' }}>
                        {COMPLETED.map((c, i) => (
                            <div key={c.text} className="flex items-center gap-4 py-[14px]" style={i > 0 ? dividerStyle('rgba(255,255,255,.04)') : undefined}>
                                <span className="flex-1 text-[13px]" style={{ color: PALETTE.textTertiary }}>{c.text}</span>
                                <span className="flex-none text-xs" style={{ color: PALETTE.textMuted }}>{c.when}</span>
                            </div>
                        ))}
                        <div className="pt-3.5 pb-3" style={dividerStyle('rgba(255,255,255,.04)')}>
                            <a href="#" onClick={(e) => e.preventDefault()} className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>View all completed work →</a>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default Status;

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquare, CheckCircle2, RotateCcw, Search, Send, Paperclip, Lock, Check, CheckCheck, X } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

/**
 * "Estore Factory" > Messages — the staff inbox.
 *
 * Laid out like a chat client (WhatsApp Web): conversation list on the left with
 * search and unread badges, conversation on the right with bubbles that hug their
 * content, date separators, and a composer pinned to the bottom. The app's own dark
 * palette throughout — the borrowing is structural, not visual.
 *
 * ── THE CLIENT IS NEVER NAMED HERE ──
 * A conversation shows the client's Zoho project, else brand, else a stored reference
 * like "EF-1184". Never their name, address or phone. That is not this file's choice
 * to revisit: the API does not send those fields (server/Services/Email/
 * messagePresenter.js), bodies arrive already redacted, and a runtime scan rejects any
 * payload containing something address- or phone-shaped.
 *
 * The avatar is initials of THE LABEL for the same reason — a person's initials would
 * be a small, steady leak, and two clients sharing "NK" would be worse than useless.
 *
 * Known exception, decided knowingly: attachment CONTENTS are not redactable (a PDF
 * letterhead, a photographed business card), and staff can still download them.
 */

const STATUS_STYLE = {
    'Needs a reply': 'bg-amber-500/15 text-amber-300',
    'Waiting on client': 'bg-white/10 text-gray-400',
    Resolved: 'bg-emerald-500/15 text-emerald-300',
};

/** Initials of the LABEL, never of a person. */
const initialsOf = (label = '') => {
    const words = String(label).replace(/[^\w\s-]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '—';
    return (words[0][0] + (words[1]?.[0] || '')).toUpperCase();
};

/** A stable tint per conversation so the list is scannable without naming anyone. */
const AVATAR_TINTS = [
    'bg-blue-500/20 text-blue-200', 'bg-emerald-500/20 text-emerald-200',
    'bg-violet-500/20 text-violet-200', 'bg-amber-500/20 text-amber-200',
    'bg-rose-500/20 text-rose-200', 'bg-cyan-500/20 text-cyan-200',
];
const tintFor = (key = '') => {
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return AVATAR_TINTS[hash % AVATAR_TINTS.length];
};

const Avatar = ({ label, size = 'md' }) => (
    <span
        className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${tintFor(label)} ${
            size === 'sm' ? 'h-10 w-10 text-[12px]' : 'h-11 w-11 text-[13px]'
        }`}
    >
        {initialsOf(label)}
    </span>
);

/**
 * The read receipt on a message we sent.
 *
 * ── READ THIS BEFORE TRUSTING A SINGLE TICK ──
 * Two signals count as read: the client opening the thread in the portal, and the
 * client REPLYING. A reply is proof — someone answering at 11:57 has read what arrived
 * at 11:56 — and it is the signal that matters, because a client who lives in their
 * mail app never opens the portal at all and would otherwise show a single tick on
 * messages they had demonstrably read.
 *
 * What still leaves no trace is a silent read in their own mail client. So one tick
 * means "no evidence either way", NOT "they have not read it".
 * That is why the labels are Sent / Opened rather than WhatsApp's delivered / read,
 * and why the conversation carries a standing note saying so — a staff member who
 * reads one tick as "they are ignoring me" is being misled by the UI.
 */
const Receipt = ({ seen }) => {
    if (seen === null || seen === undefined) return null;
    return seen ? (
        <CheckCheck className="h-3.5 w-3.5 shrink-0 text-sky-400" aria-label="Seen by the client" />
    ) : (
        <Check className="h-3.5 w-3.5 shrink-0 text-gray-500" aria-label="Sent" />
    );
};

/** WhatsApp shows a time for today, a weekday this week, then a date. */
const listTime = (value) => {
    if (!value) return '';
    const then = new Date(value);
    if (Number.isNaN(then.getTime())) return '';
    const days = Math.floor((Date.now() - then.getTime()) / 86400000);
    if (days === 0) return then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7) return then.toLocaleDateString('en-US', { weekday: 'short' });
    return then.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
};

const bubbleTime = (value) => {
    const then = new Date(value);
    return Number.isNaN(then.getTime())
        ? ''
        : then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

/** The centred pill between days. */
const dayLabel = (value) => {
    const then = new Date(value);
    if (Number.isNaN(then.getTime())) return '';
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return then.toLocaleDateString('en-US', { weekday: 'long' });
    return then.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

/** Group consecutive messages by calendar day, so separators can be interleaved. */
const groupByDay = (messages) => {
    const groups = [];
    messages.forEach((message) => {
        const key = new Date(message.sentAt).toDateString();
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.messages.push(message);
        else groups.push({ key, day: dayLabel(message.sentAt), messages: [message] });
    });
    return groups;
};

const EsfMessages = () => {
    const [threads, setThreads] = useState([]);
    const [openId, setOpenId] = useState(null);
    const [conversation, setConversation] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showResolved, setShowResolved] = useState(false);
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState('');
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [files, setFiles] = useState([]);

    const loadThreads = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const res = await axiosInstance.get('/app/esf/messages', {
                params: showResolved ? { resolved: 'true' } : {},
            });
            setThreads(res.data?.data?.threads || []);
        } catch (err) {
            setError(err.response?.data?.message || 'Could not load messages');
        } finally {
            setLoading(false);
        }
    }, [showResolved]);

    useEffect(() => { loadThreads(); }, [loadThreads]);

    const openThread = useCallback(async (id) => {
        setOpenId(id);
        setConversation(null);
        // Per-conversation, so a half-written reply and its attachments are never
        // delivered to whoever is opened next.
        setDraft('');
        setFiles([]);
        try {
            const res = await axiosInstance.get(`/app/esf/messages/${id}`);
            setConversation(res.data?.data || null);
            setThreads((current) => current.map((t) => (t.id === id ? { ...t, unread: false } : t)));
        } catch (err) {
            setError(err.response?.data?.message || 'Could not open that conversation');
        }
    }, []);

    const toggleResolved = useCallback(async (id, resolved) => {
        setBusy(true);
        try {
            const res = await axiosInstance.patch(`/app/esf/messages/${id}/resolve`, { resolved });
            const updated = res.data?.data;
            setThreads((current) => (
                showResolved
                    ? current.map((t) => (t.id === id ? updated : t))
                    : current.filter((t) => t.id !== id || !resolved)
            ));
            setConversation((c) => (c && c.thread.id === id ? { ...c, thread: updated } : c));
        } catch (err) {
            setError(err.response?.data?.message || 'Could not update that conversation');
        } finally {
            setBusy(false);
        }
    }, [showResolved]);

    const sendReply = useCallback(async () => {
        const text = draft.trim();
        if (!text || sending || !openId) return;

        setSending(true);
        try {
            // multipart, because the body may carry files. Content-Type is left to the
            // browser: setting it by hand drops the boundary and multer sees nothing.
            const form = new FormData();
            form.append('body', text);
            files.forEach((file) => form.append('files', file));

            await axiosInstance.post(`/app/esf/messages/${openId}/reply`, form);
            // Cleared only after the request succeeds. Clearing optimistically loses
            // what someone just wrote when the send fails, and there is nowhere to get
            // it back from.
            setDraft('');
            setFiles([]);
            const res = await axiosInstance.get(`/app/esf/messages/${openId}`);
            setConversation(res.data?.data || null);
            loadThreads();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not send that reply');
        } finally {
            setSending(false);
        }
    }, [draft, files, sending, openId, loadThreads]);

    /**
     * Filtering happens here, over data the server already redacted.
     *
     * Deliberately client-side: a server-side search over raw text would be a
     * de-anonymisation oracle — type a name, see which threads come back.
     */
    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return threads;
        return threads.filter((t) => `${t.client} ${t.subject || ''}`.toLowerCase().includes(needle));
    }, [threads, search]);

    const open = conversation?.thread;
    const dayGroups = useMemo(() => groupByDay(conversation?.messages || []), [conversation]);

    return (
        <div className="h-[calc(100vh-132px)] w-full bg-[#0b0f17] p-4 md:p-6">
            <div className="mx-auto flex h-full max-w-[1600px] overflow-hidden rounded-xl border border-white/10">

                {/* ── Conversation list ── */}
                <aside className="flex w-full max-w-[380px] shrink-0 flex-col border-r border-white/10 bg-white/[0.02]">
                    <div className="flex items-center gap-2 px-4 py-3">
                        <h2 className="flex-1 text-sm font-semibold text-gray-200">Chats</h2>
                        <button
                            type="button"
                            onClick={() => setShowResolved((v) => !v)}
                            className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
                        >
                            {showResolved ? 'Hide resolved' : 'Show resolved'}
                        </button>
                    </div>

                    <div className="px-3 pb-3">
                        <div className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-2">
                            <Search className="h-4 w-4 shrink-0 text-gray-500" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search by project or subject"
                                className="w-full bg-transparent text-[13px] text-gray-200 placeholder:text-gray-600 focus:outline-none"
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {loading && <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>}

                        {!loading && visible.length === 0 && (
                            <div className="px-4 py-10 text-center">
                                <MessageSquare className="mx-auto mb-2 h-6 w-6 text-gray-600" />
                                <p className="text-sm text-gray-500">
                                    {search ? 'No conversations match.' : showResolved ? 'No conversations yet.' : 'Nothing needs a reply.'}
                                </p>
                            </div>
                        )}

                        {visible.map((thread) => (
                            <button
                                key={thread.id}
                                type="button"
                                onClick={() => openThread(thread.id)}
                                className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-white/[0.04] ${
                                    openId === thread.id ? 'bg-white/[0.07]' : ''
                                }`}
                            >
                                <Avatar label={thread.client} />

                                <span className="min-w-0 flex-1">
                                    <span className="flex items-baseline gap-2">
                                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-gray-100" title={thread.client}>
                                            {thread.client}
                                        </span>
                                        <span className={`shrink-0 text-[11px] ${thread.unread ? 'text-emerald-300' : 'text-gray-500'}`}>
                                            {listTime(thread.lastMessageAt)}
                                        </span>
                                    </span>

                                    <span className="mt-0.5 flex items-center gap-1.5">
                                        {/* Only when we spoke last — the row tick describes our
                                            message, exactly as the bubble tick does. */}
                                        <Receipt seen={thread.lastSeenByClient} />
                                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-400" title={thread.subject}>
                                            {thread.subject || '(no subject)'}
                                        </span>
                                        {thread.unread ? (
                                            /* The count is UNREAD, not total — a "5" here on a
                                               thread with one new message would be a lie. */
                                            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-500/80 px-1 text-[10px] font-bold text-[#0b0f17]">
                                                {thread.unreadCount > 99 ? '99+' : thread.unreadCount || 1}
                                            </span>
                                        ) : thread.needsReply ? (
                                            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400/80" title="Needs a reply" />
                                        ) : null}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                </aside>

                {/* ── Conversation ── */}
                <section className="flex min-w-0 flex-1 flex-col bg-white/[0.01]">
                    {error && (
                        <p className="border-b border-white/10 bg-amber-500/5 px-5 py-2.5 text-sm text-amber-300">{error}</p>
                    )}

                    {!open && (
                        <div className="flex flex-1 items-center justify-center p-10 text-center">
                            <div className="max-w-sm">
                                <MessageSquare className="mx-auto mb-3 h-8 w-8 text-gray-700" />
                                <p className="text-sm text-gray-400">Choose a conversation to read it.</p>
                                <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                                    Clients appear by project or reference. Names, addresses and phone
                                    numbers are removed before a message reaches this screen.
                                </p>
                            </div>
                        </div>
                    )}

                    {open && (
                        <>
                            {/* Header */}
                            <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
                                <Avatar label={open.client} size="sm" />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-[14px] font-semibold text-gray-100">{open.client}</p>
                                    <p className="truncate text-[11.5px] text-gray-500">{open.subject || '(no subject)'}</p>
                                </div>
                                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[open.status] || 'bg-white/10 text-gray-400'}`}>
                                    {open.status}
                                </span>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => toggleResolved(open.id, !open.resolved)}
                                    title={open.resolved ? 'Reopen this conversation' : 'Mark resolved'}
                                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-50"
                                >
                                    {open.resolved
                                        ? <><RotateCcw className="h-3.5 w-3.5" /> Reopen</>
                                        : <><CheckCircle2 className="h-3.5 w-3.5" /> Resolve</>}
                                </button>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 space-y-1 overflow-y-auto px-4 py-4 md:px-8">
                                {/* The slot WhatsApp gives its encryption notice, used for the
                                    same kind of statement: what the ticks can actually tell you. */}
                                <div className="flex justify-center pb-1">
                                    <span className="max-w-md rounded-md bg-amber-500/[0.07] px-3 py-1.5 text-center text-[10.5px] leading-relaxed text-amber-200/70">
                                        <CheckCheck className="mr-1 inline h-3 w-3" />
                                        Two ticks mean the client opened this in the portal, or replied
                                        after it. Simply reading it in their own email leaves no trace,
                                        so one tick is not proof they haven&apos;t seen it.
                                    </span>
                                </div>

                                {dayGroups.map((group) => (
                                    <div key={group.key} className="space-y-1">
                                        <div className="flex justify-center py-3">
                                            <span className="rounded-md bg-white/[0.07] px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-wide text-gray-400">
                                                {group.day}
                                            </span>
                                        </div>

                                        {group.messages.map((message) => {
                                            const mine = message.direction === 'outbound';
                                            return (
                                                <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                                    {/* Bubbles hug their content and cap at ~68%, which is
                                                        what stops a chat reading like a document. */}
                                                    <div
                                                        className={`relative max-w-[68%] rounded-lg px-3 py-2 text-[13.5px] leading-[1.5] ${
                                                            mine
                                                                ? 'rounded-tr-sm bg-blue-500/15 text-gray-100'
                                                                : 'rounded-tl-sm bg-white/[0.07] text-gray-100'
                                                        }`}
                                                    >
                                                        <p className="whitespace-pre-wrap break-words">
                                                            {message.body || <span className="text-gray-500">(no readable content)</span>}
                                                        </p>

                                                        {message.attachments?.length > 0 && (
                                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                                {message.attachments.map((file, i) => (
                                                                    /*
                                                                        The filename is redacted; the FILE is not.
                                                                        A letterhead or a photographed card still
                                                                        identifies the client — the accepted
                                                                        exception, made concrete here.
                                                                    */
                                                                    <a
                                                                        key={file.id || `${file.name}-${i}`}
                                                                        href={`/app/esf/messages/${open.id}/attachments/${message.id}/${i}`}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="flex items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-white/25 hover:text-gray-100"
                                                                    >
                                                                        <Paperclip className="h-3 w-3" />
                                                                        {file.name || 'Attachment'}
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* Time sits inside the bubble, bottom-right,
                                                            receipt after it — the WhatsApp ordering. */}
                                                        <span
                                                            className="mt-1 flex items-center justify-end gap-1.5 text-[10.5px] text-gray-500"
                                                            title={mine
                                                                ? (message.seenByClient
                                                                    ? 'Opened in the client portal'
                                                                    : 'Sent. Not opened in the portal — opens in their own email are not tracked.')
                                                                : undefined}
                                                        >
                                                            {message.redactedBy === 'deterministic' && (
                                                                <span title="Some detail was removed automatically">limited detail</span>
                                                            )}
                                                            {bubbleTime(message.sentAt)}
                                                            <Receipt seen={message.seenByClient} />
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}

                                {conversation?.messages?.some((m) => m.quotedTrimmed) && (
                                    <p className="pt-2 text-center text-[10.5px] text-gray-600">
                                        Quoted history is trimmed — earlier messages appear above.
                                    </p>
                                )}
                            </div>

                            {/* Composer */}
                            <div className="border-t border-white/10 bg-white/[0.03] px-4 py-3">
                                {/* Chosen files, before sending */}
                                {files.length > 0 && (
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {files.map((file, i) => (
                                            <span
                                                key={`${file.name}-${i}`}
                                                className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-gray-300"
                                            >
                                                <Paperclip className="h-3 w-3 shrink-0" />
                                                <span className="max-w-[180px] truncate">{file.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setFiles((c) => c.filter((_, j) => j !== i))}
                                                    className="text-gray-500 hover:text-gray-200"
                                                    title="Remove"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="flex items-end gap-2 rounded-lg bg-white/[0.05] px-3 py-2">
                                    <label
                                        className="mb-0.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
                                        title="Attach files"
                                    >
                                        <Paperclip className="h-4 w-4" />
                                        <input
                                            type="file"
                                            multiple
                                            hidden
                                            disabled={sending}
                                            onChange={(e) => {
                                                // Capped here as well as server-side, so picking
                                                // ten files says so now rather than after the
                                                // upload finishes.
                                                setFiles((current) => [...current, ...Array.from(e.target.files || [])].slice(0, 5));
                                                e.target.value = '';
                                            }}
                                        />
                                    </label>
                                    <textarea
                                        rows={1}
                                        value={draft}
                                        disabled={sending}
                                        onChange={(e) => setDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            // Enter sends, Shift+Enter breaks the line — the
                                            // convention every chat client shares, and the one
                                            // people's hands already expect.
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                sendReply();
                                            }
                                        }}
                                        placeholder="Write a reply…"
                                        className="max-h-32 w-full resize-none bg-transparent py-1 text-[13.5px] leading-relaxed text-gray-100 placeholder:text-gray-500 focus:outline-none disabled:opacity-50"
                                    />
                                    <button
                                        type="button"
                                        onClick={sendReply}
                                        disabled={sending || !draft.trim()}
                                        title="Send"
                                        className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/80 text-[#0b0f17] transition-opacity hover:bg-emerald-500 disabled:opacity-30"
                                    >
                                        <Send className="h-4 w-4" />
                                    </button>
                                </div>
                                {/*
                                    Said plainly, because it is not obvious from a chat UI:
                                    this reply is a real email leaving the shared inbox, and it
                                    goes out as the agency rather than as the person typing.
                                */}
                                <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[10.5px] text-gray-600">
                                    <Lock className="h-3 w-3 shrink-0" />
                                    Sent by email from the ESF inbox, as eStore Factory — your name is not shown.
                                </p>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
};

export default EsfMessages;

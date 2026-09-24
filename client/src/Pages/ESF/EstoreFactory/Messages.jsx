import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Send, Check, CheckCheck, Clock, MessageSquare } from 'lucide-react';
import axiosInstance from '../../../config/axios.config.js';
import { PALETTE } from '../../../Components/ESF/estoreFactoryTheme.js';
import AttachmentPicker from '../../../Components/ESF/AttachmentPicker.jsx';
import useAutoGrow from '../../../Components/ESF/useAutoGrow.js';
import useConversationPolling from '../../../Components/ESF/useConversationPolling.js';

/**
 * Estore Factory > Messages — the client's own conversations.
 *
 * Real email, not the mock this replaced. A client emails the shared ESF inbox and the
 * exchange appears here; replying from this page joins the same Gmail thread, so their
 * own mail client and this page show the same conversation.
 *
 * ── NO INDIVIDUAL IS EVER NAMED ──
 * Replies are attributed to "eStore Factory", never to the staff member who wrote them —
 * the same rule the Status page applies through redactNames. It is enforced by the API
 * (server/Services/Email/messagePresenter.js), not here.
 *
 * ── AND THE CLIENT SEES THEIR OWN WORDS REDACTED TOO ──
 * A body they wrote comes back with contact details removed, because ONE redacted copy
 * is stored and served to both sides. Keeping a second, raw copy for the client would
 * re-create exactly the unredacted field the design removed. It can look odd to see
 * your own phone number as "[phone]", so the page says why rather than leaving them to
 * wonder whether something went wrong.
 *
 * Laid out like the staff inbox (client/src/Pages/ESF/EsfMessages.jsx) so the two
 * surfaces behave the same way, in this section's own palette. The borrowing is
 * structural, not visual.
 *
 * ── ONE DELIBERATE DIVERGENCE FROM THE STAFF LIST ──
 * A staff row is avatar + CLIENT NAME over subject, because each row is a different
 * client and the name is what tells them apart. Here every conversation is with the
 * same counterparty, so a name line would read "eStore Factory" on every row and carry
 * no information. The subject takes the name slot instead, and the avatar is keyed on
 * the subject for the same reason — the conversation, not the correspondent, is what
 * distinguishes one row from another on this side.
 *
 * The Overview card's open-conversation count used to be exported from here and
 * computed over the mock array. It now comes from the dashboard API as
 * `openMessageCount`, so that card and this page cannot disagree by counting
 * differently.
 */

const STATUS_PILL = {
    'Awaiting your reply': { bg: 'rgba(245,166,35,.13)', color: PALETTE.amberValue },
    Open: { bg: 'rgba(34,197,94,.11)', color: PALETTE.good },
    Resolved: { bg: 'rgba(255,255,255,.06)', color: PALETTE.textTertiary },
};

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

/**
 * The status of a message the CLIENT sent.
 *
 * They had none before: their own messages showed a time and nothing else, so there was
 * no difference on screen between sent, delivered and read. Only their own side gets
 * one — a tick on the agency's message would be telling them whether they themselves
 * had read it.
 */
const ClientReceipt = ({ seen, pending = false }) => {
    /**
     * Real icons rather than the "✓✓" / "🕐" text this used to render. Emoji tick marks
     * pick up the platform's own font, so they sat on a different baseline from the
     * timestamp beside them and rendered at a different weight on Windows — the staff
     * inbox has used lucide icons since it was laid out as a chat client, and the two
     * surfaces showing the same state in two different alphabets is the tell that only
     * one of them was ever finished.
     */
    if (pending) {
        return <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: PALETTE.textMuted }} aria-label="Sending" />;
    }
    if (seen === null || seen === undefined) return null;
    // Two ticks once the team has opened the conversation. A single tick is not proof
    // they have not — it is the absence of evidence either way.
    return seen ? (
        <CheckCheck className="h-3.5 w-3.5 shrink-0" style={{ color: PALETTE.accentLight }} aria-label="Seen by your team" />
    ) : (
        <Check className="h-3.5 w-3.5 shrink-0" style={{ color: PALETTE.textMuted }} aria-label="Sent" />
    );
};

/**
 * Initials and a stable tint for the conversation avatar.
 *
 * Keyed on the SUBJECT, not on a correspondent — see the divergence note in the header.
 * The tint is a hash so a conversation keeps the same colour between loads; it means
 * nothing on its own, it just makes the list scannable at a glance.
 */
const initialsOf = (subject = '') => {
    const words = String(subject).replace(/[^\w\s-]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '—';
    return (words[0][0] + (words[1]?.[0] || '')).toUpperCase();
};

const AVATAR_TINTS = [
    { bg: 'rgba(59,130,246,.20)', color: '#93B4FB' },
    { bg: 'rgba(34,197,94,.20)', color: '#86E0AC' },
    { bg: 'rgba(139,92,246,.20)', color: '#C0ABFA' },
    { bg: 'rgba(245,166,35,.20)', color: '#F5C87A' },
    { bg: 'rgba(244,63,94,.20)', color: '#F9A3B2' },
    { bg: 'rgba(6,182,212,.20)', color: '#8BDDEB' },
];
const tintFor = (key = '') => {
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return AVATAR_TINTS[hash % AVATAR_TINTS.length];
};

const Avatar = ({ subject }) => {
    const tint = tintFor(subject || '');
    return (
        <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
            style={{ background: tint.bg, color: tint.color }}
        >
            {initialsOf(subject)}
        </span>
    );
};

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

const Messages = () => {
    const [threads, setThreads] = useState([]);
    const [search, setSearch] = useState('');
    const [inboxAddress, setInboxAddress] = useState(null);
    const [openId, setOpenId] = useState(null);
    const [conversation, setConversation] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [files, setFiles] = useState([]);
    const composerRef = useAutoGrow(draft);
    const [ticketFiles, setTicketFiles] = useState([]);
    const [ticketOpen, setTicketOpen] = useState(false);
    const [ticketSubject, setTicketSubject] = useState('');
    const [ticketBody, setTicketBody] = useState('');
    const [raising, setRaising] = useState(false);

    const loadThreads = useCallback(async () => {
        try {
            setLoading(true);
            const res = await axiosInstance.get('/api/pagewise/esf/messages');
            setThreads(res.data?.data?.threads || []);
            setInboxAddress(res.data?.data?.inboxAddress || null);
        } catch (err) {
            setError(err.response?.data?.message || 'Could not load your messages');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadThreads(); }, [loadThreads]);

    const openThread = useCallback(async (id) => {
        setOpenId(id);
        setConversation(null);
        setDraft('');
        setFiles([]);
        try {
            const res = await axiosInstance.get(`/api/pagewise/esf/messages/${id}`);
            setConversation(res.data?.data || null);
            // The count goes with the flag — the badge reads unreadCount, so clearing
            // only `unread` would leave a stale "3" behind on the next render that
            // happens to check the count instead.
            setThreads((current) => current.map((t) => (
                t.id === id ? { ...t, unread: false, unreadCount: 0 } : t
            )));
        } catch (err) {
            setError(err.response?.data?.message || 'Could not open that conversation');
        }
    }, []);

    const sendReply = useCallback(async () => {
        const text = draft.trim();
        if (!text || sending || !openId) return;

        setSending(true);

        // Shown immediately, marked pending. Waiting for the round trip left the
        // composer empty and the conversation unchanged, which reads as a failed send.
        const pendingId = `pending-${Date.now()}`;
        setConversation((current) => (current ? {
            ...current,
            messages: [...current.messages, {
                id: pendingId,
                direction: 'inbound',
                author: 'You',
                body: text,
                sentAt: new Date().toISOString(),
                seenByTeam: false,
                pending: true,
                attachments: files.map((f) => ({ name: f.name })),
            }],
        } : current));

        try {
            // multipart, because the body may carry files. Content-Type is left to the
            // browser: setting it by hand drops the boundary and multer sees nothing.
            const form = new FormData();
            form.append('body', text);
            files.forEach((file) => form.append('files', file));
            await axiosInstance.post(`/api/pagewise/esf/messages/${openId}/reply`, form);
            // Cleared only once the request succeeds — clearing optimistically loses
            // what someone just wrote when the send fails, with nowhere to get it back.
            setDraft('');
            setFiles([]);
            const res = await axiosInstance.get(`/api/pagewise/esf/messages/${openId}`);
            setConversation(res.data?.data || null);
            loadThreads();
        } catch (err) {
            // Dropped rather than left on screen: a message that never sent, shown as
            // though it had, is worse than no message.
            setConversation((current) => (current ? {
                ...current,
                messages: current.messages.filter((m) => m.id !== pendingId),
            } : current));
            setError(err.response?.data?.message || 'Could not send that reply');
        } finally {
            setSending(false);
        }
    }, [draft, files, sending, openId, loadThreads]);

    const raiseTicket = useCallback(async () => {
        const subject = ticketSubject.trim();
        const body = ticketBody.trim();
        if (!subject || !body || raising) return;

        setRaising(true);
        setError('');
        try {
            const form = new FormData();
            form.append('subject', subject);
            form.append('body', body);
            ticketFiles.forEach((file) => form.append('files', file));
            const res = await axiosInstance.post('/api/pagewise/esf/messages', form);
            const newId = res.data?.data?.threadId;

            setTicketOpen(false);
            setTicketSubject('');
            setTicketBody('');
            setTicketFiles([]);
            await loadThreads();
            // Drop straight into the conversation they just started, so it is obviously
            // a conversation rather than a form that vanished.
            if (newId) openThread(newId);
        } catch (err) {
            // The server's 4xx messages describe our own rules ("too many open
            // conversations") and are worth showing verbatim.
            setError(err.response?.data?.message || 'Could not raise that ticket');
        } finally {
            setRaising(false);
        }
    }, [ticketSubject, ticketBody, ticketFiles, raising, loadThreads, openThread]);

    // Same reasoning as the staff inbox: a reply from the team arrives by email and
    // lands in the database with nothing telling this page about it.
    useConversationPolling(async () => {
        if (sending || raising) return;
        try {
            if (openId) {
                const res = await axiosInstance.get(`/api/pagewise/esf/messages/${openId}`);
                setConversation(res.data?.data || null);
            }
            const list = await axiosInstance.get('/api/pagewise/esf/messages');
            setThreads(list.data?.data?.threads || []);
        } catch {
            // Transient failures are not worth a banner over a working page.
        }
    }, { enabled: true });

    const open = conversation?.thread;
    const dayGroups = useMemo(() => groupByDay(conversation?.messages || []), [conversation]);

    /**
     * Subject only — there is no correspondent name to search on this side, and the
     * bodies are not in the list payload at all.
     */
    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return threads;
        return threads.filter((t) => (t.subject || '').toLowerCase().includes(needle));
    }, [threads, search]);

    const panel = { background: PALETTE.panel || 'rgba(255,255,255,.02)', borderColor: PALETTE.border };

    return (
        /*
            flex-1 within the layout's own column rather than a viewport calculation.
            The calc had to guess the height of the nav and banner above it, and any
            guess is wrong on some screen — too small leaves a gap under the page, too
            large pushes the composer out of reach. MainPagesLayout marks this route as
            owning its scrolling, so the parent is a definite-height flex column and
            this simply fills it.

            flex-col rather than the default row: as a row item the card below sized to
            its own content and stopped filling the width.
        */
        <div className="flex min-h-0 w-full flex-1 flex-col p-3 md:p-6" style={{ background: PALETTE.bg }}>
            {/* w-full so the max-width is a cap rather than the width — an auto-margined
                flex item sizes to its content otherwise. */}
            <div className="mx-auto flex w-full max-w-[1600px] flex-1 overflow-hidden rounded-xl border" style={panel}>

                {/* Conversation list */}
                {/*
                    One pane at a time on a phone — two fixed panes on a narrow screen
                    leave a conversation too thin to read.
                */}
                <aside
                    className={`${openId ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col md:w-[300px] md:max-w-[360px] md:border-r lg:w-[360px]`}
                    style={{ borderColor: PALETTE.border }}
                >
                    <div className="px-4 py-3">
                        <div className="flex items-center gap-2">
                            <h2 className="flex-1 text-sm font-semibold" style={{ color: PALETTE.textPrimary }}>Messages</h2>
                            <button
                                type="button"
                                onClick={() => setTicketOpen(true)}
                                className="rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-opacity hover:opacity-90"
                                style={{ background: PALETTE.good, color: PALETTE.bg }}
                            >
                                + Raise a ticket
                            </button>
                        </div>
                        {/*
                            Emailing in still works and always will — a ticket raised here
                            lands in the same inbox as a conversation. Worth saying, so
                            someone who already emailed does not think they used the wrong
                            channel.
                        */}
                        {inboxAddress && (
                            <p className="mt-1 text-[11px]" style={{ color: PALETTE.textTertiary }}>
                                Or email {inboxAddress} — both arrive in the same place
                            </p>
                        )}
                    </div>

                    <div className="px-3 pb-3">
                        <div
                            className="flex items-center gap-2 rounded-lg px-3 py-2"
                            style={{ background: 'rgba(255,255,255,.06)' }}
                        >
                            <Search className="h-4 w-4 shrink-0" style={{ color: PALETTE.textMuted }} />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search conversations"
                                className="w-full bg-transparent text-[13px] focus:outline-none"
                                style={{ color: PALETTE.textPrimary }}
                            />
                        </div>
                    </div>

                    <div className="flex flex-1 flex-col overflow-y-auto">
                        {loading && (
                            <p className="flex flex-1 items-center justify-center py-6 text-sm" style={{ color: PALETTE.textTertiary }}>Loading…</p>
                        )}

                        {!loading && visible.length === 0 && (
                            <div className="flex flex-1 items-center justify-center px-4 py-10 text-center">
                                <div>
                                    <MessageSquare className="mx-auto mb-2 h-6 w-6" style={{ color: PALETTE.textMuted }} />
                                    <p className="text-sm" style={{ color: PALETTE.textTertiary }}>
                                        {search ? 'No conversations match.' : 'No conversations yet.'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {visible.map((thread) => {
                            const pill = STATUS_PILL[thread.status] || STATUS_PILL.Open;
                            return (
                                <button
                                    key={thread.id}
                                    type="button"
                                    onClick={() => openThread(thread.id)}
                                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-white/[0.035]"
                                    style={openId === thread.id ? { background: 'rgba(255,255,255,.06)' } : undefined}
                                >
                                    <Avatar subject={thread.subject} />

                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-baseline gap-2">
                                            <span
                                                className="min-w-0 flex-1 truncate text-[13.5px] font-medium"
                                                style={{ color: PALETTE.textPrimary }}
                                                title={thread.subject}
                                            >
                                                {thread.subject || '(no subject)'}
                                            </span>
                                            <span
                                                className="shrink-0 text-[11px]"
                                                style={{ color: thread.unread ? PALETTE.good : PALETTE.textTertiary }}
                                            >
                                                {listTime(thread.lastMessageAt)}
                                            </span>
                                        </span>

                                        <span className="mt-0.5 flex items-center gap-1.5">
                                            {/* Only when THEY spoke last — the row tick describes
                                                their own message, exactly as the bubble tick does. */}
                                            <ClientReceipt seen={thread.lastSeenByTeam} />
                                            <span
                                                className="shrink-0 truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium"
                                                style={{ background: pill.bg, color: pill.color }}
                                            >
                                                {thread.status}
                                            </span>
                                            {thread.unread && (
                                                /* The count is UNREAD, not total — a "5" here on a
                                                   thread with one new message would be a lie. */
                                                <span
                                                    className="ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                                                    style={{ background: PALETTE.good, color: PALETTE.bg }}
                                                >
                                                    {thread.unreadCount > 99 ? '99+' : thread.unreadCount || 1}
                                                </span>
                                            )}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </aside>

                {/* Conversation */}
                <section className={`${openId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
                    {error && (
                        <p className="border-b px-5 py-2.5 text-sm" style={{ borderColor: PALETTE.border, color: PALETTE.amberValue }}>
                            {error}
                        </p>
                    )}

                    {!open && (
                        <div className="flex flex-1 items-center justify-center p-10 text-center">
                            <p className="max-w-sm text-sm" style={{ color: PALETTE.textTertiary }}>
                                Choose a conversation to read it.
                            </p>
                        </div>
                    )}

                    {open && (
                        <>
                            <div
                                className="flex items-center gap-3 border-b px-3 py-2.5 md:px-4"
                                style={{ borderColor: PALETTE.border }}
                            >
                                <button
                                    type="button"
                                    onClick={() => { setOpenId(null); setConversation(null); }}
                                    className="-ml-1 shrink-0 rounded-lg px-1.5 py-1 text-[16px] leading-none md:hidden"
                                    style={{ color: PALETTE.textTertiary }}
                                    aria-label="Back to conversations"
                                >
                                    ←
                                </button>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-[14px] font-semibold" style={{ color: PALETTE.textPrimary }}>
                                        {open.subject || '(no subject)'}
                                    </p>
                                    <p className="text-[11.5px]" style={{ color: PALETTE.textTertiary }}>
                                        {open.messageCount} message{open.messageCount === 1 ? '' : 's'}
                                    </p>
                                </div>
                                <span
                                    className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium"
                                    style={STATUS_PILL[open.status]
                                        ? { background: STATUS_PILL[open.status].bg, color: STATUS_PILL[open.status].color }
                                        : undefined}
                                >
                                    {open.status}
                                </span>
                            </div>

                            <div className="flex-1 space-y-1 overflow-y-auto px-3 py-4 sm:px-4 md:px-8">
                                {dayGroups.map((group) => (
                                    <div key={group.key} className="space-y-1">
                                        <div className="flex justify-center py-3">
                                            <span
                                                className="rounded px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-wide"
                                                style={{ background: 'rgba(255,255,255,.06)', color: PALETTE.textTertiary }}
                                            >
                                                {group.day}
                                            </span>
                                        </div>

                                        {group.messages.map((message) => {
                                            const mine = message.direction === 'inbound';
                                            return (
                                                <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                                    <div
                                                        className={`max-w-[85%] rounded-lg px-3 py-2 text-[13.5px] leading-[1.5] sm:max-w-[68%] ${
                                                            mine ? 'rounded-tr-sm' : 'rounded-tl-sm'
                                                        }`}
                                                        style={{
                                                            background: mine ? 'rgba(59,130,246,.14)' : 'rgba(255,255,255,.06)',
                                                            color: PALETTE.textPrimary,
                                                        }}
                                                    >
                                                        {/* "eStore Factory", never a person. */}
                                                        {!mine && (
                                                            <p className="mb-1 text-[10.5px] font-semibold" style={{ color: PALETTE.textTertiary }}>
                                                                {message.author}
                                                            </p>
                                                        )}
                                                        <p className="whitespace-pre-wrap break-words">{message.body}</p>

                                                        {message.attachments?.length > 0 && (
                                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                                {message.attachments.map((file, i) => (
                                                                    <a
                                                                        key={file.id || `${file.name}-${i}`}
                                                                        href={`/api/pagewise/esf/messages/${open.id}/attachments/${message.id}/${i}`}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="rounded px-2 py-1 text-[11px] underline-offset-2 hover:underline"
                                                                        style={{ background: 'rgba(0,0,0,.25)', color: PALETTE.textSecondary }}
                                                                    >
                                                                        {file.name || 'Attachment'}
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        )}

                                                        <span
                                                            className="mt-1 flex items-center justify-end gap-1.5 text-[10.5px]"
                                                            style={{ color: PALETTE.textTertiary }}
                                                        >
                                                            {bubbleTime(message.sentAt)}
                                                            {mine && (
                                                                <ClientReceipt seen={message.seenByTeam} pending={message.pending} />
                                                            )}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>

                            <div className="border-t px-4 py-3" style={{ borderColor: PALETTE.border }}>
                                <div className="mb-2">
                                    <AttachmentPicker
                                        files={files}
                                        onChange={setFiles}
                                        disabled={sending}
                                        tone="client"
                                    />
                                </div>
                                <div
                                    className="flex items-end gap-2 rounded-lg px-3 py-2"
                                    style={{ background: 'rgba(255,255,255,.05)' }}
                                >
                                    <textarea
                                        ref={composerRef}
                                        rows={1}
                                        value={draft}
                                        disabled={sending}
                                        onChange={(e) => setDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                sendReply();
                                            }
                                        }}
                                        placeholder="Write a reply…"
                                        className="w-full resize-none bg-transparent py-1 text-[13.5px] leading-relaxed focus:outline-none disabled:opacity-50"
                                        style={{ color: PALETTE.textPrimary }}
                                    />
                                    <button
                                        type="button"
                                        onClick={sendReply}
                                        disabled={sending || !draft.trim()}
                                        title="Send"
                                        aria-label="Send"
                                        className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-90 disabled:opacity-30"
                                        style={{ background: PALETTE.good, color: PALETTE.bg }}
                                    >
                                        <Send className="h-4 w-4" />
                                    </button>
                                </div>
                                {/*
                                    Said plainly: seeing your own phone number come back as
                                    "[phone]" looks like a bug unless you know why. One copy
                                    of each message is stored and served to both sides — a
                                    second raw copy for the client would re-create the
                                    unredacted field this design removed on purpose.
                                */}
                                <p className="mt-1.5 px-1 text-[10.5px]" style={{ color: PALETTE.textTertiary }}>
                                    Contact details are removed from messages on both sides, so some of your
                                    own wording may appear shortened here.
                                </p>
                            </div>
                        </>
                    )}
                </section>
            </div>

            {/* Raise a ticket */}
            {ticketOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'rgba(0,0,0,.6)' }}
                    onClick={() => !raising && setTicketOpen(false)}
                >
                    <div
                        className="w-full max-w-lg rounded-xl border p-5"
                        style={{ background: PALETTE.bg, borderColor: PALETTE.border }}
                        // Without this, a click anywhere inside the form bubbles up to the
                        // backdrop and closes the dialog mid-sentence.
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-[15px] font-semibold" style={{ color: PALETTE.textPrimary }}>
                            Raise a ticket
                        </h3>
                        <p className="mt-1 text-[11.5px]" style={{ color: PALETTE.textTertiary }}>
                            This starts a conversation with your account team. It stays open until
                            they resolve it, and you can keep replying in the meantime.
                        </p>

                        <label className="mt-4 block text-[11.5px] font-medium" style={{ color: PALETTE.textSecondary }}>
                            Subject
                        </label>
                        <input
                            value={ticketSubject}
                            disabled={raising}
                            maxLength={150}
                            onChange={(e) => setTicketSubject(e.target.value)}
                            placeholder="Short summary of the issue"
                            className="mt-1 w-full rounded-lg px-3 py-2 text-[13.5px] focus:outline-none disabled:opacity-50"
                            style={{ background: 'rgba(255,255,255,.05)', color: PALETTE.textPrimary }}
                        />

                        <label className="mt-3 block text-[11.5px] font-medium" style={{ color: PALETTE.textSecondary }}>
                            What is happening?
                        </label>
                        <textarea
                            rows={5}
                            value={ticketBody}
                            disabled={raising}
                            onChange={(e) => setTicketBody(e.target.value)}
                            placeholder="Describe the issue. Include ASINs or order IDs if they help."
                            className="mt-1 w-full resize-none rounded-lg px-3 py-2 text-[13.5px] leading-relaxed focus:outline-none disabled:opacity-50"
                            style={{ background: 'rgba(255,255,255,.05)', color: PALETTE.textPrimary }}
                        />

                        <label className="mt-3 block text-[11.5px] font-medium" style={{ color: PALETTE.textSecondary }}>
                            Attachments (optional)
                        </label>
                        <div className="mt-1">
                            <AttachmentPicker
                                files={ticketFiles}
                                onChange={setTicketFiles}
                                disabled={raising}
                                tone="client"
                            />
                        </div>

                        {/*
                            Said before they type it rather than after: contact details get
                            stripped, so leaving a phone number here does not reach anyone.
                            Finding that out afterwards, having waited for a call, would be
                            considerably worse.
                        */}
                        <p className="mt-2 text-[10.5px]" style={{ color: PALETTE.textTertiary }}>
                            Contact details are removed automatically — your team will reply in this
                            conversation and by email.
                        </p>

                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                disabled={raising}
                                onClick={() => setTicketOpen(false)}
                                className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
                                style={{ color: PALETTE.textSecondary }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={raiseTicket}
                                disabled={raising || !ticketSubject.trim() || !ticketBody.trim()}
                                className="rounded-lg px-4 py-1.5 text-[12.5px] font-semibold transition-opacity disabled:opacity-30"
                                style={{ background: PALETTE.good, color: PALETTE.bg }}
                            >
                                {raising ? 'Sending…' : 'Raise ticket'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Messages;

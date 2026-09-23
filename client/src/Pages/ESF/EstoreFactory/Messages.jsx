import { useCallback, useEffect, useMemo, useState } from 'react';
import axiosInstance from '../../../config/axios.config.js';
import { PALETTE } from '../../../Components/ESF/estoreFactoryTheme.js';

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
 * surfaces behave the same way, in this section's own palette.
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
    const [inboxAddress, setInboxAddress] = useState(null);
    const [openId, setOpenId] = useState(null);
    const [conversation, setConversation] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);

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
        try {
            const res = await axiosInstance.get(`/api/pagewise/esf/messages/${id}`);
            setConversation(res.data?.data || null);
            setThreads((current) => current.map((t) => (t.id === id ? { ...t, unread: false } : t)));
        } catch (err) {
            setError(err.response?.data?.message || 'Could not open that conversation');
        }
    }, []);

    const sendReply = useCallback(async () => {
        const text = draft.trim();
        if (!text || sending || !openId) return;

        setSending(true);
        try {
            await axiosInstance.post(`/api/pagewise/esf/messages/${openId}/reply`, { body: text });
            // Cleared only once the request succeeds — clearing optimistically loses
            // what someone just wrote when the send fails, with nowhere to get it back.
            setDraft('');
            const res = await axiosInstance.get(`/api/pagewise/esf/messages/${openId}`);
            setConversation(res.data?.data || null);
            loadThreads();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not send that reply');
        } finally {
            setSending(false);
        }
    }, [draft, sending, openId, loadThreads]);

    const open = conversation?.thread;
    const dayGroups = useMemo(() => groupByDay(conversation?.messages || []), [conversation]);

    const panel = { background: PALETTE.panel || 'rgba(255,255,255,.02)', borderColor: PALETTE.border };

    return (
        <div className="h-[calc(100vh-150px)] w-full p-4 md:p-6" style={{ background: PALETTE.bg }}>
            <div className="mx-auto flex h-full max-w-[1600px] overflow-hidden rounded-xl border" style={panel}>

                {/* Conversation list */}
                <aside
                    className="flex w-full max-w-[360px] shrink-0 flex-col border-r"
                    style={{ borderColor: PALETTE.border }}
                >
                    <div className="px-4 py-3">
                        <h2 className="text-sm font-semibold" style={{ color: PALETTE.textPrimary }}>Messages</h2>
                        {/*
                            The client cannot start a thread from here in v1, so the page
                            says how to start one rather than offering a button that is
                            not there.
                        */}
                        {inboxAddress && (
                            <p className="mt-0.5 text-[11px]" style={{ color: PALETTE.textTertiary }}>
                                Email {inboxAddress} to start a new conversation
                            </p>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {loading && (
                            <p className="px-4 py-6 text-sm" style={{ color: PALETTE.textTertiary }}>Loading…</p>
                        )}

                        {!loading && threads.length === 0 && (
                            <p className="px-4 py-10 text-center text-sm" style={{ color: PALETTE.textTertiary }}>
                                No conversations yet.
                            </p>
                        )}

                        {threads.map((thread) => {
                            const pill = STATUS_PILL[thread.status] || STATUS_PILL.Open;
                            return (
                                <button
                                    key={thread.id}
                                    type="button"
                                    onClick={() => openThread(thread.id)}
                                    className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-white/[0.035]"
                                    style={openId === thread.id ? { background: 'rgba(255,255,255,.06)' } : undefined}
                                >
                                    <span className="flex items-baseline gap-2">
                                        <span
                                            className="min-w-0 flex-1 truncate text-[13.5px] font-medium"
                                            style={{ color: PALETTE.textPrimary }}
                                        >
                                            {thread.subject || '(no subject)'}
                                        </span>
                                        <span className="shrink-0 text-[11px]" style={{ color: PALETTE.textTertiary }}>
                                            {listTime(thread.lastMessageAt)}
                                        </span>
                                    </span>
                                    <span className="flex items-center gap-2">
                                        <span
                                            className="rounded px-1.5 py-0.5 text-[10.5px] font-medium"
                                            style={{ background: pill.bg, color: pill.color }}
                                        >
                                            {thread.status}
                                        </span>
                                        {thread.unread && (
                                            <span className="h-2 w-2 rounded-full" style={{ background: PALETTE.good }} />
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </aside>

                {/* Conversation */}
                <section className="flex min-w-0 flex-1 flex-col">
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
                                className="flex items-center gap-3 border-b px-4 py-2.5"
                                style={{ borderColor: PALETTE.border }}
                            >
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

                            <div className="flex-1 space-y-1 overflow-y-auto px-4 py-4 md:px-8">
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
                                                        className={`max-w-[68%] rounded-lg px-3 py-2 text-[13.5px] leading-[1.5] ${
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
                                                                {message.attachments.map((file) => (
                                                                    <span
                                                                        key={file.id || file.name}
                                                                        className="rounded px-2 py-1 text-[11px]"
                                                                        style={{ background: 'rgba(0,0,0,.25)', color: PALETTE.textSecondary }}
                                                                    >
                                                                        {file.name || 'Attachment'}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        <span
                                                            className="mt-1 block text-right text-[10.5px]"
                                                            style={{ color: PALETTE.textTertiary }}
                                                        >
                                                            {bubbleTime(message.sentAt)}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>

                            <div className="border-t px-4 py-3" style={{ borderColor: PALETTE.border }}>
                                <div
                                    className="flex items-end gap-2 rounded-lg px-3 py-2"
                                    style={{ background: 'rgba(255,255,255,.05)' }}
                                >
                                    <textarea
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
                                        className="max-h-32 w-full resize-none bg-transparent py-1 text-[13.5px] leading-relaxed focus:outline-none disabled:opacity-50"
                                        style={{ color: PALETTE.textPrimary }}
                                    />
                                    <button
                                        type="button"
                                        onClick={sendReply}
                                        disabled={sending || !draft.trim()}
                                        className="mb-0.5 shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-opacity disabled:opacity-30"
                                        style={{ background: PALETTE.good, color: PALETTE.bg }}
                                    >
                                        Send
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
        </div>
    );
};

export default Messages;

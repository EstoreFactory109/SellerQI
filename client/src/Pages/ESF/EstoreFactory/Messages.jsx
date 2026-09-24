import { useCallback, useEffect, useMemo, useState } from 'react';
import axiosInstance from '../../../config/axios.config.js';
import { PALETTE } from '../../../Components/ESF/estoreFactoryTheme.js';
import AttachmentPicker from '../../../Components/ESF/AttachmentPicker.jsx';

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
    const [files, setFiles] = useState([]);
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

    const open = conversation?.thread;
    const dayGroups = useMemo(() => groupByDay(conversation?.messages || []), [conversation]);

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

                    <div className="flex flex-1 flex-col overflow-y-auto">
                        {loading && (
                            <p className="flex flex-1 items-center justify-center py-6 text-sm" style={{ color: PALETTE.textTertiary }}>Loading…</p>
                        )}

                        {!loading && threads.length === 0 && (
                            <div className="flex flex-1 items-center justify-center px-4 py-10 text-center">
                                <p className="text-sm" style={{ color: PALETTE.textTertiary }}>
                                    No conversations yet.
                                </p>
                            </div>
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

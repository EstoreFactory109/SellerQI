import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, CheckCircle2, RotateCcw } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

/**
 * "Estore Factory" section > Messages — the staff inbox.
 *
 * Client email, answered from inside the portal. The page title comes from
 * PAGE_TITLES in EsfLayout, matching EsfClients/EsfUsers, so no local heading.
 *
 * ── THE CLIENT IS NEVER NAMED HERE ──
 * A conversation is labelled with the client's Zoho project, else their brand, else a
 * stored reference like "EF-1184" — never their name, address or phone. That is not a
 * presentational choice this page is free to revisit: the API does not send those
 * fields at all (server/Services/Email/messagePresenter.js), message bodies arrive
 * already redacted, and a runtime scan rejects a payload containing anything
 * address- or phone-shaped. If you find yourself wanting the client's name on this
 * screen, the answer is in the plan, not in this file.
 *
 * Known and accepted exception: attachment CONTENTS are not redactable — a PDF
 * letterhead or a photographed business card identifies the sender — and staff can
 * still download them.
 */
const CARD = 'rounded-xl border border-white/10 bg-white/[0.03]';

const STATUS_STYLE = {
    'Needs a reply': 'bg-amber-500/15 text-amber-300',
    'Waiting on client': 'bg-white/10 text-gray-300',
    Resolved: 'bg-emerald-500/15 text-emerald-300',
};

const relativeTime = (value) => {
    if (!value) return '';
    const then = new Date(value);
    if (Number.isNaN(then.getTime())) return '';
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    if (mins < 2880) return 'yesterday';
    if (mins < 10080) return `${Math.round(mins / 1440)}d ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const StatusPill = ({ status }) => (
    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status] || 'bg-white/10 text-gray-300'}`}>
        {status}
    </span>
);

const EsfMessages = () => {
    const [threads, setThreads] = useState([]);
    const [openId, setOpenId] = useState(null);
    const [conversation, setConversation] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showResolved, setShowResolved] = useState(false);
    const [busy, setBusy] = useState(false);

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
        try {
            const res = await axiosInstance.get(`/app/esf/messages/${id}`);
            setConversation(res.data?.data || null);
            // Opening clears the staff unread flag server-side; mirror it here so the
            // dot clears without refetching the whole list.
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
                    // Resolving from the default view removes it from the list, which
                    // is the point of the view.
                    : current.filter((t) => t.id !== id || !resolved)
            ));
            setConversation((c) => (c && c.thread.id === id ? { ...c, thread: updated } : c));
        } catch (err) {
            setError(err.response?.data?.message || 'Could not update that conversation');
        } finally {
            setBusy(false);
        }
    }, [showResolved]);

    const open = conversation?.thread;

    return (
        <div className="relative min-h-full w-full overflow-hidden bg-[#0b0f17] p-4 md:p-6">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_30%)]" />

            <div className="relative max-w-[1600px] w-full grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">

                {/* Conversation list */}
                <section className={`${CARD} flex flex-col overflow-hidden`} style={{ maxHeight: 'calc(100vh - 150px)' }}>
                    <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                        <h2 className="flex-1 text-sm font-semibold text-gray-200">Conversations</h2>
                        <button
                            type="button"
                            onClick={() => setShowResolved((v) => !v)}
                            className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-400 hover:text-gray-200 hover:bg-white/5"
                        >
                            {showResolved ? 'Hide resolved' : 'Show resolved'}
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {loading && <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>}

                        {!loading && threads.length === 0 && (
                            <div className="px-4 py-8 text-center">
                                <MessageSquare className="mx-auto mb-2 h-6 w-6 text-gray-600" />
                                <p className="text-sm text-gray-500">
                                    {showResolved ? 'No conversations yet.' : 'Nothing needs a reply.'}
                                </p>
                            </div>
                        )}

                        {threads.map((thread) => (
                            <button
                                key={thread.id}
                                type="button"
                                onClick={() => openThread(thread.id)}
                                className={`w-full border-b border-white/5 px-4 py-3 text-left transition-colors hover:bg-white/5 ${
                                    openId === thread.id ? 'bg-white/[0.06]' : ''
                                }`}
                            >
                                <div className="flex items-start gap-2">
                                    {/* The label, never a person. */}
                                    <span className="flex-1 truncate text-[13px] font-medium text-gray-200" title={thread.client}>
                                        {thread.client}
                                    </span>
                                    {thread.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-400" />}
                                </div>
                                <p className="mt-0.5 truncate text-xs text-gray-400" title={thread.subject}>
                                    {thread.subject || '(no subject)'}
                                </p>
                                <div className="mt-1.5 flex items-center gap-2">
                                    <StatusPill status={thread.status} />
                                    <span className="text-[11px] text-gray-500">{relativeTime(thread.lastMessageAt)}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>

                {/* Conversation detail */}
                <section className={`${CARD} flex flex-col overflow-hidden`} style={{ maxHeight: 'calc(100vh - 150px)' }}>
                    {error && <p className="border-b border-white/10 px-5 py-3 text-sm text-amber-300">{error}</p>}

                    {!open && (
                        <div className="flex flex-1 items-center justify-center p-10 text-center">
                            <div>
                                <MessageSquare className="mx-auto mb-3 h-7 w-7 text-gray-600" />
                                <p className="text-sm text-gray-500">Choose a conversation to read it.</p>
                                <p className="mt-1 text-xs text-gray-600">
                                    Clients are shown by project or reference — never by name.
                                </p>
                            </div>
                        </div>
                    )}

                    {open && (
                        <>
                            <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
                                <div className="min-w-0 flex-1">
                                    <h2 className="truncate text-base font-semibold text-gray-100">
                                        {open.subject || '(no subject)'}
                                    </h2>
                                    <p className="mt-0.5 truncate text-xs text-gray-400">{open.client}</p>
                                </div>
                                <StatusPill status={open.status} />
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => toggleResolved(open.id, !open.resolved)}
                                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/5 disabled:opacity-50"
                                >
                                    {open.resolved
                                        ? <><RotateCcw className="h-3.5 w-3.5" /> Reopen</>
                                        : <><CheckCircle2 className="h-3.5 w-3.5" /> Resolve</>}
                                </button>
                            </div>

                            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                                {conversation.messages.map((message) => (
                                    <div key={message.id} className={message.direction === 'inbound' ? '' : 'pl-8'}>
                                        <div className="mb-1 flex items-center gap-2">
                                            <span className="text-[11px] font-semibold text-gray-300">{message.author}</span>
                                            <span className="text-[11px] text-gray-500">{relativeTime(message.sentAt)}</span>
                                            {/* Said plainly: a message that lost detail to the
                                                deterministic fallback reads thinly, and a staff
                                                member should know that is why rather than assume
                                                the client was terse. */}
                                            {message.redactedBy === 'deterministic' && (
                                                <span className="text-[10px] text-gray-600">limited detail</span>
                                            )}
                                        </div>
                                        <div className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
                                            message.direction === 'inbound'
                                                ? 'bg-white/[0.05] text-gray-200'
                                                : 'bg-blue-500/10 text-gray-200'
                                        }`}>
                                            {message.body || <span className="text-gray-500">(no readable content)</span>}
                                        </div>

                                        {message.quotedTrimmed && (
                                            <p className="mt-1 text-[10px] text-gray-600">Earlier messages in this thread are above.</p>
                                        )}

                                        {message.attachments?.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {message.attachments.map((file) => (
                                                    <span
                                                        key={file.id || file.name}
                                                        className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-300"
                                                    >
                                                        {file.name || 'Attachment'}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Reply lands in a later phase — the send path needs the Gmail
                                connection, which is not wired yet. Saying so is better than a
                                box that looks like it works. */}
                            <div className="border-t border-white/10 px-5 py-3">
                                <p className="text-xs text-gray-500">
                                    Replying from here arrives with Gmail sending — not connected yet.
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

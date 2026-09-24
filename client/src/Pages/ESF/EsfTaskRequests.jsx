import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Check, X, Trash2, Paperclip, AlertTriangle, Sparkles, MessageSquare, Search } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

/**
 * Task Requests — work clients have asked for, awaiting a decision.
 *
 * Accepting one creates a real task in that client's linked Zoho project, which is why
 * the whole page is owner/admin only. A member gets a 403 from every endpoint behind it,
 * not just a hidden nav item.
 *
 * ── THE CLIENT IS NAMED BY PROJECT, NOT BY PERSON ──
 * Same rule as the Messages page. The API sends the Zoho project, else brand, else a
 * stored reference, and the description arrives already redacted — this file could not
 * show a name or phone number even by mistake, because it never receives one.
 *
 * Known exception, unchanged from Messages: attachment CONTENTS are not redactable. A
 * letterhead or a photographed business card identifies the client whatever we do to the
 * filename, and these are downloadable here.
 */

const STATUS_STYLE = {
    pending: 'bg-amber-500/15 text-amber-300',
    accepted: 'bg-emerald-500/15 text-emerald-300',
    rejected: 'bg-white/10 text-gray-400',
};

const dateLabel = (value) => (value
    ? new Date(value).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : null);

const EsfTaskRequests = () => {
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showDecided, setShowDecided] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [rejectingId, setRejectingId] = useState(null);
    const [reason, setReason] = useState('');
    const [search, setSearch] = useState('');

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const res = await axiosInstance.get('/app/esf/task-requests', {
                params: showDecided ? { decided: 'true' } : {},
            });
            setRequests(res.data?.data?.requests || []);
        } catch (err) {
            setError(err.response?.data?.message || 'Could not load task requests');
        } finally {
            setLoading(false);
        }
    }, [showDecided]);

    useEffect(() => { load(); }, [load]);

    const act = useCallback(async (id, run) => {
        setBusyId(id);
        setError('');
        try {
            await run();
            await load();
        } catch (err) {
            // The server's 4xx are actionable here — "this client is not linked to a
            // Zoho project" tells the admin exactly what to go and fix.
            setError(err.response?.data?.message || 'Could not update that request');
        } finally {
            setBusyId(null);
        }
    }, [load]);

    const accept = (id) => act(id, () => axiosInstance.patch(`/app/esf/task-requests/${id}/accept`));

    const reject = (id) => act(id, async () => {
        await axiosInstance.patch(`/app/esf/task-requests/${id}/reject`, { reason: reason.trim() });
        setRejectingId(null);
        setReason('');
    });

    const remove = (id) => act(id, () => axiosInstance.delete(`/app/esf/task-requests/${id}`));

    /**
     * Filtered here rather than server-side, over data already redacted.
     *
     * A search that ran over the stored text would be a de-anonymisation oracle — type a
     * name, see which client comes back — and the whole page exists to keep that shut.
     * The list is capped at 100 anyway, so there is nothing to gain by moving it.
     */
    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return requests;
        return requests.filter((r) => `${r.client} ${r.title} ${r.description}`.toLowerCase().includes(needle));
    }, [requests, search]);

    const dismiss = (id) => act(id, () => axiosInstance.patch(`/app/esf/task-requests/${id}/dismiss-suggestion`));

    return (
        /*
            min-h-full plus a viewport floor: the parent <main> is a flex child, so a
            percentage height does not always resolve, and without the floor an empty
            queue drew a short card against a tall expanse of background.
        */
        <div className="flex min-h-full w-full flex-col p-4 md:p-6">
            <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col">

                <div className="mb-4 flex flex-wrap items-center gap-3">
                    <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-2">
                        <Search className="h-4 w-4 shrink-0 text-gray-500" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by brand, project or what was asked for"
                            className="w-full bg-transparent text-[13px] text-gray-200 placeholder:text-gray-600 focus:outline-none"
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => setSearch('')}
                                className="shrink-0 text-gray-500 hover:text-gray-300"
                                aria-label="Clear search"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    <p className="shrink-0 text-sm text-gray-400">
                        {loading
                            ? 'Loading…'
                            : search
                                ? `${visible.length} of ${requests.length}`
                                : `${requests.length} request${requests.length === 1 ? '' : 's'}`}
                    </p>
                    <button
                        type="button"
                        onClick={() => setShowDecided((v) => !v)}
                        className="rounded-md px-2.5 py-1.5 text-[11.5px] font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
                    >
                        {showDecided ? 'Show pending only' : 'Show decided too'}
                    </button>
                </div>

                {error && (
                    <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-300">
                        {error}
                    </p>
                )}

                {!loading && visible.length === 0 && search && (
                    <div className="flex min-h-[40vh] flex-1 items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] px-6 text-center">
                        <p className="text-sm text-gray-500">
                            Nothing matches “{search}”.
                        </p>
                    </div>
                )}

                {!loading && requests.length === 0 && (
                    <div className="flex min-h-[55vh] flex-1 items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] px-6 py-10 text-center">
                        <div>
                            <ClipboardList className="mx-auto mb-3 h-8 w-8 text-gray-700" />
                            <p className="text-sm text-gray-400">
                                {showDecided ? 'No task requests yet.' : 'Nothing waiting on a decision.'}
                            </p>
                            {/* Says where they come from, so an empty queue reads as
                                "nothing to do" rather than "this page is broken". */}
                            <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-gray-600">
                                Requests appear here when a client submits one from their Status
                                page, or when one is recognised in a message they send.
                            </p>
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="flex min-h-[55vh] flex-1 items-center justify-center rounded-xl border border-white/10 bg-white/[0.02]">
                        <p className="text-sm text-gray-500">Loading…</p>
                    </div>
                )}

                <div className="space-y-3">
                    {visible.map((request) => (
                        <div
                            key={request.id}
                            className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                        >
                            <div className="flex flex-wrap items-start gap-3">
                                <div className="min-w-0 flex-1">
                                    <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold text-gray-100">
                                        {request.title}
                                        {/*
                                            Said plainly, because it changes how carefully
                                            this should be read: a model wrote this summary
                                            from an email, and the link goes to the message
                                            so that can be checked rather than trusted.
                                        */}
                                        {request.source === 'ai' && (
                                            <span
                                                className="inline-flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-violet-300"
                                                title={request.aiConfidence
                                                    ? `Read from a message, ${Math.round(request.aiConfidence * 100)}% confidence`
                                                    : 'Read from a message'}
                                            >
                                                <Sparkles className="h-3 w-3" />
                                                From a message
                                            </span>
                                        )}
                                    </p>
                                    <p className="mt-0.5 text-[12px] text-gray-500">
                                        {request.client}
                                        {request.neededBy ? ` · needed by ${dateLabel(request.neededBy)}` : ''}
                                        {request.requestedAt ? ` · asked ${dateLabel(request.requestedAt)}` : ''}
                                    </p>
                                </div>
                                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[request.status]}`}>
                                    {request.status}
                                </span>
                            </div>

                            <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-300">
                                {request.description || <span className="text-gray-500">(no description)</span>}
                            </p>

                            {request.attachments?.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {request.attachments.map((file) => (
                                        /*
                                            The filename is redacted; the FILE is not. A
                                            letterhead still identifies the client — the
                                            accepted exception, made concrete here.
                                        */
                                        <a
                                            key={file.index}
                                            href={`/app/esf/task-requests/${request.id}/attachments/${file.index}`}
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

                            {/*
                                Warned here rather than at the moment of clicking Accept,
                                because the fix is on another page and the Zoho call would
                                otherwise fail with nothing this screen can do about it.
                            */}
                            {request.status === 'pending' && !request.clientHasProject && (
                                <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-amber-300/80">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    This client has no linked Zoho project, so there is nowhere to create
                                    the task. Link one on the Clients page first.
                                </p>
                            )}

                            {request.status === 'rejected' && request.rejectionReason && (
                                <p className="mt-3 rounded-md bg-white/[0.04] px-3 py-2 text-[12px] text-gray-400">
                                    Declined: {request.rejectionReason}
                                </p>
                            )}

                            {request.status === 'accepted' && request.zohoTaskId && (
                                <p className="mt-3 text-[11.5px] text-emerald-300/70">
                                    Created in Zoho as task {request.zohoTaskId}. It appears on the client&apos;s
                                    Status page once the project finishes re-syncing.
                                </p>
                            )}

                            {/*
                                A decision the AI read in the conversation, deliberately NOT
                                applied. Accepting creates a real task in the live Zoho
                                portal, so the model stages and a human authorises — which is
                                the approval gate this would otherwise walk straight past.
                            */}
                            {request.status === 'pending' && request.stagedDecision && (
                                <div className="mt-3 rounded-lg border border-violet-500/25 bg-violet-500/[0.07] p-3">
                                    <p className="flex items-start gap-1.5 text-[12px] text-violet-200">
                                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        <span>
                                            Your reply in this conversation reads as{' '}
                                            <strong>
                                                {request.stagedDecision.intent === 'accept' ? 'accepting' : 'declining'}
                                            </strong>{' '}
                                            this request. Nothing has been done yet.
                                            {request.stagedDecision.reason
                                                ? ` Reason read: "${request.stagedDecision.reason}"`
                                                : ''}
                                        </span>
                                    </p>
                                    <div className="mt-2.5 flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            disabled={busyId === request.id}
                                            onClick={() => (request.stagedDecision.intent === 'accept'
                                                ? accept(request.id)
                                                : (setRejectingId(request.id), setReason(request.stagedDecision.reason || '')))}
                                            className="rounded-lg bg-violet-500/80 px-3 py-1.5 text-xs font-semibold text-[#0b0f17] transition-opacity hover:bg-violet-500 disabled:opacity-40"
                                        >
                                            {request.stagedDecision.intent === 'accept'
                                                ? 'Confirm — create the task'
                                                : 'Confirm — decline it'}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busyId === request.id}
                                            onClick={() => dismiss(request.id)}
                                            className="rounded-lg px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200 disabled:opacity-40"
                                        >
                                            That&apos;s not what I meant
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/*
                                Only worth showing while it still matters — once a client has
                                answered, missingDetails is cleared by the handler.
                            */}
                            {request.status === 'pending' && request.missingDetails?.length > 0 && (
                                <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-gray-500">
                                    <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    Missing {request.missingDetails.join(' and ')}.
                                    {request.detailsRequestedAt
                                        ? ' The client has been asked.'
                                        : ' Not yet asked.'}
                                </p>
                            )}

                            {rejectingId === request.id ? (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <input
                                        autoFocus
                                        value={reason}
                                        maxLength={500}
                                        onChange={(e) => setReason(e.target.value)}
                                        placeholder="Why not? The client reads this."
                                        className="min-w-[240px] flex-1 rounded-lg bg-white/[0.06] px-3 py-2 text-[13px] text-gray-100 placeholder:text-gray-600 focus:outline-none"
                                    />
                                    <button
                                        type="button"
                                        disabled={busyId === request.id || !reason.trim()}
                                        onClick={() => reject(request.id)}
                                        className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:bg-white/5 disabled:opacity-40"
                                    >
                                        Send decline
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setRejectingId(null); setReason(''); }}
                                        className="px-2 py-2 text-xs text-gray-500 hover:text-gray-300"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {request.status === 'pending' && (
                                        <>
                                            <button
                                                type="button"
                                                disabled={busyId === request.id}
                                                onClick={() => accept(request.id)}
                                                className="flex items-center gap-1.5 rounded-lg bg-emerald-500/80 px-3 py-1.5 text-xs font-semibold text-[#0b0f17] transition-opacity hover:bg-emerald-500 disabled:opacity-40"
                                            >
                                                <Check className="h-3.5 w-3.5" />
                                                {busyId === request.id ? 'Creating…' : 'Accept'}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={busyId === request.id}
                                                onClick={() => { setRejectingId(request.id); setReason(''); }}
                                                className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-40"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                                Decline
                                            </button>
                                        </>
                                    )}
                                    <button
                                        type="button"
                                        disabled={busyId === request.id}
                                        onClick={() => remove(request.id)}
                                        title="Remove from this list. The request email stays in the inbox."
                                        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300 disabled:opacity-40"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Delete
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default EsfTaskRequests;

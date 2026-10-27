import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Loader2, X as XIcon, AlertCircle, CheckCircle2, RefreshCw, Receipt, Unlink } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

/**
 * Link an ESF client to their Zoho Billing customer by hand — for when the email they use in
 * SellerQI is not the one on their Zoho Billing account, so the nightly email match never finds
 * them. One customer per account; a customer another account already uses cannot be picked.
 *
 * Used by the ESF portal (baseUrl /app/esf/clients/:id) and the super admin's Manage Accounts
 * (/app/auth/admin/accounts/:id). See server/Services/Zoho/ZohoBillingLinks.js.
 */
const SEARCH_DEBOUNCE_MS = 300;

const formatDay = (value) => {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const howLinked = (linked) => {
    if (linked.linkSource === 'manual') {
        const by = linked.linkedBy ? ` by ${linked.linkedBy}` : '';
        const on = linked.linkedAt ? ` on ${formatDay(linked.linkedAt)}` : '';
        return `Linked by hand${by}${on}`;
    }
    return `Linked automatically by email${linked.email ? ` (${linked.email})` : ''}`;
};

const CustomerRow = ({ customer, isLinked, onPick, busy, disabled }) => {
    const taken = Boolean(customer.linkedTo);
    return (
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 hover:border-white/20 transition-colors">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-100">{customer.displayName}</p>
                    {customer.currencyCode && (
                        <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-gray-400">
                            {customer.currencyCode}
                        </span>
                    )}
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                    {[customer.companyName !== customer.displayName ? customer.companyName : null, customer.email].filter(Boolean).join(' · ') || 'No email'}
                </p>
                {taken && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-400">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        Already linked to {customer.linkedTo.name}
                    </p>
                )}
            </div>

            {isLinked ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Linked
                </span>
            ) : (
                <button
                    type="button"
                    onClick={() => onPick(customer)}
                    disabled={disabled || taken}
                    title={taken ? 'Unlink it from the other account first' : undefined}
                    aria-label={`Link ${customer.displayName}`}
                    className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
                >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Link'}
                </button>
            )}
        </div>
    );
};

export default function EsfConnectBillingModal({ client, baseUrl, onClose, onChanged }) {
    const [search, setSearch] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState(null);
    // Replacing or removing a link clears the invoices the client sees, so both ask first.
    const [confirm, setConfirm] = useState(null); // { kind: 'change', customer } | { kind: 'unlink' }
    const requestRef = useRef(0);

    const load = useCallback(async ({ term, refresh = false } = {}) => {
        const requestId = ++requestRef.current;
        try {
            setLoading(true);
            setError('');
            const res = await axiosInstance.get(`${baseUrl}/billing-options`, {
                params: { search: term || '', ...(refresh ? { refresh: '1' } : {}) },
            });
            if (requestId !== requestRef.current) return;
            setData(res.data?.data || null);
        } catch (err) {
            if (requestId !== requestRef.current) return;
            setError(err.response?.data?.message || 'Could not load customers from Zoho Billing');
        } finally {
            if (requestId === requestRef.current) setLoading(false);
        }
    }, [baseUrl]);

    useEffect(() => {
        const timer = setTimeout(() => load({ term: search }), search ? SEARCH_DEBOUNCE_MS : 0);
        return () => clearTimeout(timer);
    }, [search, load]);

    const link = async (customer) => {
        try {
            setConfirm(null);
            setBusyId(customer.customerId);
            setError('');
            const res = await axiosInstance.post(`${baseUrl}/billing`, { customerId: customer.customerId });
            setData((prev) => ({ ...(res.data?.data || {}), results: prev?.results || [], query: prev?.query }));
            onChanged?.();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not link the customer');
        } finally {
            setBusyId(null);
        }
    };

    const unlink = async () => {
        try {
            setConfirm(null);
            setBusyId('unlink');
            setError('');
            const res = await axiosInstance.delete(`${baseUrl}/billing`);
            setData((prev) => ({ ...(res.data?.data || {}), results: prev?.results || [], query: prev?.query }));
            onChanged?.();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not unlink the customer');
        } finally {
            setBusyId(null);
        }
    };

    const pick = (customer) => {
        if (data?.linked?.customerId) setConfirm({ kind: 'change', customer });
        else link(customer);
    };

    const linked = data?.linked;
    const list = data?.results || [];
    const clientName = client.label || `${client.firstName || ''} ${client.lastName || ''}`.trim();

    return (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
            <div
                role="dialog"
                aria-label="Link Zoho Billing"
                className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-[#101722] shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start gap-3 border-b border-white/10 p-5">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10">
                        <Receipt className="h-4 w-4 text-blue-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-gray-100">Link Zoho Billing</h3>
                        <p className="mt-0.5 truncate text-xs text-gray-500">
                            {clientName}
                            {client.email ? ` · ${client.email}` : ''}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-gray-500 hover:bg-white/5 hover:text-gray-300">
                        <XIcon className="h-4 w-4" />
                    </button>
                </div>

                <div className="space-y-3 border-b border-white/10 p-5 pb-4">
                    {linked?.customerId ? (
                        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2.5">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-gray-100">{linked.customerName || linked.customerId}</p>
                                <p className="text-[11px] text-gray-500">{howLinked(linked)}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setConfirm({ kind: 'unlink' })}
                                disabled={!!busyId}
                                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/5 disabled:opacity-50"
                            >
                                {busyId === 'unlink' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                                Unlink
                            </button>
                        </div>
                    ) : data && (
                        <p className="text-xs leading-relaxed text-gray-400">
                            {data.autoMatchDisabled
                                ? 'Not linked. Billing was unlinked by hand, so the nightly email match will leave it alone until you pick a customer.'
                                : 'Not linked. No Zoho Billing customer uses this client’s email — pick theirs below and their invoices appear within a minute.'}
                        </p>
                    )}

                    {confirm && (
                        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                            <p className="text-xs leading-relaxed text-amber-200">
                                {confirm.kind === 'unlink'
                                    ? 'Unlink this customer? The client stops seeing these invoices and their card, and the nightly email match will not link it again.'
                                    : `Switch to ${confirm.customer.displayName}? The invoices and card from ${linked?.customerName || 'the current customer'} are removed from the client's Billing page.`}
                            </p>
                            <div className="mt-2 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => (confirm.kind === 'unlink' ? unlink() : link(confirm.customer))}
                                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400"
                                >
                                    {confirm.kind === 'unlink' ? 'Unlink' : 'Switch customer'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirm(null)}
                                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/5"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                        <input
                            autoFocus
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by name, company or billing email…"
                            className="w-full rounded-xl border border-white/10 bg-[#0b0f17] py-2.5 pl-9 pr-3 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-blue-500/50"
                        />
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">
                    {error && (
                        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                            <p className="text-xs text-red-300">{error}</p>
                        </div>
                    )}

                    {!data?.query && list.length > 0 && (
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Suggested for this client</p>
                    )}

                    {loading && !data ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading Zoho Billing customers…
                        </div>
                    ) : list.length === 0 ? (
                        <p className="py-10 text-center text-sm text-gray-500">
                            {data?.query ? `No customers match “${data.query}”.` : 'No likely matches — search by name, company or email.'}
                        </p>
                    ) : (
                        <div className={`space-y-2 ${loading ? 'opacity-60' : ''}`}>
                            {list.map((customer) => (
                                <CustomerRow
                                    key={customer.customerId}
                                    customer={customer}
                                    isLinked={linked?.customerId === customer.customerId}
                                    onPick={pick}
                                    busy={busyId === customer.customerId}
                                    disabled={!!busyId}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-3 border-t border-white/10 px-5 py-3">
                    <p className="flex-1 text-[11px] text-gray-500">
                        {data?.totalCustomers ? `${data.totalCustomers} customers in Zoho Billing` : ''}
                    </p>
                    {/* Customers are cached for 5 minutes; this picks up one created moments ago. */}
                    <button
                        type="button"
                        onClick={() => load({ term: search, refresh: true })}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/5 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>
        </div>
    );
}

import { useCallback, useEffect, useState } from 'react';
import { PALETTE } from '../../../Components/ESF/estoreFactoryTheme.js';
import axiosInstance from '../../../config/axios.config.js';

/**
 * Estore Factory > Billing — the client's real invoices and the card we bill.
 *
 * Reads GET /api/pagewise/esf/billing, which serves the nightly Zoho Billing sync
 * (server/Services/Zoho/ZohoBillingSync.js) — never Zoho directly, so the page is a
 * database read and survives Zoho being slow.
 *
 * TWO THINGS THE MOCK SHOWED THAT REAL DATA CANNOT SUPPORT, both removed rather than
 * faked:
 *   - a card BRAND ("VISA"). Zoho exposes no network/brand for a saved card on this
 *     account — `funding` comes back empty — so the badge shows the last four only.
 *
 * Invoice PDFs ARE available — Zoho renders them from the same invoices.READ scope
 * via ?accept=pdf, so each row downloads the real document.
 */
const STATUS_STYLE = {
    Paid: { bg: 'rgba(255,255,255,.06)', color: PALETTE.textTertiary },
    Due: { bg: 'rgba(245,166,35,.13)', color: PALETTE.amberValue },
};

const GRID = '118px 118px 1fr 118px 104px 40px';

const money = (amount, currencyCode = 'USD') => {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode || 'USD' }).format(amount);
    } catch {
        return `${Number(amount).toFixed(2)}`;
    }
};

const shortDate = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** "11 / 2030", and flagged once the card is actually past it. */
const expiry = (month, year) => {
    if (!month || !year) return null;
    const expired = new Date(year, month, 0) < new Date();
    return { label: `${String(month).padStart(2, '0')} / ${year}`, expired };
};

const Billing = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    const load = useCallback(async () => {
        try {
            const res = await axiosInstance.get('/api/pagewise/esf/billing');
            setData(res.data?.data || null);
        } catch (err) {
            setLoadError(err.response?.data?.message || 'Could not load your billing');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const [downloading, setDownloading] = useState(null);
    const [downloadError, setDownloadError] = useState('');

    /**
     * Fetched through axios rather than a plain <a href>, because the endpoint is
     * cookie-authenticated and a bare link would not reliably carry credentials
     * cross-origin. The blob is handed to a throwaway anchor, then revoked.
     */
    const download = useCallback(async (invoiceNumber) => {
        setDownloading(invoiceNumber);
        setDownloadError('');
        try {
            const res = await axiosInstance.get(
                `/api/pagewise/esf/billing/invoices/${encodeURIComponent(invoiceNumber)}/pdf`,
                { responseType: 'blob' }
            );

            const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `${invoiceNumber}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            setDownloadError(`Could not download ${invoiceNumber}. Please try again.`);
        } finally {
            setDownloading(null);
        }
    }, []);

    const linked = Boolean(data?.linked);
    const invoices = data?.invoices || [];
    const card = data?.card || null;
    const billedTo = data?.billedTo || null;
    const cardExpiry = card ? expiry(card.expiryMonth, card.expiryYear) : null;

    return (
    <div className="min-h-full w-full" style={{ background: PALETTE.bg, color: PALETTE.textPrimary, fontFamily: "system-ui, -apple-system, 'Helvetica Neue', Helvetica, sans-serif" }}>
        <div className="max-w-[1170px] mx-auto flex flex-col gap-7 px-8 md:px-10 py-9 md:py-11">

            <header className="flex flex-col gap-[7px]">
                <h1 className="m-0 text-[29px] font-semibold tracking-[-0.02em]">Billing</h1>
                <p className="m-0 text-[13.5px]" style={{ color: PALETTE.textSecondary }}>
                    Your invoices and the card we bill. Anything about your plan itself goes through your account manager.
                </p>
            </header>

            <section className="rounded-lg flex flex-col gap-5" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '24px 26px 22px' }}>
                <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Payment method</h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-7 items-start pt-5" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
                    <div className="flex items-center gap-[14px]">
                        {card ? (
                            <>
                                {/* No brand badge: Zoho exposes no card network for this
                                    account, and guessing one on a real payment method is a
                                    claim the client cannot check. */}
                                <span
                                    className="flex-none w-[46px] h-[30px] rounded-[5px] flex items-center justify-center text-[8.5px] font-bold tracking-[.06em]"
                                    style={{ background: 'linear-gradient(160deg, #252A31, #171A1E)', border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textTertiary, fontFamily: 'ui-monospace, Menlo, monospace' }}
                                >
                                    CARD
                                </span>
                                <div className="flex flex-col gap-1">
                                    <span className="text-sm font-semibold tabular-nums" style={{ color: PALETTE.textPrimary }}>
                                        •••• •••• •••• {card.lastFour}
                                    </span>
                                    {cardExpiry && (
                                        <span className="text-[12.5px]" style={{ color: cardExpiry.expired ? PALETTE.amberValue : PALETTE.textSecondary }}>
                                            {cardExpiry.expired ? 'Expired ' : 'Expires '}{cardExpiry.label}
                                        </span>
                                    )}
                                </div>
                            </>
                        ) : (
                            <span className="text-[13px]" style={{ color: PALETTE.textMuted }}>
                                {loading ? 'Loading…' : 'No card on file.'}
                            </span>
                        )}
                    </div>

                    <div className="flex flex-col gap-[5px]">
                        <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>BILLED TO</span>
                        {billedTo ? (
                            <>
                                <span className="text-[13.5px]" style={{ color: PALETTE.textBody }}>{billedTo.companyName || '—'}</span>
                                {billedTo.address && (
                                    <span className="text-[12.5px] leading-[1.55]" style={{ color: PALETTE.textSecondary }}>
                                        {[billedTo.address.street, billedTo.address.street2].filter(Boolean).join(', ')}
                                        <br />
                                        {[billedTo.address.city, billedTo.address.state, billedTo.address.zip].filter(Boolean).join(', ')}
                                    </span>
                                )}
                            </>
                        ) : (
                            <span className="text-[13px]" style={{ color: PALETTE.textMuted }}>{loading ? 'Loading…' : '—'}</span>
                        )}
                    </div>

                    <div className="flex flex-col gap-[9px] items-start">
                        {/* Kept as prose, not a button: there is no payment portal wired
                            up, and a dead "Update payment method" link is worse than
                            telling them who can actually change it. */}
                        <span className="text-[12.5px] leading-[1.6]" style={{ color: PALETTE.textSecondary }}>
                            To change the card we bill, message your account manager.
                        </span>
                        {data?.outstanding > 0 && (
                            <span className="text-[12.5px] font-semibold" style={{ color: PALETTE.amberValue }}>
                                {money(data.outstanding, data.currencyCode)} outstanding
                            </span>
                        )}
                    </div>
                </div>
            </section>

            <section className="rounded-lg flex flex-col" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '22px 26px 14px' }}>
                <div className="flex items-baseline gap-[10px] pb-3 flex-wrap">
                    <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Invoice history</h2>
                    <span className="flex-1 text-[12.5px]" style={{ color: PALETTE.textMuted }}>
                        {loading ? 'Loading…' : `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}
                    </span>
                    {data?.syncedAt && (
                        <span className="flex-none text-xs" style={{ color: PALETTE.textDim }}>
                            Updated {shortDate(data.syncedAt)}
                        </span>
                    )}
                </div>

                {loadError && (
                    <div className="py-4 text-[13px]" style={{ color: PALETTE.amberValue }}>{loadError}</div>
                )}
                {downloadError && (
                    <div className="py-2 text-[12.5px]" style={{ color: '#F87171' }}>{downloadError}</div>
                )}

                {!loading && !loadError && !linked && (
                    <div className="py-6 text-[13px]" style={{ color: PALETTE.textMuted }}>
                        No billing account is connected yet. Your account manager can set this up.
                    </div>
                )}

                {linked && invoices.length === 0 && (
                    <div className="py-6 text-[13px]" style={{ color: PALETTE.textMuted }}>No invoices yet.</div>
                )}

                {invoices.length > 0 && (
                    <div className="overflow-x-auto">
                        <div className="min-w-[660px]">
                            <div className="grid gap-[18px] items-center pb-[11px] text-[11px] tracking-[.05em]" style={{ gridTemplateColumns: GRID, borderBottom: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textMuted }}>
                                <span>INVOICE</span><span>DATE</span><span>DESCRIPTION</span><span className="text-right">AMOUNT</span><span>STATUS</span><span />
                            </div>

                            {invoices.map((inv) => {
                                // Driven by the BALANCE, not Zoho's status string: that can
                                // read "sent" for something still owed, which tells a client
                                // nothing about whether they need to pay it.
                                const label = inv.paid ? 'Paid' : 'Due';
                                const style = STATUS_STYLE[label];
                                return (
                                    <div key={inv.number} className="grid gap-[18px] items-center py-[15px]" style={{ gridTemplateColumns: GRID, borderBottom: `1px solid ${PALETTE.divider}` }}>
                                        <span className="text-[13px] tabular-nums" style={{ color: PALETTE.textBody }}>{inv.number}</span>
                                        <span className="text-[13px]" style={{ color: PALETTE.textTertiary }}>{shortDate(inv.date)}</span>
                                        <span className="text-[13px] min-w-0 truncate" style={{ color: PALETTE.textInputBody }} title={inv.description || ''}>
                                            {inv.description || '—'}
                                        </span>
                                        <span className="text-[13px] text-right tabular-nums" style={{ color: PALETTE.textBody }}>
                                            {money(inv.total, inv.currencyCode)}
                                        </span>
                                        <span>
                                            <span className="text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: style.bg, color: style.color }}>
                                                {label}
                                            </span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => download(inv.number)}
                                            disabled={downloading === inv.number}
                                            title={`Download ${inv.number}`}
                                            aria-label={`Download invoice ${inv.number}`}
                                            className="w-[28px] h-[28px] rounded-md flex items-center justify-center text-xs transition-colors"
                                            style={{
                                                border: `1px solid ${PALETTE.border}`,
                                                color: PALETTE.textTertiary,
                                                cursor: downloading === inv.number ? 'wait' : 'pointer',
                                                opacity: downloading === inv.number ? 0.5 : 1,
                                            }}
                                        >
                                            {downloading === inv.number ? '…' : '↓'}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </section>

        </div>
    </div>
    );
};

export default Billing;

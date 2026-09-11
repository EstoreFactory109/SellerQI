import { PALETTE } from '../../../Components/ESF/estoreFactoryTheme.js';

/**
 * Estore Factory > Billing — recreates deploy/billing.html exactly.
 *
 * Fully static/sample content: no invoicing model exists for ESF accounts yet
 * (see the data-reality note in ClientDashboard.jsx). "Update payment method"
 * opens an external link in the mock too (a placeholder payment portal URL),
 * so it is left as a real anchor rather than disabled.
 */
const INVOICES = [
    { id: 'EF-2048', date: '1 Sep 2026', desc: 'Account management — September', amount: '$2,400.00', status: 'Pending' },
    { id: 'EF-2041', date: '1 Aug 2026', desc: 'Account management — August, plus A+ content build', amount: '$2,800.00', status: 'Paid' },
    { id: 'EF-2032', date: '1 Jul 2026', desc: 'Account management — July', amount: '$2,400.00', status: 'Paid' },
    { id: 'EF-2024', date: '1 Jun 2026', desc: 'Account management — June', amount: '$2,400.00', status: 'Paid' },
    { id: 'EF-2016', date: '1 May 2026', desc: 'Account management — May, plus photography day', amount: '$3,150.00', status: 'Paid' },
    { id: 'EF-2009', date: '1 Apr 2026', desc: 'Account management — April', amount: '$2,400.00', status: 'Paid' },
    { id: 'EF-2001', date: '1 Mar 2026', desc: 'Account management — March', amount: '$2,400.00', status: 'Paid' },
    { id: 'EF-1994', date: '1 Feb 2026', desc: 'Account management — February', amount: '$2,400.00', status: 'Paid' },
];

const STATUS_STYLE = {
    Pending: { bg: 'rgba(245,166,35,.13)', color: PALETTE.amberValue },
    Paid: { bg: 'rgba(255,255,255,.06)', color: PALETTE.textTertiary },
};

const Billing = () => (
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
                        <span
                            className="flex-none w-[46px] h-[30px] rounded-[5px] flex items-center justify-center text-[8.5px] font-bold tracking-[.06em]"
                            style={{ background: 'linear-gradient(160deg, #252A31, #171A1E)', border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textTertiary, fontFamily: 'ui-monospace, Menlo, monospace' }}
                        >
                            VISA
                        </span>
                        <div className="flex flex-col gap-1">
                            <span className="text-sm font-semibold tabular-nums" style={{ color: PALETTE.textPrimary }}>•••• •••• •••• 4417</span>
                            <span className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>Expires 09 / 2028</span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-[5px]">
                        <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>BILLED TO</span>
                        <span className="text-[13.5px]" style={{ color: PALETTE.textBody }}>Kessler Home Goods LLC</span>
                        <span className="text-[12.5px] leading-[1.55]" style={{ color: PALETTE.textSecondary }}>1420 Beacon St, Suite 3<br />Brookline, MA 02446</span>
                    </div>

                    <div className="flex flex-col gap-[9px] items-start">
                        <a
                            href="https://example.com/update-card"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[12.5px] font-semibold px-4 py-[10px] rounded-lg"
                            style={{ color: PALETTE.textBody, border: `1px solid ${PALETTE.borderHover}` }}
                        >
                            Update payment method
                        </a>
                        <span className="text-xs leading-[1.6]" style={{ color: PALETTE.textFaint }}>Opens the secure payment portal in a new tab.</span>
                    </div>
                </div>
            </section>

            <section className="rounded-lg flex flex-col" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '22px 26px 14px' }}>
                <div className="flex items-baseline gap-[10px] pb-3 flex-wrap">
                    <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Invoice history</h2>
                    <span className="flex-1 text-[12.5px]" style={{ color: PALETTE.textMuted }}>Last 8 invoices</span>
                    <span className="flex-none text-xs" style={{ color: PALETTE.textDim }}>Paid by card on file</span>
                </div>

                <div className="overflow-x-auto">
                    <div className="min-w-[720px]">
                        <div className="grid gap-[18px] items-center pb-[11px] text-[11px] tracking-[.05em]" style={{ gridTemplateColumns: '118px 118px 1fr 118px 104px 34px', borderBottom: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textMuted }}>
                            <span>INVOICE</span><span>DATE</span><span>DESCRIPTION</span><span className="text-right">AMOUNT</span><span>STATUS</span><span />
                        </div>

                        {INVOICES.map((inv) => (
                            <div key={inv.id} className="grid gap-[18px] items-center py-[15px]" style={{ gridTemplateColumns: '118px 118px 1fr 118px 104px 34px', borderBottom: `1px solid ${PALETTE.divider}` }}>
                                <span className="text-[13px] tabular-nums" style={{ color: PALETTE.textBody }}>{inv.id}</span>
                                <span className="text-[13px]" style={{ color: PALETTE.textTertiary }}>{inv.date}</span>
                                <span className="text-[13px]" style={{ color: PALETTE.textInputBody }}>{inv.desc}</span>
                                <span className="text-[13px] text-right tabular-nums" style={{ color: PALETTE.textBody }}>{inv.amount}</span>
                                <span>
                                    <span className="text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: STATUS_STYLE[inv.status].bg, color: STATUS_STYLE[inv.status].color }}>
                                        {inv.status}
                                    </span>
                                </span>
                                <a
                                    href="#"
                                    onClick={(e) => e.preventDefault()}
                                    className="w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs"
                                    style={{ border: `1px solid ${PALETTE.border}`, color: PALETTE.textTertiary }}
                                >
                                    ↓
                                </a>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="pt-4 pb-3">
                    <a href="#" onClick={(e) => e.preventDefault()} className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>Download all invoices</a>
                </div>
            </section>

        </div>
    </div>
);

export default Billing;

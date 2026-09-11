import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PALETTE } from '../../../Components/ESF/estoreFactoryTheme.js';

/**
 * Estore Factory > Reports > Report History — recreates deploy/report-history.html.
 *
 * The mock itself is a single hardcoded example ("Weekly Buybox Report") — every
 * "View history" link on the Reports page points at this same static page rather
 * than a per-report-type route, so this component matches that scope exactly
 * rather than inventing per-report-type history pages with no backend behind them.
 */
const ALL_EDITIONS = [
    { iso: '2026-07-09', date: '9 Jul 2026', summary: '2 of 24 ASINs losing buy box — floor cleaner still contested', published: 'Published 9 Jul, 6:02 am' },
    { iso: '2026-07-02', date: '2 Jul 2026', summary: '2 of 24 ASINs losing buy box — no change week on week', published: 'Published 2 Jul, 6:01 am' },
    { iso: '2026-06-25', date: '25 Jun 2026', summary: '1 of 24 ASINs losing buy box — dishwashing liquid recovered', published: 'Published 25 Jun, 6:03 am' },
    { iso: '2026-06-18', date: '18 Jun 2026', summary: '4 of 24 ASINs losing buy box — three sellers undercut on laundry', published: 'Published 18 Jun, 6:02 am' },
    { iso: '2026-06-11', date: '11 Jun 2026', summary: '3 of 24 ASINs losing buy box — repricing rules updated midweek', published: 'Published 11 Jun, 6:02 am' },
    { iso: '2026-06-04', date: '4 Jun 2026', summary: '1 of 24 ASINs losing buy box — best week since March', published: 'Published 4 Jun, 6:00 am' },
    { iso: '2026-05-28', date: '28 May 2026', summary: '2 of 24 ASINs losing buy box — scrub concentrate back in stock', published: 'Published 28 May, 6:02 am' },
    { iso: '2026-05-21', date: '21 May 2026', summary: '5 of 24 ASINs losing buy box — stock gaps on the spray twin pack', published: 'Published 21 May, 6:04 am' },
    { iso: '2026-05-14', date: '14 May 2026', summary: '3 of 24 ASINs losing buy box — CleanCo entered the floor cleaner', published: 'Published 14 May, 6:01 am' },
];

const LATEST_ROWS = [
    { product: 'Eucalyptus floor cleaner 2L refill', price: 'A$24.90', status: 'Losing', weeks: '6', seller: 'CleanCo Wholesale AU', theirPrice: 'A$22.45' },
    { product: 'Lemon myrtle dishwashing liquid 750ml', price: 'A$12.50', status: 'Losing', weeks: '2', seller: 'Household Direct', theirPrice: 'A$11.95' },
    { product: 'Multi-surface spray twin pack', price: 'A$18.00', status: 'Winning', weeks: '—', seller: '—', theirPrice: '—' },
    { product: 'Bathroom scrub concentrate 1L', price: 'A$16.90', status: 'Winning', weeks: '—', seller: '—', theirPrice: '—' },
    { product: 'Laundry powder sensitive 4kg', price: 'A$32.00', status: 'Winning', weeks: '—', seller: '—', theirPrice: '—' },
    { product: 'Glass and mirror cleaner 500ml', price: 'A$9.90', status: 'Winning', weeks: '—', seller: '—', theirPrice: '—' },
];

const STATUS_STYLE = {
    Losing: { bg: 'rgba(245,166,35,.13)', color: PALETTE.amberValue },
    Winning: { bg: 'rgba(95,211,196,.11)', color: PALETTE.teal },
};

const ReportHistory = () => {
    const navigate = useNavigate();
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');

    const editions = useMemo(
        () => ALL_EDITIONS.filter((e) => (!from || e.iso >= from) && (!to || e.iso <= to)),
        [from, to]
    );
    const shownLabel = from || to
        ? `Showing ${editions.length} of ${ALL_EDITIONS.length}`
        : `9 most recent of 84`;

    return (
        <div className="min-h-full w-full" style={{ background: PALETTE.bg, color: PALETTE.textPrimary, fontFamily: "system-ui, -apple-system, 'Helvetica Neue', Helvetica, sans-serif" }}>
            <div className="max-w-[1170px] mx-auto flex flex-col gap-[26px] px-8 md:px-10 py-8 md:py-10">

                <div className="flex items-center gap-[9px] text-[12.5px]" style={{ color: PALETTE.textMuted }}>
                    <button type="button" onClick={() => navigate('/seller-central-checker/estore-factory/reports')} style={{ color: PALETTE.textTertiary }}>Reports</button>
                    <span>/</span>
                    <span style={{ color: PALETTE.textInputBody }}>Weekly Buybox Report</span>
                </div>

                <header className="flex flex-col gap-2">
                    <h1 className="m-0 text-[29px] font-semibold tracking-[-0.02em]">Weekly Buybox Report</h1>
                    <div className="flex items-center gap-[9px] text-[13.5px] flex-wrap" style={{ color: PALETTE.textSecondary }}>
                        <span>Weekly</span>
                        <span className="w-[3px] h-[3px] rounded-full" style={{ background: '#4A5058' }} />
                        <span style={{ color: PALETTE.textInputBody }}>Simply Clean AU</span>
                        <span className="w-[3px] h-[3px] rounded-full" style={{ background: '#4A5058' }} />
                        <span>84 editions on file</span>
                    </div>
                </header>

                <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-lg flex flex-col gap-[11px] p-5" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}` }}>
                        <span className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>ASINs tracked</span>
                        <span className="text-[32px] font-semibold tracking-[-0.02em] leading-none tabular-nums">24</span>
                        <span className="text-xs" style={{ color: PALETTE.textMuted }}>Unchanged since May</span>
                    </div>
                    <div className="rounded-lg flex flex-col gap-[11px] p-5" style={{ background: PALETTE.amberBg, border: `1px solid ${PALETTE.amberBorder}` }}>
                        <span className="text-[12.5px]" style={{ color: PALETTE.amberLabel }}>Currently losing buy box</span>
                        <span className="text-[32px] font-semibold tracking-[-0.02em] leading-none tabular-nums" style={{ color: PALETTE.amberValue }}>3</span>
                        <span className="text-xs" style={{ color: PALETTE.amberSub }}>One more than last week</span>
                    </div>
                    <div className="rounded-lg flex flex-col gap-[11px] p-5" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}` }}>
                        <span className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>Longest losing streak</span>
                        <span className="text-[32px] font-semibold tracking-[-0.02em] leading-none tabular-nums">
                            6<span className="text-[15px] font-medium" style={{ color: PALETTE.textSecondary }}> weeks</span>
                        </span>
                        <span className="text-xs" style={{ color: PALETTE.textMuted }}>Eucalyptus floor cleaner 2L</span>
                    </div>
                </section>

                <section className="rounded-lg flex flex-col gap-1" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.borderHover}`, padding: '22px 24px 16px' }}>
                    <div className="flex items-baseline gap-[10px] pb-[10px] flex-wrap">
                        <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Latest edition, 16 July 2026</h2>
                        <span className="flex-1 text-xs" style={{ color: PALETTE.textMuted }}>Published 16 Jul, 6:02 am</span>
                        <a href="#" onClick={(e) => e.preventDefault()} className="flex-none text-[12.5px]" style={{ color: PALETTE.textSecondary }}>Download ↓</a>
                    </div>

                    <div className="overflow-x-auto">
                        <div className="min-w-[720px]">
                            <div className="grid gap-4 pb-[10px] text-[11px] tracking-[.05em]" style={{ gridTemplateColumns: '1fr 110px 110px 96px 190px 110px', borderBottom: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textMuted }}>
                                <span>PRODUCT</span><span>OUR PRICE</span><span>STATUS</span><span>WEEKS</span><span>COMPETING SELLER</span><span className="text-right">THEIR PRICE</span>
                            </div>
                            {LATEST_ROWS.map((row) => (
                                <div key={row.product} className="grid gap-4 items-center py-[15px]" style={{ gridTemplateColumns: '1fr 110px 110px 96px 190px 110px', borderBottom: `1px solid ${PALETTE.divider}` }}>
                                    <span className="text-[13px] truncate" style={{ color: PALETTE.textBody }}>{row.product}</span>
                                    <span className="text-[13px] tabular-nums" style={{ color: PALETTE.textInputBody }}>{row.price}</span>
                                    <span>
                                        <span className="text-[11.5px] font-semibold rounded-md px-[10px] py-1" style={{ background: STATUS_STYLE[row.status].bg, color: STATUS_STYLE[row.status].color }}>
                                            {row.status}
                                        </span>
                                    </span>
                                    <span className="text-[13px] tabular-nums" style={{ color: row.status === 'Losing' ? PALETTE.amberValue : PALETTE.textMuted }}>{row.weeks}</span>
                                    <span className="text-[13px] truncate" style={{ color: PALETTE.textTertiary }}>{row.seller}</span>
                                    <span className="text-[13px] text-right tabular-nums" style={{ color: row.theirPrice === '—' ? PALETTE.textMuted : PALETTE.textInputBody }}>{row.theirPrice}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="pt-[14px] pb-2">
                        <a href="#" onClick={(e) => e.preventDefault()} className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>Open full report →</a>
                    </div>
                </section>

                <section className="flex flex-col gap-[14px]">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="m-0 text-[14.5px] font-semibold tracking-[-0.01em]" style={{ color: PALETTE.textTertiary }}>Earlier editions</h2>
                        <span className="flex-1 text-[12.5px]" style={{ color: PALETTE.textDim }}>{shownLabel}</span>
                        <span className="flex-none flex items-center gap-2">
                            <input
                                type="date"
                                value={from}
                                onChange={(e) => setFrom(e.target.value)}
                                className="rounded-lg px-[10px] py-2 text-[12.5px] outline-none"
                                style={{ background: PALETTE.input, border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textBody, colorScheme: 'dark' }}
                            />
                            <span className="text-xs" style={{ color: PALETTE.textMuted }}>to</span>
                            <input
                                type="date"
                                value={to}
                                onChange={(e) => setTo(e.target.value)}
                                className="rounded-lg px-[10px] py-2 text-[12.5px] outline-none"
                                style={{ background: PALETTE.input, border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textBody, colorScheme: 'dark' }}
                            />
                            <button type="button" onClick={() => { setFrom(''); setTo(''); }} className="text-[12.5px] py-2 px-0.5" style={{ color: PALETTE.textSecondary }}>Reset</button>
                        </span>
                    </div>

                    <div className="rounded-lg" style={{ border: `1px solid ${PALETTE.dividerFaint}`, background: 'rgba(255,255,255,.012)', padding: '2px 22px 4px' }}>
                        {editions.map((e) => (
                            <div key={e.iso} className="flex items-center gap-5 py-[14px]" style={{ borderTop: `1px solid ${PALETTE.dividerFaint}` }}>
                                <span className="flex-none w-[104px] text-[12.5px] tabular-nums" style={{ color: PALETTE.textInputBody }}>{e.date}</span>
                                <span className="flex-1 text-[13px] truncate" style={{ color: PALETTE.textTertiary }}>{e.summary}</span>
                                <span className="flex-none w-[150px] text-xs" style={{ color: PALETTE.textDim }}>{e.published}</span>
                                <a
                                    href="#"
                                    onClick={(ev) => ev.preventDefault()}
                                    className="flex-none w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs"
                                    style={{ border: `1px solid ${PALETTE.border}`, color: PALETTE.textSecondary }}
                                >
                                    ↓
                                </a>
                            </div>
                        ))}
                        {editions.length === 0 && (
                            <div className="py-[26px] text-center text-[12.5px]" style={{ color: PALETTE.textMuted }}>No editions published in that range.</div>
                        )}
                    </div>
                </section>

            </div>
        </div>
    );
};

export default ReportHistory;

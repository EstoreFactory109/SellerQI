import { useNavigate } from 'react-router-dom';
import { PALETTE } from '../../../Components/ESF/estoreFactoryTheme.js';

/**
 * Estore Factory > Reports — recreates deploy/reports.html exactly.
 *
 * Fully static/sample content (see the note in ClientDashboard.jsx about this
 * whole section having no backend yet — no recurring-report model, no
 * generated PDFs). "View history" links to Estore Factory > Report History,
 * which is itself one static example page, matching the mock (every "View
 * history" link in the source points at the same static report-history.html
 * regardless of which report card it's on).
 */
const INSIGHT_COLOR = {
    good: PALETTE.teal,
    watch: PALETTE.amberValue,
    neutral: PALETTE.textBody,
};

const REPORTS = [
    { name: 'Weekly Sales Summary', isNew: true, cadence: 'WEEKLY', date: 'Week of 25 Apr 2026', insight: 'Total sales up 2.4% across 7 marketplaces', tone: 'good' },
    { name: 'Weekly Account Overview', cadence: 'WEEKLY', date: 'Week of 26 Aug 2025', insight: '76 of 209 listings out of stock', tone: 'watch' },
    { name: 'Weekly Buybox Report', cadence: 'WEEKLY', date: '16 Jul 2026', insight: '3 of 24 ASINs losing buy box', tone: 'watch' },
    { name: 'Inventory Restock', cadence: 'BI-WEEKLY', date: 'Current cycle', insight: '4 SKUs urgent, 27 need restock', tone: 'watch' },
    { name: 'Monthly Performance Report', cadence: 'MONTHLY', date: 'February 2026', insight: 'Sales up 35.8%, ACOS improved to 38.3%', tone: 'good' },
    { name: 'FBA Aged Inventory', cadence: 'MONTHLY', date: 'December 2025', insight: '59 SKUs tracked, 214 units over 365 days', tone: 'watch' },
    { name: 'Listings Audit', cadence: 'QUARTERLY', date: '17 Sep 2025', insight: '74% completion across 8 marketplaces', tone: 'neutral' },
    { name: 'Review Requests', cadence: 'WEEKLY', date: 'Week of 25 Apr 2026', insight: '142 requests sent, 38 skipped', tone: 'neutral' },
];

const Reports = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-full w-full" style={{ background: PALETTE.bg, color: PALETTE.textPrimary, fontFamily: "system-ui, -apple-system, 'Helvetica Neue', Helvetica, sans-serif" }}>
            <div className="max-w-[1170px] mx-auto flex flex-col gap-[30px] px-8 md:px-10 py-9 md:py-11">

                <header className="flex items-end gap-[30px] flex-wrap">
                    <div className="flex-1 min-w-[240px] flex flex-col gap-[7px]">
                        <h1 className="m-0 text-[29px] font-semibold tracking-[-0.02em]">Reports</h1>
                        <p className="m-0 text-[13.5px]" style={{ color: PALETTE.textSecondary }}>Every recurring report we publish on your account, kept by report type.</p>
                    </div>
                    <span className="flex-none text-[12.5px] pb-[3px]" style={{ color: PALETTE.textSecondary }}>
                        Next report: <span style={{ color: PALETTE.textBody }}>Weekly Sales Summary</span>, Monday
                    </span>
                </header>

                {/* Featured (latest) report */}
                <section className="rounded-lg flex flex-col md:flex-row gap-7" style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.borderHover}`, padding: 24 }}>
                    <div
                        className="flex-none w-full md:w-[212px] h-[274px] rounded-lg flex items-end justify-center pb-4"
                        style={{ border: `1px solid ${PALETTE.border}`, background: 'repeating-linear-gradient(135deg, #1A1D22 0 7px, #1F2329 7px 14px)' }}
                    >
                        <span className="text-[10.5px] tracking-[.04em]" style={{ color: PALETTE.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>report preview</span>
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col gap-[18px]">
                        <div className="flex flex-col gap-[9px]">
                            <div className="flex items-center gap-[11px]">
                                <span className="text-[11px] font-bold tracking-[.05em] rounded-[5px] px-2 py-1" style={{ color: PALETTE.teal, background: 'rgba(95,211,196,.12)' }}>NEW</span>
                                <span className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>Published 1 September, 6:04 am</span>
                            </div>
                            <h2 className="m-0 text-[22px] font-bold tracking-[-0.02em]">Weekly Sales Summary</h2>
                            <span className="text-[13px]" style={{ color: PALETTE.textTertiary }}>Week of 25 April 2026 · 7 marketplaces</span>
                        </div>

                        <p className="m-0 text-[13.5px] leading-[1.65] max-w-[660px]" style={{ color: PALETTE.textInputBody }}>
                            Sales held steady through a quiet week, with the kitchen scale carrying most of the growth. Ad spend
                            came down slightly because we paused two campaigns while the new structure is in review. — Priya
                        </p>

                        <div className="flex gap-10 flex-wrap">
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>TOTAL SALES</span>
                                <span className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">$184,220</span>
                                <span className="text-xs" style={{ color: PALETTE.teal }}>▲ 2.4% week on week</span>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>UNITS SOLD</span>
                                <span className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">3,981</span>
                                <span className="text-xs" style={{ color: PALETTE.teal }}>▲ 1.1% week on week</span>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[11.5px] tracking-[.04em]" style={{ color: PALETTE.textMuted }}>ACOS</span>
                                <span className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">31.6%</span>
                                <span className="text-xs" style={{ color: PALETTE.teal }}>▼ 1.8 pts, improved</span>
                            </div>
                        </div>

                        <div className="mt-auto flex items-center gap-3">
                            <a
                                href="#"
                                onClick={(e) => e.preventDefault()}
                                className="text-[13px] font-bold px-5 py-[11px] rounded-lg"
                                style={{ background: PALETTE.accent, color: '#141414' }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = PALETTE.accentHover; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = PALETTE.accent; }}
                            >
                                Open report
                            </a>
                            <a
                                href="#"
                                onClick={(e) => e.preventDefault()}
                                className="text-[13px] font-medium px-[18px] py-[11px] rounded-lg"
                                style={{ border: `1px solid ${PALETTE.borderHover}`, color: PALETTE.textBody }}
                            >
                                Download
                            </a>
                        </div>
                    </div>
                </section>

                {/* All reports grid */}
                <section className="flex flex-col gap-4">
                    <div className="flex items-baseline gap-[10px] flex-wrap">
                        <h2 className="m-0 text-base font-bold tracking-[-0.01em]">All reports</h2>
                        <span className="flex-1 text-[12.5px]" style={{ color: PALETTE.textMuted }}>8 recurring reports · latest edition shown</span>
                        <span className="flex-none text-xs" style={{ color: PALETTE.textDim }}>Roughly 200 editions on file</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[18px]">
                        {REPORTS.map((r) => (
                            <div
                                key={r.name}
                                className="relative rounded-lg flex flex-col gap-[14px] transition-colors"
                                style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '20px 20px 14px' }}
                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = PALETTE.borderHover; }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = PALETTE.border; }}
                            >
                                {r.isNew && (
                                    <span className="absolute top-[14px] right-[14px] text-[10px] font-bold tracking-[.05em] rounded px-1.5 py-[3px]" style={{ color: PALETTE.teal, background: 'rgba(95,211,196,.12)' }}>NEW</span>
                                )}
                                <div className="flex flex-col gap-[9px]">
                                    <span className="text-[13.5px] font-semibold" style={{ color: PALETTE.textBody }}>{r.name}</span>
                                    <div className="flex items-center gap-[9px]">
                                        <span className="text-[10.5px] tracking-[.05em] rounded px-[7px] py-[3px]" style={{ color: PALETTE.textTertiary, border: `1px solid ${PALETTE.borderHover}` }}>{r.cadence}</span>
                                        <span className="text-xs" style={{ color: PALETTE.textMuted }}>{r.date}</span>
                                    </div>
                                </div>
                                <p className="m-0 text-[15px] leading-[1.45] font-medium" style={{ color: INSIGHT_COLOR[r.tone] }}>{r.insight}</p>
                                <div className="mt-auto flex items-center pt-3" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
                                    <button
                                        type="button"
                                        onClick={() => navigate('/seller-central-checker/estore-factory/report-history')}
                                        className="flex-1 text-left text-xs"
                                        style={{ color: PALETTE.textSecondary }}
                                    >
                                        View history
                                    </button>
                                    <a
                                        href="#"
                                        onClick={(e) => e.preventDefault()}
                                        className="flex-none w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs"
                                        style={{ border: `1px solid ${PALETTE.border}`, color: PALETTE.textTertiary }}
                                    >
                                        ↓
                                    </a>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

            </div>
        </div>
    );
};

export default Reports;

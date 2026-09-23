import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { PALETTE } from '../../../Components/ESF/estoreFactoryTheme.js';
import axiosInstance from '../../../config/axios.config.js';

/**
 * Estore Factory > Reports.
 *
 * Every card is one recurring report type, and every number on this page is
 * computed live from the collection that backs it — GET /api/pagewise/esf/reports
 * (Services/Calculations/EsfReportsService.js). Nothing here is sample content.
 *
 * Selecting a card promotes it into the panel at the top, which is the only
 * place detail is shown: the stats, a preview table, and — where a report is
 * only partly backed by data — the caveats saying which columns are missing and
 * why. Those caveats are rendered verbatim from the API rather than restated
 * here, so the page can never claim more coverage than the backend delivers.
 *
 * A report with no data behind it is shown greyed and unselectable rather than
 * hidden, so the client can see the full set of reports we run and which ones
 * are waiting on data. That follows the rule the ESF Overview page already
 * keeps (see ClientDashboard.jsx): never show an invented number.
 *
 * Still no backend for publishing: there is no recurring-report model, no
 * generated files and no schedule, so there is no "open"/"download" action and
 * no per-report edition history. "View history" still points at the one static
 * Report History page, unchanged.
 */

/**
 * The next scheduled report. Still hardcoded — there is no recurring-report
 * model, so the publishing schedule genuinely is not knowable from data. Kept
 * exported because the Overview card reads it from here rather than holding its
 * own copy; when a schedule exists, this is the single line that changes.
 */
export const NEXT_REPORT = { name: 'Weekly Sales Summary', due: 'Monday' };

const TONE_COLOR = {
    good: PALETTE.good,
    watch: PALETTE.amberValue,
    neutral: PALETTE.textBody,
};

/** Formats a stat or cell according to the `format` the API tagged it with. */
const formatValue = (value, format, currency) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value !== 'number') return value;
    if (format === 'currency') {
        return `${currency}${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    }
    if (format === 'percent') return `${value}%`;
    return value.toLocaleString();
};

/**
 * Delta caption under a stat. Most metrics are better when they rise, but ad
 * spend and ACOS are better when they fall — `deltaGoodWhen` carries that from
 * the API so the colour is never guessed from the metric name.
 */
const DeltaCaption = ({ stat }) => {
    if (stat.delta === null || stat.delta === undefined) return null;
    const improved = stat.deltaGoodWhen === 'down' ? stat.delta < 0 : stat.delta > 0;
    const unchanged = stat.delta === 0;
    const suffix = stat.deltaFormat === 'percent' ? '%' : stat.deltaFormat === 'points' ? ' pts' : '';
    return (
        <span
            className="text-xs"
            style={{ color: unchanged ? PALETTE.textMuted : improved ? PALETTE.good : PALETTE.amberValue }}
        >
            {unchanged ? '—' : `${stat.delta > 0 ? '▲' : '▼'} ${Math.abs(stat.delta)}${suffix}`} vs previous
        </span>
    );
};

const Stat = ({ stat, currency }) => (
    <div className="flex flex-col gap-1.5 min-w-[112px]">
        <span className="text-[11.5px] tracking-[.04em] uppercase" style={{ color: PALETTE.textMuted }}>{stat.label}</span>
        <span
            className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums leading-none"
            style={{ color: stat.tone ? TONE_COLOR[stat.tone] : PALETTE.textPrimary }}
        >
            {formatValue(stat.value, stat.format, currency)}
        </span>
        <DeltaCaption stat={stat} />
    </div>
);

/** The preview table. Scrolls sideways on narrow screens rather than squashing. */
const PreviewTable = ({ summary, currency }) => {
    // A report can legitimately have nothing to list — no ASIN losing the Buy
    // Box, no stock ageing. That is a result, not an absence, so it is stated
    // rather than left as blank space under the stats.
    if (!summary?.rows?.length) {
        if (!summary?.emptyMessage) return null;
        return (
            <p
                className="m-0 text-[13px] rounded-md"
                style={{ color: PALETTE.good, background: 'rgba(34,197,94,.08)', padding: '12px 14px' }}
            >
                {summary.emptyMessage}
            </p>
        );
    }
    return (
        <div className="flex flex-col gap-2">
            <div className="w-full overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px] min-w-[560px]">
                    <thead>
                        <tr>
                            {summary.columns.map((column) => (
                                <th
                                    key={column.key}
                                    className="text-left font-medium py-2 pr-4 whitespace-nowrap"
                                    style={{ color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}` }}
                                >
                                    {column.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {summary.rows.map((row, index) => (
                            <tr key={index}>
                                {summary.columns.map((column) => (
                                    <td
                                        key={column.key}
                                        className="py-[9px] pr-4 align-top"
                                        style={{ color: PALETTE.textInputBody, borderBottom: `1px solid ${PALETTE.dividerFaint}` }}
                                    >
                                        {formatValue(row[column.key], column.format, currency)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {summary.totalRows > summary.rows.length && (
                <span className="text-xs" style={{ color: PALETTE.textDim }}>
                    Showing {summary.rows.length} of {summary.totalRows.toLocaleString()} rows
                </span>
            )}
        </div>
    );
};

/** What the top panel shows before any data has loaded. */
const PanelSkeleton = () => (
    <section
        className="rounded-lg animate-pulse"
        style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: 24, minHeight: 232 }}
    >
        <div className="h-4 w-40 rounded" style={{ background: PALETTE.border }} />
        <div className="h-7 w-72 rounded mt-4" style={{ background: PALETTE.border }} />
        <div className="flex gap-10 mt-7">
            {[0, 1, 2, 3].map((index) => (
                <div key={index} className="flex flex-col gap-2">
                    <div className="h-3 w-20 rounded" style={{ background: PALETTE.border }} />
                    <div className="h-6 w-16 rounded" style={{ background: PALETTE.border }} />
                </div>
            ))}
        </div>
    </section>
);

/**
 * The selected report, expanded. This is the only place stats, the preview
 * table and the caveats appear — the cards below stay one line each.
 */
const SummaryPanel = ({ report, currency, failed }) => {
    // Nothing selectable: every report is still waiting on data, or the fetch
    // failed. Say so here rather than leaving the top of the page blank, which
    // reads as a broken panel.
    if (!report) {
        return (
            <section
                className="rounded-lg flex flex-col gap-2"
                style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: 24 }}
            >
                <h2 className="m-0 text-[17px] font-semibold tracking-[-0.01em]" style={{ color: PALETTE.textBody }}>
                    {failed ? 'Reports are unavailable right now' : 'No report has data yet'}
                </h2>
                <p className="m-0 text-[13px] leading-[1.6] max-w-[620px]" style={{ color: PALETTE.textMuted }}>
                    {failed
                        ? 'We could not reach your report data. Refresh the page to try again.'
                        : 'Every report we run on your account is listed below, each with what it is waiting on. They fill in as your marketplace data syncs.'}
                </p>
            </section>
        );
    }

    return (
        <section
            className="rounded-lg flex flex-col gap-[18px]"
            style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.borderHover}`, padding: 24 }}
        >
            <div className="flex flex-col gap-[9px]">
                <div className="flex items-center gap-[11px] flex-wrap">
                    <span
                        className="text-[10.5px] font-bold tracking-[.05em] rounded-[5px] px-2 py-1"
                        style={{ color: PALETTE.textTertiary, border: `1px solid ${PALETTE.borderHover}` }}
                    >
                        {report.cadence}
                    </span>
                    <span className="text-[12.5px]" style={{ color: PALETTE.textSecondary }}>{report.date}</span>
                </div>
                <h2 className="m-0 text-[22px] font-bold tracking-[-0.02em]">{report.name}</h2>
                {report.summary?.headline && (
                    <span className="text-[13px]" style={{ color: PALETTE.textTertiary }}>{report.summary.headline}</span>
                )}
            </div>

            {report.summary?.stats?.length > 0 && (
                <div className="flex gap-x-10 gap-y-6 flex-wrap">
                    {report.summary.stats.map((stat) => (
                        <Stat key={stat.label} stat={stat} currency={currency} />
                    ))}
                </div>
            )}

            <PreviewTable summary={report.summary} currency={currency} />

            {/* Rendered verbatim from the API: what this report cannot show, and why. */}
            {report.caveats?.length > 0 && (
                <div
                    className="flex flex-col gap-2 rounded-md"
                    style={{ background: PALETTE.amberBg, border: `1px solid ${PALETTE.amberBorder}`, padding: '12px 14px' }}
                >
                    <span className="text-[11px] font-bold tracking-[.05em]" style={{ color: PALETTE.amberLabel }}>
                        NOT INCLUDED
                    </span>
                    {report.caveats.map((caveat) => (
                        <p key={caveat} className="m-0 text-[12.5px] leading-[1.55]" style={{ color: PALETTE.amberSub }}>
                            {caveat}
                        </p>
                    ))}
                </div>
            )}
        </section>
    );
};

/**
 * One report card. Hovering lifts and outlines it; selecting it fills the panel
 * above. An unavailable report cannot be selected — it carries no data to show —
 * so it is dimmed and does not respond to hover either.
 */
const ReportCard = ({ report, selected, onSelect, onViewHistory }) => {
    const [hovered, setHovered] = useState(false);
    const interactive = report.available;
    const lifted = interactive && (hovered || selected);

    return (
        <div
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-pressed={interactive ? selected : undefined}
            aria-disabled={!interactive}
            onClick={() => interactive && onSelect(report.key)}
            onKeyDown={(event) => {
                if (!interactive) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(report.key);
                }
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            className="relative rounded-lg flex flex-col gap-[14px] outline-none"
            style={{
                background: lifted ? PALETTE.surfaceHover : PALETTE.surface,
                border: `1px solid ${selected ? PALETTE.accent : lifted ? PALETTE.borderHover : PALETTE.border}`,
                padding: '20px 20px 14px',
                cursor: interactive ? 'pointer' : 'default',
                opacity: interactive ? 1 : 0.55,
                // Scale rather than size changes so neighbouring cards never reflow.
                transform: lifted ? 'scale(1.025)' : 'scale(1)',
                boxShadow: lifted ? '0 10px 28px rgba(0,0,0,.35)' : 'none',
                transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease, background-color .18s ease',
                // Keeps a lifted card above its neighbours mid-animation.
                zIndex: lifted ? 1 : 0,
            }}
        >
            {selected && (
                <span
                    className="absolute top-[14px] right-[14px] text-[10px] font-bold tracking-[.05em] rounded px-1.5 py-[3px]"
                    style={{ color: PALETTE.accent, background: PALETTE.accentLight }}
                >
                    VIEWING
                </span>
            )}

            <div className="flex flex-col gap-[9px]">
                <span className="text-[13.5px] font-semibold pr-16" style={{ color: PALETTE.textBody }}>{report.name}</span>
                <div className="flex items-center gap-[9px] flex-wrap">
                    <span
                        className="text-[10.5px] tracking-[.05em] rounded px-[7px] py-[3px]"
                        style={{ color: PALETTE.textTertiary, border: `1px solid ${PALETTE.borderHover}` }}
                    >
                        {report.cadence}
                    </span>
                    <span className="text-xs" style={{ color: PALETTE.textMuted }}>{report.date || 'No edition yet'}</span>
                </div>
            </div>

            <p className="m-0 text-[15px] leading-[1.45] font-medium" style={{ color: TONE_COLOR[report.tone] || PALETTE.textBody }}>
                {report.available ? report.insight : report.reason}
            </p>

            <div className="mt-auto flex items-center pt-3" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
                <span className="flex-1 text-xs" style={{ color: PALETTE.textDim }}>
                    {report.available ? (selected ? 'Shown above' : 'Click to view summary') : 'Waiting on data'}
                </span>
                <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onViewHistory(); }}
                    className="flex-none text-xs"
                    style={{ color: PALETTE.textSecondary }}
                >
                    View history
                </button>
            </div>
        </div>
    );
};

const Reports = () => {
    const navigate = useNavigate();
    const currency = useSelector((state) => state.currency?.currency) || '$';

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    // null until the user picks one, at which point their choice wins over the
    // backend's suggested default for the rest of the visit.
    const [selectedKey, setSelectedKey] = useState(null);

    const loadReports = useCallback(async () => {
        try {
            const res = await axiosInstance.get('/api/pagewise/esf/reports');
            setData(res.data?.data || null);
            setFailed(false);
        } catch {
            // Fails quiet, like the Overview page: the header still renders and
            // the body shows an empty state rather than the page erroring out.
            setData(null);
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadReports(); }, [loadReports]);

    const reports = useMemo(() => data?.reports || [], [data]);

    const selected = useMemo(() => {
        if (!reports.length) return null;
        const chosen = reports.find((report) => report.key === selectedKey && report.available);
        if (chosen) return chosen;
        // Backend's pick: the most recently generated report that has data.
        return reports.find((report) => report.key === data?.featuredKey) || reports.find((report) => report.available) || null;
    }, [reports, selectedKey, data]);

    const availableCount = data?.counts?.available ?? 0;
    const totalCount = data?.counts?.total ?? 0;

    return (
        <div
            className="min-h-full w-full"
            style={{ background: PALETTE.bg, color: PALETTE.textPrimary, fontFamily: "system-ui, -apple-system, 'Helvetica Neue', Helvetica, sans-serif" }}
        >
            <div className="max-w-[1170px] mx-auto flex flex-col gap-[30px] px-8 md:px-10 py-9 md:py-11">

                <header className="flex items-end gap-[30px] flex-wrap">
                    <div className="flex-1 min-w-[240px] flex flex-col gap-[7px]">
                        <h1 className="m-0 text-[29px] font-semibold tracking-[-0.02em]">Reports</h1>
                        <p className="m-0 text-[13.5px]" style={{ color: PALETTE.textSecondary }}>
                            Every recurring report we publish on your account, kept by report type.
                        </p>
                    </div>
                    <span className="flex-none text-[12.5px] pb-[3px]" style={{ color: PALETTE.textSecondary }}>
                        Next report: <span style={{ color: PALETTE.textBody }}>{NEXT_REPORT.name}</span>, {NEXT_REPORT.due}
                    </span>
                </header>

                {loading ? <PanelSkeleton /> : <SummaryPanel report={selected} currency={currency} failed={failed} />}

                <section className="flex flex-col gap-4">
                    <div className="flex items-baseline gap-[10px] flex-wrap">
                        <h2 className="m-0 text-base font-bold tracking-[-0.01em]">All reports</h2>
                        <span className="flex-1 text-[12.5px]" style={{ color: PALETTE.textMuted }}>
                            {loading
                                ? 'Loading…'
                                : `${totalCount} recurring report${totalCount === 1 ? '' : 's'} · latest edition shown`}
                        </span>
                        {!loading && totalCount > 0 && (
                            <span className="flex-none text-xs" style={{ color: PALETTE.textDim }}>
                                {availableCount} with data available
                            </span>
                        )}
                    </div>

                    {loading && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[18px]">
                            {[0, 1, 2, 3, 4, 5].map((index) => (
                                <div
                                    key={index}
                                    className="rounded-lg animate-pulse"
                                    style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, height: 168 }}
                                />
                            ))}
                        </div>
                    )}

                    {!loading && reports.length === 0 && (
                        <div
                            className="rounded-lg text-[13px]"
                            style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: '28px 24px', color: PALETTE.textMuted }}
                        >
                            {failed
                                ? 'Reports could not be loaded just now. Refresh the page to try again.'
                                : 'No reports are available for this marketplace yet.'}
                        </div>
                    )}

                    {!loading && reports.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[18px]">
                            {reports.map((report) => (
                                <ReportCard
                                    key={report.key}
                                    report={report}
                                    selected={selected?.key === report.key}
                                    onSelect={setSelectedKey}
                                    onViewHistory={() => navigate('/seller-central-checker/estore-factory/report-history')}
                                />
                            ))}
                        </div>
                    )}
                </section>

            </div>
        </div>
    );
};

export default Reports;

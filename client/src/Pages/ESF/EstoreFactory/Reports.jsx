import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { PALETTE } from '../../../Components/ESF/estoreFactoryTheme.js';
import axiosInstance from '../../../config/axios.config.js';
import ReportDocumentPreview, { reportNeedsLandscape } from '../../../Components/ESF/ReportDocumentPreview.jsx';

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
 * Download produces the PDF in the browser from the document component itself
 * (see printReportDocument) rather than fetching a stored file — there is still
 * no recurring-report model, no generated files and no publishing schedule, so
 * what a client saves is this live edition, not an archived one.
 *
 * "View history" opens that report's own editions, read from the snapshot trail
 * each fetcher leaves behind (see the history section of EsfReportsService).
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

/**
 * Send one rendered report document to the printer, which is how a client saves
 * it as a PDF.
 *
 * Printing rather than rasterising with a PDF library is deliberate. The report
 * template already ships `@media print` rules, so print is the output path it
 * was designed for; the text stays selectable and vector-sharp instead of
 * becoming a screenshot; and it adds no dependency to a bundle that already
 * warns about its size. The markup handed in is the SAME component the preview
 * panel renders, so the saved file cannot drift from what was on screen.
 *
 * @param {string} html   outerHTML of the rendered document
 * @param {string} title  becomes the print dialog's default filename
 * @param {boolean} landscape  turn the page, for a table too wide for portrait
 */
const printReportDocument = (html, title, landscape = false) => {
    const frame = document.createElement('iframe');
    // Off-screen rather than display:none — a hidden frame does not lay out, and
    // an unlaid-out document prints blank.
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, {
        position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0',
    });
    document.body.appendChild(frame);

    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(
        '<!doctype html><html><head><meta charset="utf-8">'
        + `<title>${title.replace(/[<>]/g, '')}</title>`
        + '<style>'
        // Browsers drop background colours when printing unless told otherwise,
        // which would strip the navy banner and every flagged cell.
        // The emailed PDF turns the page for a wide table; so must this one,
        // or the saved copy loses its right-hand columns off the paper.
        + `@page{margin:14mm${landscape ? ';size:A4 landscape' : ''}}`
        + 'html,body{margin:0;padding:0;background:#fff;'
        + '-webkit-print-color-adjust:exact;print-color-adjust:exact}'
        + 'table{page-break-inside:auto}tr{page-break-inside:avoid}'
        + '</style></head><body>'
        + html
        + '</body></html>'
    );
    doc.close();

    const done = () => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        // Left long enough for the print dialog to take its snapshot; removing
        // the frame too early cancels the job in some browsers.
        setTimeout(() => frame.remove(), 1500);
    };

    // about:blank documents written this way are usually ready immediately, but
    // wait for load where the browser reports one.
    if (frame.contentWindow.document.readyState === 'complete') done();
    else frame.contentWindow.addEventListener('load', done, { once: true });
};

/** "Inventory Restock - US - Fetched 25 Apr 2026" */
const downloadName = (report, marketplace) =>
    [report.name, marketplace?.country, report.date].filter(Boolean).join(' - ');

/** Formats a stat or cell according to the `format` the API tagged it with. */
const formatValue = (value, format, currency) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value !== 'number') return value;
    // Per-unit money, to the cent — see the note in reportPdf.js formatCell.
    // 'currency' rounds to whole units, which is right for an aggregate and
    // wrong for a price or a gap.
    if (format === 'money') {
        const sign = value < 0 ? '-' : '';
        return `${sign}${currency}${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
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
            className="text-[10.5px] whitespace-nowrap"
            style={{ color: unchanged ? PALETTE.textMuted : improved ? PALETTE.good : PALETTE.amberValue }}
        >
            {unchanged ? '— no change' : `${stat.delta > 0 ? '▲' : '▼'} ${Math.abs(stat.delta)}${suffix}`}
        </span>
    );
};

const Stat = ({ stat, currency }) => (
    <div className="flex flex-col gap-1 flex-none min-w-[86px]">
        <span className="text-[10.5px] tracking-[.04em] uppercase whitespace-nowrap" style={{ color: PALETTE.textMuted }}>{stat.label}</span>
        <span
            className="text-[18px] font-semibold tracking-[-0.02em] tabular-nums leading-none"
            style={{ color: stat.tone ? TONE_COLOR[stat.tone] : PALETTE.textPrimary }}
        >
            {formatValue(stat.value, stat.format, currency)}
        </span>
        <DeltaCaption stat={stat} />
    </div>
);

/**
 * The data table, paged.
 *
 * Page 1 comes free with the card payload; every later page is fetched from
 * /esf/reports/:key/rows. Rows stay mounted while a page loads (dimmed rather
 * than replaced by a spinner) so the table does not collapse and jump the page
 * on every click.
 */
const PagedTable = ({ report, currency }) => {
    // Memoised: a fresh [] each render would give goTo a new identity every time
    // and re-fire the reset effect below on every parent render.
    const firstPage = useMemo(() => report.summary?.rows || [], [report.summary]);
    const columns = report.summary?.columns || [];
    const pageSize = report.pageSize || firstPage.length || 10;
    const totalRows = report.summary?.totalRows || 0;
    const totalPages = Math.max(Math.ceil(totalRows / pageSize), 1);

    const [page, setPage] = useState(1);
    const [rows, setRows] = useState(firstPage);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    // Switching report resets the table; page 1 is already in hand.
    useEffect(() => {
        setPage(1);
        setRows(firstPage);
        setFailed(false);
    }, [report.key, firstPage]);

    const goTo = useCallback(async (next) => {
        if (next < 1 || next > totalPages || next === page) return;
        if (next === 1) {
            setPage(1);
            setRows(firstPage);
            setFailed(false);
            return;
        }
        setLoading(true);
        try {
            const res = await axiosInstance.get(
                `/api/pagewise/esf/reports/${report.key}/rows`,
                { params: { page: next, limit: pageSize } }
            );
            const data = res.data?.data;
            if (data?.rows) {
                setRows(data.rows);
                setPage(data.page || next);
                setFailed(false);
            } else {
                setFailed(true);
            }
        } catch {
            // Keep the rows already on screen; only the pager reports the failure.
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [report.key, page, totalPages, pageSize, firstPage]);

    // A report can legitimately have nothing to list — no ASIN losing the Buy
    // Box, no stock ageing. That is a result, not an absence, so it is stated
    // rather than left as blank space under the stats.
    if (!firstPage.length) {
        if (!report.summary?.emptyMessage) return null;
        return (
            <p
                className="m-0 text-[13px] rounded-md"
                style={{ color: PALETTE.good, background: 'rgba(34,197,94,.08)', padding: '12px 14px' }}
            >
                {report.summary.emptyMessage}
            </p>
        );
    }

    const from = (page - 1) * pageSize + 1;
    const to = Math.min(from + rows.length - 1, totalRows);

    return (
        <div className="flex flex-col gap-2 min-h-0 h-full">
            {/* Only the rows scroll. The pager below stays put, so Next is always
                one click away rather than something you scroll down to find. */}
            <div
                className="w-full overflow-auto flex-1 min-h-0 esf-scroll"
                style={{ opacity: loading ? 0.45 : 1, transition: 'opacity .15s ease' }}
            >
                <table className="w-full border-collapse text-[12px] min-w-[460px]">
                    <thead>
                        <tr>
                            {columns.map((column) => (
                                <th
                                    key={column.key}
                                    className="text-left font-medium py-1.5 pr-4 whitespace-nowrap sticky top-0"
                                    // Sticky so the headers survive scrolling the rows;
                                    // needs its own background or rows show through.
                                    style={{ color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}`, background: PALETTE.surface }}
                                >
                                    {column.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => (
                            <tr key={`${page}-${index}`}>
                                {columns.map((column) => (
                                    <td
                                        key={column.key}
                                        className="py-[7px] pr-4 align-top"
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

            <div className="flex items-center gap-3 flex-wrap flex-none">
                <span className="flex-1 text-[11px]" style={{ color: PALETTE.textDim }}>
                    {failed
                        ? 'Could not load that page.'
                        : `${from.toLocaleString()}–${to.toLocaleString()} of ${totalRows.toLocaleString()} rows`}
                </span>
                {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                        <PagerButton onClick={() => goTo(page - 1)} disabled={page <= 1 || loading}>Previous</PagerButton>
                        <span className="text-xs tabular-nums" style={{ color: PALETTE.textSecondary }}>
                            Page {page} of {totalPages}
                        </span>
                        <PagerButton onClick={() => goTo(page + 1)} disabled={page >= totalPages || loading}>Next</PagerButton>
                    </div>
                )}
            </div>
        </div>
    );
};

const PagerButton = ({ onClick, disabled, children }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="text-xs px-3 py-[6px] rounded-md"
        style={{
            border: `1px solid ${PALETTE.border}`,
            color: disabled ? PALETTE.textDim : PALETTE.textBody,
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
        }}
    >
        {children}
    </button>
);

/** What the top panel shows before any data has loaded — same shape as the real one. */
const PanelSkeleton = () => (
    <section
        className="rounded-lg animate-pulse flex flex-col md:flex-row gap-7"
        style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, padding: 24 }}
    >
        <div
            className="flex-none rounded-md"
            style={{ width: DOC_TILE_WIDTH, height: DOC_TILE_HEIGHT, background: PALETTE.border }}
        />
        <div className="flex-1 flex flex-col gap-4">
            <div className="h-4 w-32 rounded" style={{ background: PALETTE.border }} />
            <div className="h-6 w-64 rounded" style={{ background: PALETTE.border }} />
            <div className="flex gap-7">
                {[0, 1, 2, 3].map((index) => (
                    <div key={index} className="flex flex-col gap-2">
                        <div className="h-3 w-16 rounded" style={{ background: PALETTE.border }} />
                        <div className="h-5 w-12 rounded" style={{ background: PALETTE.border }} />
                    </div>
                ))}
            </div>
            <div className="h-24 w-full rounded" style={{ background: PALETTE.border }} />
        </div>
    </section>
);

/**
 * The document thumbnail's box, matching the mock's preview tile.
 * DOC_TILE_HEIGHT is mirrored by the `md:max-h-[300px]` on the detail column —
 * change both together, or the two halves stop lining up.
 */
const DOC_TILE_WIDTH = 236;
const DOC_TILE_HEIGHT = 300;
/** Width the document is laid out at before being scaled down into the tile. */
const DOC_NATURAL_WIDTH = 640;
/** The same document laid out for a landscape page, in the same proportion. */
const DOC_LANDSCAPE_WIDTH = 960;
const DOC_SCALE = DOC_TILE_WIDTH / DOC_NATURAL_WIDTH;

/**
 * The document, shrunk to a page thumbnail you can scroll.
 *
 * `transform: scale` does not affect layout, so scaling alone would leave the
 * scroll container thinking the content is still full height — you would scroll
 * three screens of blank space past the end of the page. The content is
 * therefore measured and given a spacer of its *scaled* height, which is what
 * the container actually scrolls.
 */
const ScaledDocument = ({ children }) => {
    const innerRef = useRef(null);
    const [height, setHeight] = useState(0);

    useEffect(() => {
        const node = innerRef.current;
        if (!node) return undefined;
        // The document reflows as fonts load and as rows change, so measure
        // continuously rather than once on mount.
        if (typeof ResizeObserver === 'undefined') {
            setHeight(node.offsetHeight);
            return undefined;
        }
        const observer = new ResizeObserver(([entry]) => {
            setHeight(entry.contentRect.height);
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            className="overflow-y-auto overflow-x-hidden rounded-md esf-scroll esf-scroll--light"
            style={{
                width: DOC_TILE_WIDTH,
                height: DOC_TILE_HEIGHT,
                border: `1px solid ${PALETTE.border}`,
                background: '#fff',
            }}
        >
            <div style={{ position: 'relative', height: height * DOC_SCALE }}>
                <div
                    ref={innerRef}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: DOC_NATURAL_WIDTH,
                        transform: `scale(${DOC_SCALE})`,
                        transformOrigin: 'top left',
                    }}
                >
                    {children}
                </div>
            </div>
        </div>
    );
};

/**
 * The selected report, expanded.
 *
 * Keeps the mock's proportions: a small document thumbnail on the left, the
 * report's details and data to its right, and the whole panel short enough that
 * the report cards below stay above the fold. Anything taller than its box
 * scrolls inside that box rather than growing the panel.
 *
 * Both halves read from one payload, so the preview can never show a figure the
 * table disagrees with.
 */
const SummaryPanel = ({ report, currency, failed, marketplace }) => {
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
            className="rounded-lg flex flex-col md:flex-row gap-7"
            style={{ background: PALETTE.surface, border: `1px solid ${PALETTE.borderHover}`, padding: 24 }}
        >
            {/* Left: the document as it will be sent, as a scrollable thumbnail. */}
            <div className="flex-none flex flex-col gap-2">
                <ScaledDocument>
                    <ReportDocumentPreview report={report} marketplace={marketplace} currency={currency} />
                </ScaledDocument>
                <span className="text-[10.5px] tracking-[.04em]" style={{ color: PALETTE.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                    report preview &middot; scroll to read
                </span>
            </div>

            {/* Right: the same data, worked through. Capped to the thumbnail's
                height so the panel stays short and the cards below stay in view;
                the table scrolls within it rather than stretching the page. */}
            {/* max-h matches DOC_TILE_HEIGHT, but only from md up: stacked on a
                phone the column sits under the thumbnail with the page to grow
                into, and capping it there would squeeze the table for no reason.
                Written as a literal because Tailwind cannot read a JS constant. */}
            <div className="flex-1 min-w-0 flex flex-col gap-3 md:max-h-[300px]">
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-[10px] flex-wrap">
                        <span
                            className="text-[10px] font-bold tracking-[.05em] rounded px-1.5 py-[3px]"
                            style={{ color: PALETTE.textTertiary, border: `1px solid ${PALETTE.borderHover}` }}
                        >
                            {report.cadence}
                        </span>
                        <span className="text-[12px]" style={{ color: PALETTE.textSecondary }}>{report.date}</span>
                    </div>
                    <h2 className="m-0 text-[19px] font-bold tracking-[-0.02em] leading-tight">{report.name}</h2>
                    {report.summary?.headline && (
                        <span className="text-[12.5px]" style={{ color: PALETTE.textTertiary }}>{report.summary.headline}</span>
                    )}
                </div>

                {report.summary?.stats?.length > 0 && (
                    // One row, scrolled sideways when there are more stats than fit,
                    // so a six-stat report cannot push the table off the panel.
                    <div className="flex gap-x-7 overflow-x-auto pb-1 flex-none esf-scroll">
                        {report.summary.stats.map((stat) => (
                            <Stat key={stat.label} stat={stat} currency={currency} />
                        ))}
                    </div>
                )}

                <div className="flex-1 min-h-0">
                    <PagedTable report={report} currency={currency} />
                </div>

                {/* Rendered verbatim from the API: what this report cannot show, and
                    why. Capped and scrollable so a long caveat cannot squeeze the
                    table out of the panel. */}
                {report.caveats?.length > 0 && (
                    <div
                        className="flex-none flex flex-col gap-1 rounded-md overflow-y-auto esf-scroll"
                        style={{
                            background: PALETTE.amberBg,
                            border: `1px solid ${PALETTE.amberBorder}`,
                            padding: '8px 11px',
                            maxHeight: 74,
                        }}
                    >
                        <span className="text-[10px] font-bold tracking-[.05em]" style={{ color: PALETTE.amberLabel }}>
                            NOT INCLUDED
                        </span>
                        {report.caveats.map((caveat) => (
                            <p key={caveat} className="m-0 text-[11.5px] leading-[1.45]" style={{ color: PALETTE.amberSub }}>
                                {caveat}
                            </p>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
};

/**
 * One report card. Hovering lifts and outlines it; selecting it fills the panel
 * above. An unavailable report cannot be selected — it carries no data to show —
 * so it is dimmed and does not respond to hover either.
 */
const ReportCard = ({ report, selected, onSelect, onViewHistory, onDownload }) => {
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

            <div className="mt-auto flex items-center gap-2 pt-3" style={{ borderTop: `1px solid ${PALETTE.divider}` }}>
                <span className="flex-1 text-xs truncate" style={{ color: PALETTE.textDim }}>
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
                {/* The mock's download affordance, now real. Only offered where
                    there is a document to produce — a report with no data would
                    save a blank page. */}
                <button
                    type="button"
                    title={interactive ? `Download ${report.name} as PDF` : 'Nothing to download yet'}
                    aria-label={`Download ${report.name} as PDF`}
                    disabled={!interactive}
                    onClick={(event) => { event.stopPropagation(); onDownload(report); }}
                    className="flex-none w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs"
                    style={{
                        border: `1px solid ${PALETTE.border}`,
                        color: interactive ? PALETTE.textTertiary : PALETTE.textDim,
                        cursor: interactive ? 'pointer' : 'default',
                        opacity: interactive ? 1 : 0.4,
                    }}
                >
                    ↓
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

    // The report being turned into a PDF. Held in state so its document can be
    // rendered off-screen and handed to the printer — that way Download works on
    // ANY card, not only the one currently in the panel, and the saved file is
    // produced by the same component the preview uses.
    const [pendingDownload, setPendingDownload] = useState(null);
    const printRef = useRef(null);

    useEffect(() => {
        if (!pendingDownload || !printRef.current) return undefined;
        // One frame so the off-screen copy is laid out before it is read.
        const frameId = requestAnimationFrame(() => {
            const node = printRef.current;
            if (node) {
                printReportDocument(
                    node.innerHTML,
                    downloadName(pendingDownload, data?.marketplace),
                    reportNeedsLandscape(pendingDownload)
                );
            }
            setPendingDownload(null);
        });
        return () => cancelAnimationFrame(frameId);
    }, [pendingDownload, data]);

    const availableCount = data?.counts?.available ?? 0;
    const totalCount = data?.counts?.total ?? 0;

    return (
        <div
            className="flex w-full flex-1 flex-col"
            style={{ background: PALETTE.bg, color: PALETTE.textPrimary, fontFamily: "system-ui, -apple-system, 'Helvetica Neue', Helvetica, sans-serif" }}
        >
            <div className="w-full max-w-[1170px] mx-auto flex flex-col gap-[30px] px-8 md:px-10 py-9 md:py-11">

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

                {loading
                    ? <PanelSkeleton />
                    : <SummaryPanel report={selected} currency={currency} failed={failed} marketplace={data?.marketplace} />}

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
                                    onViewHistory={() => navigate(`/seller-central-checker/estore-factory/report-history/${report.key}`)}
                                    onDownload={setPendingDownload}
                                />
                            ))}
                        </div>
                    )}
                </section>

                {/* The document being printed, laid out off-screen at its natural
                    width. Off-screen rather than display:none, because a hidden
                    element has no layout and would print blank. */}
                {pendingDownload && (
                    <div
                        ref={printRef}
                        aria-hidden="true"
                        style={{
                            position: 'fixed', left: -99999, top: 0, pointerEvents: 'none',
                            width: reportNeedsLandscape(pendingDownload) ? DOC_LANDSCAPE_WIDTH : DOC_NATURAL_WIDTH,
                        }}
                    >
                        {/* full: a saved file must match the emailed PDF, not
                            the thumbnail in the panel. */}
                        <ReportDocumentPreview
                            report={pendingDownload}
                            marketplace={data?.marketplace}
                            currency={currency}
                            full
                        />
                    </div>
                )}

            </div>
        </div>
    );
};

export default Reports;

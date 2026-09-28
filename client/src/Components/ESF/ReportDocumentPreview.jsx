/**
 * ReportDocumentPreview
 *
 * The document a client is sent, in the layout of the Monthly Performance
 * Report the team designed by hand: logo header over a red rule, red-barred
 * section titles, grey stat tiles with a "vs <period>" change line, a Key
 * Takeaway box, charts, a blue-headed table, Performance Highlights, Actions
 * Taken, notes, and the navy/red footer band. Set in Poppins.
 *
 * One component serves all seven report types, and two jobs: the thumbnail in
 * the Reports panel, and — with `full` — the copy printed to PDF on Download.
 * Nothing here is per-report; titles, tiles, columns, charts and bullets all
 * come from the payload.
 *
 * KEEP IN STEP WITH server/Services/Reports/reportPdf.js, which draws the
 * emailed PDF from the same payload. BRAND below mirrors
 * server/Services/Reports/reportBrand.js, and the logo is the same file. Charts are NOT mirrored: they arrive
 * in the payload already drawn as SVG, so both files show the same picture.
 */
import { useEffect } from 'react';
import LOGO_SRC from '../../assets/Logo/esf-logo.png?inline';

/** Mirror of reportBrand.js BRAND. */
const BRAND = {
    blue: '#0B4F8C',
    navy: '#0A3A66',
    red: '#E3342F',
    teal: '#12A3B4',
    ink: '#1F2937',
    muted: '#6B7280',
    faint: '#9CA3AF',
    tile: '#F3F5F8',
    tileBorder: '#DCE1E8',
    takeaway: '#EAF1F8',
    zebra: '#F5F7FA',
    grid: '#E1E6ED',
    white: '#FFFFFF',
};

const COMPANY = 'eStore Factory';

/**
 * The eStore Factory logo, the same file the emailed PDF embeds
 * (server/assets/brand/esf-logo.png). Inlined as a data URL, so the print
 * window has nothing to fetch before it prints.
 */
const LOGO_ALT = COMPANY;

const FONT = 'Poppins, Arial, Helvetica, sans-serif';

/** Loaded for the document only, not the app. Also linked into the print frame. */
export const POPPINS_HREF = 'https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&display=swap';

const ensurePoppins = () => {
    if (typeof document === 'undefined' || document.querySelector(`link[href="${POPPINS_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = POPPINS_HREF;
    document.head.appendChild(link);
};

/** Rows shown inside the document preview — it is a sample, not the full table. */
const DOC_ROWS = 4;

/**
 * Rows in a downloaded copy. Matches MAX_PDF_ROWS in reportPdf.js so the file a
 * client saves and the file they are emailed hold the same data.
 */
export const FULL_ROWS = 40;

/**
 * Past this many columns a printed copy needs a landscape page. Mirrors
 * LANDSCAPE_COLUMN_THRESHOLD in server/Services/Reports/reportPdf.js, so the
 * file a client saves and the file they are emailed break the same way.
 */
export const WIDE_TABLE_COLUMNS = 9;

/** Whether this report's widest table needs the page turned. */
export const reportNeedsLandscape = (report) => Math.max(
    report?.summary?.columns?.length || 0,
    report?.summary?.secondaryTable?.columns?.length || 0,
    report?.comparison?.columns?.length || 0,
    ...(report?.sections || []).flatMap((section) => [
        section.summary?.columns?.length || 0,
        section.summary?.secondaryTable?.columns?.length || 0,
    ])
) > WIDE_TABLE_COLUMNS;

/**
 * "Showing the first N of M rows", worded as truncationNote in reportPdf.js,
 * so a saved file says it was cut exactly where the emailed one does.
 */
const TruncationNote = ({ total, shown }) => {
    if (!total || total <= shown) return null;
    return (
        <p style={{ margin: '4px 0 12px', fontSize: 10, fontStyle: 'italic', color: BRAND.muted }}>
            Showing the first {shown} of {Number(total).toLocaleString('en-GB')} rows. The full set is on your Reports page.
        </p>
    );
};

const formatCell = (value, format, currency) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value !== 'number') return value;
    // Per-unit money, to the cent — see the note in reportPdf.js formatCell.
    // 'currency' rounds to whole units, which is right for an aggregate and
    // wrong for a price or a gap.
    if (format === 'money') {
        const sign = value < 0 ? '-' : '';
        return `${sign}${currency}${Math.abs(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (format === 'currency') return `${currency}${value.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
    if (format === 'percent') return `${value}%`;
    return value.toLocaleString('en-GB');
};

/** Numbers sit right, words left — the same rule as reportPdf.js. */
const isNumericColumn = (column, rows) => ['number', 'currency', 'money', 'percent'].includes(column.format)
    || (rows.length > 0 && rows.every((row) => {
        const value = row[column.key];
        return typeof value === 'number' || value === null || value === undefined || value === ''
            || /^[-+—]|^[\d.,]+(%| pts|x)?$/.test(String(value));
    }));

/** Coloured bar, blue capitals, grey italic subtitle. */
const SectionTitle = ({ title, subtitle, color = BRAND.red }) => (
    <div style={{ margin: '18px 0 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 4, height: 19, background: color, flex: 'none' }} />
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: BRAND.blue, textTransform: 'uppercase', letterSpacing: '.2px' }}>
                {title}
            </h2>
        </div>
        {subtitle && (
            <div style={{ margin: '3px 0 0 12px', fontSize: 11, fontStyle: 'italic', color: BRAND.muted }}>{subtitle}</div>
        )}
    </div>
);

const Triangle = ({ up, color }) => (
    <svg width="8" height="8" viewBox="0 0 6 6" style={{ flex: 'none' }} aria-hidden="true">
        <path d={up ? 'M3 0.5 L5.8 5.5 L0.2 5.5 Z' : 'M0.2 0.5 L5.8 0.5 L3 5.5 Z'} fill={color} />
    </svg>
);

const StatTile = ({ stat, currency, comparisonLabel, reserveDeltaLine }) => {
    const hasDelta = stat.delta !== null && stat.delta !== undefined;
    const improved = stat.deltaGoodWhen === 'down' ? stat.delta < 0 : stat.delta > 0;
    const suffix = stat.deltaFormat === 'percent' ? '%' : stat.deltaFormat === 'points' ? ' pts' : '';
    const color = stat.delta === 0 ? BRAND.muted : improved ? BRAND.teal : BRAND.red;

    return (
        <div style={{ flex: 1, minWidth: 0, background: BRAND.tile, border: `1px solid ${BRAND.tileBorder}`, padding: '11px 12px' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '.2px' }}>{stat.label}</div>
            <div style={{ fontSize: 23, fontWeight: 700, color: BRAND.blue, marginTop: 3, wordBreak: 'break-word', lineHeight: 1.2 }}>
                {formatCell(stat.value, stat.format, currency)}
            </div>
            {hasDelta ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, fontSize: 10, fontWeight: 700, color }}>
                    {stat.delta === 0
                        ? `No change${comparisonLabel ? ` ${comparisonLabel}` : ''}`
                        : (
                            <>
                                <Triangle up={stat.delta > 0} color={color} />
                                <span>{`${Math.abs(stat.delta)}${suffix}`}</span>
                                {comparisonLabel && <span style={{ marginLeft: 3 }}>{comparisonLabel}</span>}
                            </>
                        )}
                </div>
            ) : reserveDeltaLine && <div style={{ height: 15, marginTop: 3 }} />}
        </div>
    );
};

/** Tiles four to a row; a short last row stretches, as in the reference. */
const StatTiles = ({ stats, currency, comparisonLabel }) => {
    const rows = [];
    for (let i = 0; i < stats.length; i += 4) rows.push(stats.slice(i, i + 4));
    const hasDelta = (stat) => stat.delta !== null && stat.delta !== undefined;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {rows.map((row) => (
                <div key={row.map((stat) => stat.label).join('|')} style={{ display: 'flex', gap: 8 }}>
                    {row.map((stat) => (
                        <StatTile
                            key={stat.label}
                            stat={stat}
                            currency={currency}
                            comparisonLabel={comparisonLabel}
                            reserveDeltaLine={row.some(hasDelta)}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
};

const DataTable = ({ columns, rows, currency, full, totalRows, shownLimit }) => {
    const numeric = columns.map((column) => isNumericColumn(column, rows));
    // Numbers and short identifiers (an ASIN, a date) never wrap mid-value;
    // left to break-word, a long product name squeezed "B0H2MZ33N8" onto two
    // lines and "₹2,496" into "₹2,49 / 6".
    const keepWhole = columns.map((column, i) => numeric[i]
        || Math.max(...rows.map((row) => String(row[column.key] ?? '').length)) <= 16);
    const cellPad = full ? '6px 5px' : '7px 6px';
    return (
        <div style={full ? undefined : { overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: full ? 10 : 11, marginBottom: 4, tableLayout: 'auto' }}>
                <thead>
                    <tr>
                        {columns.map((column, i) => (
                            <th
                                key={column.key}
                                style={{
                                    background: BRAND.blue, color: BRAND.white, fontSize: full ? 8.5 : 9.5, fontWeight: 700,
                                    textTransform: 'uppercase', letterSpacing: '.2px',
                                    textAlign: i > 0 ? (column.align || (numeric[i] ? 'right' : 'left')) : 'left',
                                    padding: cellPad,
                                    border: `1px solid ${BRAND.grid}`,
                                    // Wrapping a header costs a line; not wrapping it costs the
                                    // columns that fall off the right-hand edge of the page.
                                    whiteSpace: full ? 'normal' : 'nowrap',
                                }}
                            >
                                {column.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={index} style={{ background: index % 2 === 1 ? BRAND.zebra : BRAND.white }}>
                            {columns.map((column, i) => (
                                <td
                                    key={column.key}
                                    style={{
                                        padding: cellPad,
                                        wordBreak: full && !keepWhole[i] ? 'break-word' : undefined,
                                        whiteSpace: keepWhole[i] ? 'nowrap' : undefined,
                                        border: `1px solid ${BRAND.grid}`,
                                        textAlign: i > 0 ? (column.align || (numeric[i] ? 'right' : 'left')) : 'left',
                                        fontWeight: i === 0 ? 700 : 400,
                                        color: i === 0 ? BRAND.blue : BRAND.ink,
                                    }}
                                >
                                    {formatCell(row[column.key], (i > 0 && row.__format) || column.format, currency)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {full && <TruncationNote total={totalRows} shown={Math.min(rows.length, shownLimit)} />}
        </div>
    );
};

const Bullets = ({ items, muted = false }) => (
    <ul style={{ listStyle: 'none', margin: '0 0 6px', padding: 0 }}>
        {items.map((item) => (
            <li
                key={item.text}
                style={{
                    position: 'relative', paddingLeft: 14, marginBottom: 7, fontSize: 12, lineHeight: 1.45,
                    color: muted ? BRAND.muted : BRAND.ink, fontStyle: muted ? 'italic' : 'normal',
                }}
            >
                <span style={{ position: 'absolute', left: 0, color: item.tone === 'watch' ? BRAND.red : BRAND.ink }}>•</span>
                {item.text}
            </li>
        ))}
    </ul>
);

const issueDate = () => new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

/**
 * @param {boolean} full  render everything, for the off-screen copy that gets
 *   printed to PDF. The on-screen panel is a thumbnail and stays truncated.
 *
 * WHY THIS PROP EXISTS
 * One component serves two jobs. In the panel the truncation is the point — it
 * is a small preview beside the data table. In a download it is a bug: the
 * saved file silently lost every stat past the fourth and every column past the
 * fifth, which on the Buy Box report meant four of nine tiles and seven of
 * twelve columns, including the whole of the competitor pricing.
 */
/** A smaller blue heading, for a table inside a marketplace's section. */
const SubTitle = ({ children }) => (
    <div style={{ fontSize: 11.5, fontWeight: 700, color: BRAND.blue, textTransform: 'uppercase', letterSpacing: '.3px', margin: '6px 0 7px' }}>
        {children}
    </div>
);

const Takeaway = ({ text }) => (text ? (
    <div style={{ background: BRAND.takeaway, borderLeft: `4px solid ${BRAND.blue}`, padding: '10px 14px', marginBottom: 16 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.blue, letterSpacing: '.3px' }}>KEY TAKEAWAY</div>
        <div style={{ fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>{text}</div>
    </div>
) : null);

const Charts = ({ charts }) => (charts.length > 0 ? (
    <div style={{ display: 'flex', gap: 24, marginBottom: 8, breakInside: 'avoid' }}>
        {charts.map((chart) => (
            <div key={chart.title} style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: BRAND.blue, marginBottom: 4 }}>{chart.title}</div>
                {/* Drawn by the server from numbers only (reportBrand.js escapes every label). */}
                <div dangerouslySetInnerHTML={{ __html: String(chart.svg).replace('<svg ', '<svg style="width:100%;height:auto;display:block" ') }} />
            </div>
        ))}
    </div>
) : null);

/** A report body — main table then second table — in the given currency. */
const Detail = ({ summary, tableTitle, currency, full, sub = false }) => {
    const allColumns = summary.columns || [];
    const columns = full ? allColumns : allColumns.slice(0, 5);
    const rows = (summary.rows || []).slice(0, full ? FULL_ROWS : DOC_ROWS);
    const secondary = summary.secondaryTable;
    return (
        <>
            {sub ? <SubTitle>{tableTitle || 'Detail'}</SubTitle> : <SectionTitle title={tableTitle || 'Detail'} subtitle={summary.headline} />}
            {rows.length > 0 ? (
                <DataTable columns={columns} rows={rows} currency={currency} full={full} totalRows={summary.totalRows} shownLimit={FULL_ROWS} />
            ) : (
                <p style={{ margin: '0 0 8px', fontSize: 12, color: BRAND.teal, fontWeight: 700 }}>
                    {summary.emptyMessage || 'Nothing to list for this period.'}
                </p>
            )}
            {secondary?.rows?.length > 0 && (
                <>
                    {sub ? <SubTitle>{secondary.title || 'Detail'}</SubTitle> : <SectionTitle title={secondary.title || 'Detail'} />}
                    <DataTable columns={secondary.columns} rows={secondary.rows} currency={currency} full={full} totalRows={secondary.totalRows} shownLimit={FULL_ROWS} />
                </>
            )}
        </>
    );
};

/**
 * @param {boolean} full  render everything, for the off-screen copy that gets
 *   printed to PDF. The on-screen panel is a thumbnail and stays truncated.
 *
 * WHY THIS PROP EXISTS
 * One component serves two jobs. In the panel the truncation is the point — it
 * is a small preview beside the data table. In a download it is a bug: the
 * saved file silently lost every stat past the fourth and every column past the
 * fifth, which on the Buy Box report meant four of nine tiles and seven of
 * twelve columns, including the whole of the competitor pricing.
 *
 * ACCOUNT-WIDE REPORTS (report.multi)
 * A client with several marketplaces gets one report covering them all, laid
 * out as reportPdf.js lays it out: an Executive Summary led by the primary
 * marketplace, the All Marketplaces comparison, then a section per
 * marketplace in its own currency. The thumbnail stops after the comparison.
 */
const ReportDocumentPreview = ({ report, marketplace, currency, clientName = '', full = false }) => {
    useEffect(ensurePoppins, []);
    if (!report?.available) return null;

    const lead = report.marketplace || marketplace;
    const leadCurrency = lead?.currency || currency;
    const multi = Boolean(report.multi && report.sections?.length > 1);
    const countries = multi ? report.sections.map((section) => section.marketplace.country) : [];
    const place = multi ? `Amazon ${countries.join(' & ')}` : (lead?.country ? `Amazon ${lead.country}` : 'All marketplaces');

    const summary = report.summary || {};
    const overview = multi ? (report.overview || {}) : summary;
    const allStats = overview.stats || [];
    const stats = full ? allStats : allStats.slice(0, 4);
    const charts = full ? (overview.charts || []).slice(0, 2) : [];
    const written = (report.highlights || []).filter((item) => item.tone !== 'fill');
    const toFill = (report.highlights || []).filter((item) => item.tone === 'fill');
    const subtitle = multi
        ? [`Amazon ${lead.country} (${report.isPrimary ? 'primary marketplace' : 'leading marketplace'})`, report.date].join(' · ')
        : [place, report.date].filter(Boolean).join(' · ');

    // Header: logo, then the report title and who it is for.
    const header = (
        <div style={{ paddingTop: full ? 4 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <img src={LOGO_SRC} alt={LOGO_ALT} style={{ width: 176, height: 'auto', flex: 'none', display: 'block' }} />
                <div style={{ textAlign: 'right', minWidth: 0 }}>
                    <h1 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: BRAND.blue, textTransform: 'uppercase', letterSpacing: '.4px' }}>
                        {report.name}
                    </h1>
                    <div style={{ marginTop: 2, fontSize: 10.5, color: BRAND.muted }}>
                        {[clientName, place].filter(Boolean).join(' · ')}
                    </div>
                </div>
            </div>
            <div style={{ height: 2, background: BRAND.red, margin: '9px 0 4px' }} />
        </div>
    );

    // The reference footer band. A browser print cannot number its pages,
    // so the page count lives only in the emailed PDF.
    const footer = (
        <div style={{ display: 'flex', margin: full ? '10px -26px 0' : '0 -26px' }}>
            <div style={{ width: '14%', background: BRAND.navy }} />
            <div style={{ flex: 1, background: BRAND.red, color: BRAND.white, textAlign: 'center', fontSize: 10.5, padding: '6px 0' }}>{COMPANY}</div>
            <div style={{ width: '14%', background: BRAND.navy }} />
        </div>
    );

    const body = (
        <>
            <SectionTitle title="Executive Summary" subtitle={subtitle} />
            {stats.length > 0 && <StatTiles stats={stats} currency={leadCurrency} comparisonLabel={overview.comparisonLabel} />}
            <Takeaway text={overview.takeaway} />
            <Charts charts={charts} />

            {/* A report with charts fills its first page, as the reference does. */}
            <div style={charts.length ? { breakBefore: 'page', pageBreakBefore: 'always' } : undefined}>
                {multi ? (
                    <>
                        <SectionTitle title="All Marketplaces" subtitle={`${report.date} snapshot · ${countries.length} marketplaces, each in its own currency`} />
                        <DataTable columns={report.comparison.columns} rows={report.comparison.rows} currency={leadCurrency} full={full} totalRows={0} shownLimit={FULL_ROWS} />
                    </>
                ) : (
                    <Detail summary={summary} tableTitle={report.tableTitle} currency={leadCurrency} full={full} />
                )}
            </div>

            {multi && full && report.sections.map((section) => {
                const headline = section.summary?.headline || '';
                const sectionSubtitle = headline.includes(section.date) ? headline : [section.date, headline].filter(Boolean).join(' · ');
                return (
                    <div key={`${section.marketplace.country}-${section.marketplace.region}`}>
                        <SectionTitle title={`Amazon ${section.marketplace.country}`} subtitle={section.available ? sectionSubtitle : section.reason} />
                        {section.available && (
                            <>
                                <StatTiles stats={section.summary.stats || []} currency={section.marketplace.currency} comparisonLabel={section.summary.comparisonLabel} />
                                <Detail summary={section.summary} tableTitle={section.tableTitle} currency={section.marketplace.currency} full sub />
                            </>
                        )}
                    </div>
                );
            })}

            {written.length > 0 && (
                <>
                    <SectionTitle title="Performance Highlights" color={BRAND.blue} />
                    <Bullets items={written} />
                </>
            )}
            {toFill.length > 0 && (
                <>
                    <SectionTitle title={report.cadence === 'MONTHLY' ? 'Actions Taken This Month' : 'Actions Taken This Cycle'} />
                    <Bullets items={toFill} muted />
                </>
            )}

            {/* The caveats the API returns are what this document cannot cover. They
                belong on the page itself, not only in the app, so whoever reads the
                sent report sees the same limits. */}
            {report.caveats?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: BRAND.muted, letterSpacing: '.3px', marginBottom: 3 }}>NOTES</div>
                    {report.caveats.map((caveat) => (
                        <p key={caveat} style={{ margin: '0 0 4px', fontSize: 9.5, color: BRAND.muted, lineHeight: 1.4 }}>{caveat}</p>
                    ))}
                </div>
            )}
            <div style={{ fontSize: 10.5, color: BRAND.muted, margin: '14px 0 16px' }}>{issueDate()}</div>
        </>
    );

    const page = { background: BRAND.white, color: BRAND.ink, fontFamily: FONT, boxShadow: full ? 'none' : '0 1px 4px rgba(0,0,0,0.15)', padding: '18px 26px 0' };

    // The on-screen thumbnail: one header, one footer.
    if (!full) {
        return (
            <div style={page}>
                {header}
                {body}
                {footer}
            </div>
        );
    }

    // The printed copy: the logo header and footer band repeat on EVERY page,
    // as they do in the emailed PDF. A table's thead and tfoot are the one
    // construct browsers repeat across printed pages; the row holding the body
    // is allowed to break, overriding the print sheet's tr{break-inside:avoid}.
    const cell = { padding: 0, border: 0 };
    return (
        <div style={page}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><td style={cell}>{header}</td></tr></thead>
                <tfoot><tr><td style={cell}>{footer}</td></tr></tfoot>
                <tbody>
                    <tr style={{ breakInside: 'auto', pageBreakInside: 'auto' }}>
                        <td style={cell}>{body}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
};

export default ReportDocumentPreview;

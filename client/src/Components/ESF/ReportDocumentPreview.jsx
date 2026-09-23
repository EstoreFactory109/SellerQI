/**
 * ReportDocumentPreview
 *
 * A preview of the document a client is sent, rendered from the shared report
 * template (report-template.html): navy title banner, stat tiles, a teal-ruled
 * section with the data table, and the Performance Highlights bullets.
 *
 * One component serves all seven report types. Nothing here is per-report —
 * the title, the tile labels, the table's column headers and the bullets all
 * come from the report payload, which is what the template intends by "swap the
 * <h1>, change the <th>s, reuse the same cell classes".
 *
 * It renders on white, unlike the rest of the dark ESF section, because it is a
 * preview of a printed/emailed page rather than another panel of the app. The
 * palette is the template's own and is deliberately NOT drawn from
 * estoreFactoryTheme.js — the document keeps its identity wherever it appears.
 */

/** The template's palette, copied verbatim from report-template.html's :root. */
const DOC = {
    navy: '#1F3864',
    teal: '#0E7C7B',
    light: '#DCE6F1',
    yellow: '#FFF2CC',
    red: '#C00000',
    green: '#1E7E34',
    greenBg: '#E2EFDA',
    blueInput: '#0000FF',
    border: '#B7B7B7',
    subtitle: '#D9E2F3',
    zebra: '#FAFBFD',
    ink: '#111',
};

const FONT = 'Arial, Helvetica, sans-serif';

/** Rows shown inside the document preview — it is a sample, not the full table. */
const DOC_ROWS = 4;

const formatCell = (value, format, currency) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value !== 'number') return value;
    if (format === 'currency') return `${currency}${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    if (format === 'percent') return `${value}%`;
    return value.toLocaleString();
};

/**
 * Which cell treatment a value earns.
 *
 * The template's three states carry meaning, so they are applied from the data
 * rather than sprinkled for decoration: `ok` where a stat is healthy, `flag`
 * where it needs attention, `fill-in` for the figures a person still enters.
 */
const toneStyle = (tone) => {
    if (tone === 'good') return { background: DOC.greenBg, color: DOC.green, fontWeight: 700, textAlign: 'center' };
    if (tone === 'watch') return { background: DOC.yellow, color: DOC.red, fontWeight: 700, textAlign: 'center' };
    return null;
};

const StatTile = ({ stat, currency }) => {
    const hasDelta = stat.delta !== null && stat.delta !== undefined;
    const improved = stat.deltaGoodWhen === 'down' ? stat.delta < 0 : stat.delta > 0;
    const suffix = stat.deltaFormat === 'percent' ? '%' : stat.deltaFormat === 'points' ? ' pts' : '';

    return (
        <div style={{ flex: 1, background: DOC.light, textAlign: 'center', padding: '14px 8px', minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase' }}>{stat.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: DOC.navy, marginTop: 4, wordBreak: 'break-word' }}>
                {formatCell(stat.value, stat.format, currency)}
            </div>
            {hasDelta && (
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, color: stat.delta === 0 ? '#777' : improved ? DOC.green : DOC.red }}>
                    {stat.delta === 0 ? '—' : `${stat.delta > 0 ? '▲' : '▼'} ${Math.abs(stat.delta)}${suffix}`}
                </div>
            )}
        </div>
    );
};

const ReportDocumentPreview = ({ report, marketplace, currency }) => {
    if (!report?.available) return null;

    const stats = (report.summary?.stats || []).slice(0, 4);
    const columns = (report.summary?.columns || []).slice(0, 5);
    const rows = (report.summary?.rows || []).slice(0, DOC_ROWS);
    const place = marketplace?.country ? `Amazon ${marketplace.country}` : 'All marketplaces';

    return (
        <div style={{ background: '#fff', color: DOC.ink, fontFamily: FONT, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>

            {/* Title banner — the only per-report text in the chrome. */}
            <div style={{ background: DOC.navy, color: '#fff', textAlign: 'center', padding: '18px 16px 14px' }}>
                <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase' }}>
                    {report.name}
                </h1>
                <div style={{ marginTop: 4, fontSize: 12, fontStyle: 'italic', color: DOC.subtitle }}>
                    {place} &middot; {report.date}
                </div>
            </div>

            {stats.length > 0 && (
                <div style={{ display: 'flex', gap: 2, background: DOC.border, padding: 16, paddingBottom: 0, flexWrap: 'wrap' }}>
                    {stats.map((stat) => <StatTile key={stat.label} stat={stat} currency={currency} />)}
                </div>
            )}

            <div style={{ padding: '20px 24px 4px' }}>
                <h2 style={{ fontSize: 14, color: DOC.teal, borderBottom: `2px solid ${DOC.teal}`, paddingBottom: 6, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '.3px' }}>
                    {report.summary?.headline ? 'Summary' : 'Detail'}
                </h2>

                {rows.length > 0 ? (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 }}>
                            <thead>
                                <tr>
                                    {columns.map((column) => (
                                        <th
                                            key={column.key}
                                            style={{ background: DOC.navy, color: '#fff', fontSize: 11, textAlign: 'center', padding: '8px 6px', border: `1px solid ${DOC.border}`, whiteSpace: 'nowrap' }}
                                        >
                                            {column.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, index) => (
                                    <tr key={index} style={{ background: index % 2 === 1 ? DOC.zebra : '#fff' }}>
                                        {columns.map((column, cellIndex) => {
                                            const applied = cellIndex === 0 ? null : toneStyle(row.__tone?.[column.key]);
                                            return (
                                                <td
                                                    key={column.key}
                                                    style={{
                                                        padding: '8px 6px',
                                                        border: `1px solid ${DOC.border}`,
                                                        textAlign: cellIndex === 0 ? 'left' : 'center',
                                                        // First column is the identifier the manager checks each
                                                        // cycle, so it takes the template's blue "fill in" ink.
                                                        color: cellIndex === 0 ? DOC.blueInput : DOC.ink,
                                                        ...(applied || {}),
                                                    }}
                                                >
                                                    {formatCell(row[column.key], column.format, currency)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p style={{ margin: '0 0 8px', fontSize: 12.5, color: DOC.green, fontWeight: 700 }}>
                        {report.summary?.emptyMessage || 'Nothing to list for this period.'}
                    </p>
                )}
            </div>

            {report.highlights?.length > 0 && (
                <div style={{ padding: '8px 24px 4px' }}>
                    <h2 style={{ fontSize: 14, color: DOC.teal, borderBottom: `2px solid ${DOC.teal}`, paddingBottom: 6, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '.3px' }}>
                        Performance Highlights
                    </h2>
                    <ul style={{ listStyle: 'none', margin: '0 0 14px', padding: 0 }}>
                        {report.highlights.map((item) => (
                            <li
                                key={item.text}
                                style={{
                                    position: 'relative',
                                    paddingLeft: 16,
                                    marginBottom: 8,
                                    fontSize: 12.5,
                                    lineHeight: 1.45,
                                    color: item.tone === 'watch' ? DOC.red : item.tone === 'fill' ? DOC.blueInput : DOC.ink,
                                    fontStyle: item.tone === 'fill' ? 'italic' : 'normal',
                                }}
                            >
                                <span style={{ color: DOC.teal, fontWeight: 700, position: 'absolute', left: 0 }}>•</span>
                                {item.text}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* The caveats the API returns are what this document cannot cover. They
                belong on the page itself, not only in the app, so whoever reads the
                sent report sees the same limits. */}
            {report.caveats?.length > 0 && (
                <div style={{ padding: '0 24px 8px' }}>
                    {report.caveats.map((caveat) => (
                        <p key={caveat} style={{ margin: '0 0 6px', fontSize: 11, fontStyle: 'italic', color: DOC.red }}>
                            Not included: {caveat}
                        </p>
                    ))}
                </div>
            )}

            <div style={{ padding: '12px 24px 20px', fontSize: 10.5, fontStyle: 'italic', color: '#888' }}>
                Legend: Blue text = fill in with this cycle&rsquo;s figures &nbsp;|&nbsp;
                Green = on target / healthy &nbsp;|&nbsp;
                Yellow/red = flagged, needs attention or action
            </div>
        </div>
    );
};

export default ReportDocumentPreview;

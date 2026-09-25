/**
 * Report PDF renderer.
 *
 * Turns one report from EsfReportsService into the PDF a client is emailed,
 * reproducing the shared report template (report-template.html): navy title
 * banner, stat tiles, teal-ruled sections, a bordered data table, and the
 * Performance Highlights bullets.
 *
 * WHY THIS REDRAWS THE TEMPLATE RATHER THAN PRINTING THE HTML
 * The on-screen preview is React, and printing it would need a headless browser
 * on the EC2 box — Chromium plus ~20 apt packages that the deploy workflow
 * (npm ci + pm2 restart) does not install, so it would fail silently in
 * production. pdfmake is pure JS and needs nothing.
 *
 * The cost is that the LAYOUT exists twice: here and in
 * client/src/Components/ESF/ReportDocumentPreview.jsx. The DATA does not — both
 * render the same `report` payload, so the numbers can never disagree, only the
 * styling can. The palette below is the template's `:root`, copied verbatim, and
 * is the thing to keep in step if the design changes.
 *
 * Fonts are PDF's built-in Helvetica family: no font files to ship, and the
 * template already asks for Arial/Helvetica.
 */
const pdfmake = require('pdfmake');

/** report-template.html :root, verbatim. */
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
    ink: '#111111',
    muted: '#888888',
    tileLabel: '#555555',
};

/** Rows per PDF. A 27,000-row catalogue is a spreadsheet, not a report. */
const MAX_PDF_ROWS = 40;

/**
 * Past this many columns the table is turned sideways.
 *
 * pdfmake does not shrink text to fit and does not warn: a table wider than
 * the page is drawn past the right margin, off the paper, with the content
 * still present and simply unreadable. Wrapping cannot save it either, because
 * a column's floor is its widest unbreakable word — and the two widest columns
 * in the Buy Box report hold an Amazon merchant token and a seller's own SKU,
 * neither of which contains a space to break at.
 *
 * Measured rather than guessed: twelve columns with a realistic SKU need 561pt
 * even at 7pt type, and A4 portrait leaves 515pt. Landscape leaves 762pt.
 * Shrinking the type instead would have meant 6pt — unreadable, and still one
 * long SKU from overflowing again. reportPdfTableWidth.test.js pins both
 * numbers.
 *
 * Nine columns still fit portrait comfortably, so every report that fitted
 * before is laid out exactly as it was.
 */
const LANDSCAPE_COLUMN_THRESHOLD = 9;

/** The widest table in a report — the primary one or its secondary. */
const widestTableColumnCount = (report) => Math.max(
    report?.summary?.columns?.length || 0,
    report?.summary?.secondaryTable?.columns?.length || 0
);

/**
 * The 14 fonts every PDF reader has built in. pdfmake resolves these through
 * the same local-access hook it uses for real files, so they have to be named
 * explicitly in the allow-list below or font loading is denied.
 */
const STANDARD_PDF_FONTS = new Set([
    'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
    'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
    'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
    'Symbol', 'ZapfDingbats',
]);

let fontsRegistered = false;

/**
 * pdfmake is a singleton, so fonts and access policies are registered once.
 *
 * The access policies are an allow-list of exactly the built-in font names:
 * these documents embed no images and reference no URLs, so any other file read
 * or network fetch is a bug at best. Report content is client data, and a
 * document generator that will fetch what its input tells it to is an SSRF
 * waiting to happen.
 */
const ensureConfigured = () => {
    if (fontsRegistered) return;
    pdfmake.addFonts({
        Helvetica: {
            normal: 'Helvetica',
            bold: 'Helvetica-Bold',
            italics: 'Helvetica-Oblique',
            bolditalics: 'Helvetica-BoldOblique',
        },
    });
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((name) => STANDARD_PDF_FONTS.has(name));
    fontsRegistered = true;
};

/** Mirrors formatCell in ReportDocumentPreview.jsx. */
const formatCell = (value, format, currency) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value !== 'number') return String(value);
    // Per-unit money, to the cent. Distinct from 'currency', which rounds to
    // whole units — right for "Total sales $124,530", wrong for a price gap,
    // where the cents ARE the finding: a $4.99 gap rendered as "$5" against a
    // $17.50 Buy Box price rendered as "$18" does not even add up on the page.
    if (format === 'money') {
        const sign = value < 0 ? '-' : '';
        return `${sign}${currency}${Math.abs(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (format === 'currency') return `${currency}${value.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
    if (format === 'percent') return `${value}%`;
    return value.toLocaleString('en-GB');
};

/** The template's title banner. A one-cell table is how pdfmake fills a band. */
const banner = (report, subtitle) => ({
    table: {
        widths: ['*'],
        body: [[{
            stack: [
                { text: String(report.name || '').toUpperCase(), color: '#FFFFFF', bold: true, fontSize: 15, alignment: 'center' },
                { text: subtitle, color: DOC.subtitle, italics: true, fontSize: 9, alignment: 'center', margin: [0, 4, 0, 0] },
            ],
            fillColor: DOC.navy,
            border: [false, false, false, false],
            margin: [0, 12, 0, 12],
        }]],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 14],
});

/** Tiles per row, matching the template's four-across stat band. */
const TILES_PER_ROW = 4;

/**
 * The stat tiles, wrapped onto as many rows of four as the report needs.
 *
 * It used to render `stats.slice(0, 4)`, which silently dropped everything
 * past the fourth tile — and what got dropped was not filler: the Monthly
 * Performance report lost ACOS, Listings Audit lost four of its six content
 * checks, and Inventory Restock lost the total reorder value. The figures were
 * right; they simply never reached the page.
 *
 * The last row is padded with blank cells so a row of two does not stretch its
 * tiles to twice the width of the row above.
 */
const statTiles = (stats, currency) => {
    const all = stats || [];
    if (!all.length) return null;

    const cell = (stat) => {
        if (!stat) return { text: '', border: [false, false, false, false] };
        const hasDelta = stat.delta !== null && stat.delta !== undefined;
        const improved = stat.deltaGoodWhen === 'down' ? stat.delta < 0 : stat.delta > 0;
        const suffix = stat.deltaFormat === 'percent' ? '%' : stat.deltaFormat === 'points' ? ' pts' : '';
        const stack = [
            { text: String(stat.label || '').toUpperCase(), fontSize: 7, bold: true, color: DOC.tileLabel, alignment: 'center' },
            { text: formatCell(stat.value, stat.format, currency), fontSize: 15, bold: true, color: DOC.navy, alignment: 'center', margin: [0, 3, 0, 0] },
        ];
        if (hasDelta) {
            stack.push({
                text: stat.delta === 0 ? '\u2014' : `${stat.delta > 0 ? '\u25B2' : '\u25BC'} ${Math.abs(stat.delta)}${suffix}`,
                fontSize: 8,
                bold: true,
                color: stat.delta === 0 ? DOC.muted : improved ? DOC.green : DOC.red,
                alignment: 'center',
                margin: [0, 2, 0, 0],
            });
        }
        return { stack, fillColor: DOC.light, margin: [2, 8, 2, 8] };
    };

    const rows = [];
    for (let i = 0; i < all.length; i += TILES_PER_ROW) {
        const slice = all.slice(i, i + TILES_PER_ROW);
        while (slice.length < TILES_PER_ROW) slice.push(null);
        rows.push(slice.map(cell));
    }

    return rows.map((body, index) => ({
        table: { widths: new Array(TILES_PER_ROW).fill('*'), body: [body] },
        // Thin white gutters between tiles, as the template's 2px gap does.
        layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 2,
            vLineColor: () => '#FFFFFF',
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 0,
        },
        margin: [0, 0, 0, index === rows.length - 1 ? 16 : 2],
    }));
};

/** Teal rule + uppercase heading, the template's section marker. */
const sectionHeading = (text) => ({
    stack: [
        { text: String(text).toUpperCase(), color: DOC.teal, bold: true, fontSize: 10, characterSpacing: 0.3 },
        {
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: DOC.teal }],
            margin: [0, 4, 0, 0],
        },
    ],
    margin: [0, 0, 0, 8],
});

/**
 * The data table. Column one carries the template's blue "fill in" ink, being
 * the identifier a manager checks each cycle; the rest are centred like the
 * template's numeric cells.
 */
const dataTable = (summary, currency, override) => {
    const columns = override?.columns || summary?.columns || [];
    const rows = (override?.rows || summary?.rows || []).slice(0, MAX_PDF_ROWS);
    if (!columns.length || !rows.length) return null;

    const header = columns.map((column) => ({
        text: column.label,
        fillColor: DOC.navy,
        color: '#FFFFFF',
        bold: true,
        fontSize: 8,
        alignment: 'center',
        margin: [2, 5, 2, 5],
    }));

    const body = rows.map((row, index) => columns.map((column, cellIndex) => ({
        text: formatCell(row[column.key], column.format, currency),
        fontSize: 8,
        color: cellIndex === 0 ? DOC.blueInput : DOC.ink,
        alignment: cellIndex === 0 ? 'left' : 'center',
        fillColor: index % 2 === 1 ? DOC.zebra : null,
        margin: [2, 4, 2, 4],
    })));

    return {
        table: {
            headerRows: 1,
            // First column takes the slack; the rest size to their content.
            widths: columns.map((_, i) => (i === 0 ? '*' : 'auto')),
            body: [header, ...body],
            dontBreakRows: true,
        },
        layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => DOC.border,
            vLineColor: () => DOC.border,
        },
        margin: [0, 0, 0, 6],
    };
};

/** Teal bullets; red for a flagged line, blue italic for one still to be written. */
const highlightList = (highlights) => {
    if (!highlights?.length) return null;
    return {
        ul: highlights.map((item) => ({
            text: item.text,
            fontSize: 9,
            color: item.tone === 'watch' ? DOC.red : item.tone === 'fill' ? DOC.blueInput : DOC.ink,
            italics: item.tone === 'fill',
            margin: [0, 0, 0, 4],
        })),
        markerColor: DOC.teal,
        margin: [0, 0, 0, 12],
    };
};

/**
 * Build the pdfmake document definition for one report.
 *
 * @param {object} report        one entry from getEsfReports().reports
 * @param {object} opts
 * @param {object} opts.marketplace  { country, region }
 * @param {string} opts.currency     symbol for currency-formatted cells
 * @param {string} [opts.clientName] shown in the banner subtitle
 */
/**
 * "Showing the first N of M rows", when rows were left out.
 *
 * Two things can cut a table and neither used to announce itself on the second
 * one: MAX_PDF_ROWS here, and a builder's own slice — the suppressed-listings
 * table is cut to 25 before it ever reaches this file. A reader who cannot see
 * that rows are missing will read the table as the whole answer.
 *
 * @param {number} total  rows the builder found, before any slicing
 * @param {Array} shown   rows actually handed to the table
 */
const truncationNote = (total, shown) => {
    const rendered = Math.min((shown || []).length, MAX_PDF_ROWS);
    if (!total || total <= rendered) return null;
    return {
        text: `Showing the first ${rendered} of ${Number(total).toLocaleString('en-GB')} rows. The full set is on your Reports page.`,
        fontSize: 8,
        italics: true,
        color: DOC.muted,
        margin: [0, 0, 0, 12],
    };
};

const buildReportDocDefinition = (report, { marketplace, currency = '$', clientName = '' } = {}) => {
    const place = marketplace?.country ? `Amazon ${marketplace.country}` : 'All marketplaces';
    const subtitle = [clientName, place, report.date].filter(Boolean).join('  ·  ');

    const content = [banner(report, subtitle)];

    const tiles = statTiles(report.summary?.stats, currency);
    if (tiles) content.push(...tiles);

    content.push(sectionHeading(report.summary?.headline ? 'Summary' : 'Detail'));
    if (report.summary?.headline) {
        content.push({ text: report.summary.headline, fontSize: 9, color: DOC.ink, margin: [0, 0, 0, 8] });
    }

    const table = dataTable(report.summary, currency);
    if (table) {
        content.push(table);
        const note = truncationNote(report.summary?.totalRows, report.summary?.rows);
        if (note) content.push(note);
    } else if (report.summary?.emptyMessage) {
        content.push({ text: report.summary.emptyMessage, fontSize: 9, bold: true, color: DOC.green, margin: [0, 0, 0, 12] });
    }

    // Amazon's policy metrics, where the report carries them. Its own section,
    // because it answers a different question from the table above it.
    const secondary = report.summary?.secondaryTable;
    if (secondary?.rows?.length) {
        content.push(sectionHeading(secondary.title || 'Detail'));
        const secondaryTable = dataTable(null, currency, secondary);
        if (secondaryTable) {
            content.push(secondaryTable);
            const note = truncationNote(secondary.totalRows, secondary.rows);
            if (note) content.push(note);
        }
    }

    const bullets = highlightList(report.highlights);
    if (bullets) {
        content.push(sectionHeading('Performance Highlights'));
        content.push(bullets);
    }

    // The limits travel with the document, so whoever reads the PDF sees the
    // same caveats as whoever opened the page.
    if (report.caveats?.length) {
        for (const caveat of report.caveats) {
            content.push({ text: `Not included: ${caveat}`, fontSize: 7.5, italics: true, color: DOC.red, margin: [0, 0, 0, 4] });
        }
    }

    return {
        info: {
            title: `${report.name}${marketplace?.country ? ` - ${marketplace.country}` : ''}`,
            author: 'Estore Factory',
            subject: report.insight || report.name,
        },
        pageSize: 'A4',
        pageOrientation: widestTableColumnCount(report) > LANDSCAPE_COLUMN_THRESHOLD ? 'landscape' : 'portrait',
        pageMargins: [40, 36, 40, 44],
        defaultStyle: { font: 'Helvetica', fontSize: 9, color: DOC.ink },
        content,
        footer: (currentPage, pageCount) => ({
            columns: [
                {
                    text: 'Legend: Blue = fill in with this cycle’s figures  |  Green = on target  |  Yellow/red = needs attention',
                    fontSize: 6.5,
                    italics: true,
                    color: DOC.muted,
                    margin: [40, 0, 0, 0],
                },
                { text: `${currentPage} / ${pageCount}`, fontSize: 6.5, color: DOC.muted, alignment: 'right', margin: [0, 0, 40, 0] },
            ],
            margin: [0, 12, 0, 0],
        }),
    };
};

/**
 * Render one report to a PDF buffer, ready to attach to an email.
 *
 * @returns {Promise<Buffer>}
 */
const renderReportPdf = async (report, opts = {}) => {
    ensureConfigured();
    const pdf = pdfmake.createPdf(buildReportDocDefinition(report, opts));
    return pdf.getBuffer();
};

/** "Weekly Buybox Report - US.pdf", safe for a mail client and a filesystem. */
const reportPdfFilename = (report, marketplace) => {
    const parts = [report.name, marketplace?.country].filter(Boolean).join(' - ');
    return `${parts.replace(/[^\w\s.-]/g, '').trim()}.pdf`;
};

module.exports = {
    renderReportPdf,
    buildReportDocDefinition,
    reportPdfFilename,
    MAX_PDF_ROWS,
    LANDSCAPE_COLUMN_THRESHOLD,
    widestTableColumnCount,
};

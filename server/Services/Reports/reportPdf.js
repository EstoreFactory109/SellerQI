/**
 * Report PDF renderer.
 *
 * Turns one report from EsfReportsService into the PDF a client is emailed, in
 * the layout of the Monthly Performance Report the team designed by hand
 * (reportBrand.js has the palette and the reasons):
 *
 *   every page    logo and report title header over a red rule; a navy/red
 *                 footer band carrying "eStore Factory · Page x of y"
 *   Executive     red-barred section title and subtitle, grey stat tiles with
 *   Summary       a "vs <period>" change line, a Key Takeaway box, and charts
 *                 where the report has them
 *   Detail        the report's table under its own section title, then any
 *                 second table
 *   Close         Performance Highlights (blue bar), Actions Taken (red bar)
 *                 with the account manager's placeholders, notes, issue date
 *
 * WHY THIS REDRAWS THE LAYOUT RATHER THAN PRINTING THE HTML
 * The on-screen preview is React, and printing it would need a headless browser
 * on the EC2 box — Chromium plus ~20 apt packages that the deploy workflow
 * (npm ci + pm2 restart) does not install, so it would fail silently in
 * production. pdfmake is pure JS and needs nothing.
 *
 * The cost is that the LAYOUT exists twice: here and in
 * client/src/Components/ESF/ReportDocumentPreview.jsx. The DATA does not — both
 * render the same `report` payload, and the charts arrive in it already drawn
 * as SVG — so the numbers can never disagree, only the styling can.
 *
 * Fonts: Poppins, shipped in server/assets/fonts (SIL Open Font License), which
 * also draws ₹, zł and ₺. The change arrows are drawn triangles, since Poppins
 * has no triangle glyphs.
 */
const pdfmake = require('pdfmake');
const {
    BRAND, COMPANY, FONT_DIR, FONT_FILES, BRAND_DIR, LOGO_FILE, CHART_W, printableCurrency,
} = require('./reportBrand.js');

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
 * reportPdfTableWidth.test.js pins both numbers.
 */
const LANDSCAPE_COLUMN_THRESHOLD = 9;

/** The widest table in a report — the primary one or its secondary. */
const widestTableColumnCount = (report) => Math.max(
    report?.summary?.columns?.length || 0,
    report?.summary?.secondaryTable?.columns?.length || 0
);

const MARGIN_X = 40;

/**
 * The 14 fonts every PDF reader has built in, plus the shipped Poppins files.
 * pdfmake resolves both through the same local-access hook, so both have to be
 * named in the allow-list below or font loading is denied.
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
 * The access policies are an allow-list: the built-in font names and the files
 * in the shipped font and brand folders, nothing else. These documents reference no URLs
 * and no images outside themselves; report content is client data, and a
 * document generator that will fetch what its input tells it to is an SSRF
 * waiting to happen.
 */
const ensureConfigured = () => {
    if (fontsRegistered) return;
    pdfmake.addFonts({
        Poppins: { ...FONT_FILES },
    });
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((name) => STANDARD_PDF_FONTS.has(name)
        || String(name).startsWith(FONT_DIR)
        || String(name).startsWith(BRAND_DIR));
    fontsRegistered = true;
};

/** Mirrors formatCell in ReportDocumentPreview.jsx. */
const formatCell = (value, format, currency) => {
    if (value === null || value === undefined || value === '') return '-';
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

/** Numbers sit right, as in the reference table; words sit left. */
const isNumericColumn = (column, rows) => ['number', 'currency', 'money', 'percent'].includes(column.format)
    || (rows.length > 0 && rows.every((row) => typeof row[column.key] === 'number' || row[column.key] === null
        || row[column.key] === undefined || row[column.key] === '' || /^[-+—]|^[\d.,]+(%| pts|x)?$/.test(String(row[column.key]))));

/**
 * Column widths: long text (a product name, a reason) shares the spare width;
 * everything else sizes to its content. Sharing it equally instead gave
 * "Video" as much room as the product name, and pushed the Listings Audit's
 * last two columns off the page.
 */
const LONG_TEXT = 24;
const columnWidths = (columns, rows) => {
    const longest = columns.map((column) => Math.max(
        String(column.label).length,
        ...rows.map((row) => String(row[column.key] ?? '').length)
    ));
    const stars = columns.map((column, i) => !isNumericColumn(column, rows) && longest[i] > LONG_TEXT);
    // Always one column to take up the slack, so the table spans the page.
    if (!stars.some(Boolean)) stars[longest.indexOf(Math.max(...longest))] = true;
    return stars.map((star) => (star ? '*' : 'auto'));
};

/**
 * ▲ / ▼ as a drawn triangle. Poppins has no triangle glyphs, and a ZapfDingbats
 * glyph inline measured zero width in pdfmake, so the figure after it was drawn
 * straight over the arrow ("▼ vs last week" where it should read "▼ 4").
 */
const deltaArrow = (up, color) => ({
    width: 6,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="6" viewBox="0 0 6 6"><path d="${up ? 'M3 0.5 L5.8 5.5 L0.2 5.5 Z' : 'M0.2 0.5 L5.8 0.5 L3 5.5 Z'}" fill="${color}"/></svg>`,
    margin: [0, 1.6, 0, 0],
});

/* ------------------------------------------------------------ page chrome */

const header = (report, subtitle) => (currentPage, pageCount, pageSize) => ({
    margin: [MARGIN_X, 22, MARGIN_X, 0],
    stack: [
        {
            columns: [
                // The brand logo, on every page with the report's title and scope.
                { image: LOGO_FILE, width: 132 },
                {
                    width: '*',
                    stack: [
                        { text: String(report.name || '').toUpperCase(), bold: true, fontSize: 10.5, color: BRAND.blue, alignment: 'right', characterSpacing: 0.4 },
                        { text: subtitle, fontSize: 7.5, color: BRAND.muted, alignment: 'right', margin: [0, 2, 0, 0] },
                    ],
                },
            ],
        },
        {
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: pageSize.width - MARGIN_X * 2, y2: 0, lineWidth: 1.4, lineColor: BRAND.red }],
            margin: [0, 7, 0, 0],
        },
    ],
});

/** The reference footer: navy end blocks either side of a red band. */
const footer = (currentPage, pageCount) => ({
    margin: [MARGIN_X, 10, MARGIN_X, 0],
    table: {
        widths: [70, '*', 70],
        body: [[
            { text: '', fillColor: BRAND.navy, border: [false, false, false, false] },
            {
                text: [
                    { text: `${COMPANY}  ·  Page ` },
                    { text: String(currentPage), fontSize: 9 },
                    { text: ' of ' },
                    { text: String(pageCount), fontSize: 9 },
                ],
                color: BRAND.white,
                fontSize: 7.5,
                alignment: 'center',
                fillColor: BRAND.red,
                border: [false, false, false, false],
                margin: [0, 4, 0, 3],
            },
            { text: '', fillColor: BRAND.navy, border: [false, false, false, false] },
        ]],
    },
    layout: 'noBorders',
});

/* --------------------------------------------------------------- sections */

/** Coloured bar, blue capitals, grey italic subtitle — the reference section marker. */
const sectionTitle = (title, subtitle, { color = BRAND.red, pageBreak } = {}) => ({
    ...(pageBreak ? { pageBreak } : {}),
    margin: [0, 6, 0, subtitle ? 8 : 6],
    stack: [
        {
            columns: [
                { width: 6, canvas: [{ type: 'rect', x: 0, y: 0, w: 3.2, h: 15, color }] },
                { width: '*', text: String(title).toUpperCase(), bold: true, fontSize: 12.5, color: BRAND.blue, margin: [4, 0, 0, 0] },
            ],
        },
        ...(subtitle ? [{ text: subtitle, italics: true, fontSize: 8, color: BRAND.muted, margin: [10, 2, 0, 0] }] : []),
    ],
});

/** Tiles per row, as the reference's first row. */
const TILES_PER_ROW = 4;
const TILE_GAP = 7;

/**
 * The stat tiles: grey, thin-bordered, left-aligned, four to a row. A short last
 * row stretches to the full width, as the reference's second row of three does.
 *
 * Every tile a report carries is drawn. It used to render `stats.slice(0, 4)`,
 * which silently dropped ACOS from Monthly Performance and four of six content
 * checks from Listings Audit.
 */
const statTiles = (stats, currency, comparisonLabel) => {
    const all = stats || [];
    if (!all.length) return [];

    const cell = (stat) => {
        const hasDelta = stat.delta !== null && stat.delta !== undefined;
        const improved = stat.deltaGoodWhen === 'down' ? stat.delta < 0 : stat.delta > 0;
        const suffix = stat.deltaFormat === 'percent' ? '%' : stat.deltaFormat === 'points' ? ' pts' : '';
        const stack = [
            { text: String(stat.label || '').toUpperCase(), fontSize: 6.5, bold: true, color: BRAND.muted, characterSpacing: 0.2 },
            { text: formatCell(stat.value, stat.format, currency), fontSize: 17, bold: true, color: BRAND.blue, margin: [0, 3, 0, 0] },
        ];
        if (hasDelta) {
            const color = stat.delta === 0 ? BRAND.muted : improved ? BRAND.teal : BRAND.red;
            const line = { fontSize: 7, bold: true, color };
            stack.push(stat.delta === 0
                ? { ...line, text: `No change${comparisonLabel ? ` ${comparisonLabel}` : ''}`, margin: [0, 2, 0, 0] }
                : {
                    columns: [
                        deltaArrow(stat.delta > 0, color),
                        { ...line, width: '*', text: `${Math.abs(stat.delta)}${suffix}${comparisonLabel ? `  ${comparisonLabel}` : ''}` },
                    ],
                    columnGap: 3,
                    margin: [0, 2, 0, 0],
                });
        }
        return { stack, fillColor: BRAND.tile, margin: [8, 7, 6, 7] };
    };
    const rows = [];
    for (let i = 0; i < all.length; i += TILES_PER_ROW) rows.push(all.slice(i, i + TILES_PER_ROW));

    // One bordered box per tile, laid out as columns so the gaps between them
    // are white space rather than table cells (which drew dark rules).
    const tileLayout = {
        hLineWidth: () => 0.75,
        vLineWidth: () => 0.75,
        hLineColor: () => BRAND.tileBorder,
        vLineColor: () => BRAND.tileBorder,
        paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
    };
    const hasDelta = (stat) => stat.delta !== null && stat.delta !== undefined;
    return rows.map((slice, index) => ({
        columns: slice.map((stat) => {
            const tile = cell(stat);
            // Each tile is its own box, so a row mixing tiles with and without
            // a change line would be ragged; a blank line evens them out.
            if (!hasDelta(stat) && slice.some(hasDelta)) tile.stack.push({ text: ' ', fontSize: 7, margin: [0, 2, 0, 0] });
            return { width: '*', table: { widths: ['*'], body: [[tile]] }, layout: tileLayout };
        }),
        columnGap: TILE_GAP,
        // A row of tiles is never split across a page break.
        unbreakable: true,
        margin: [0, 0, 0, index === rows.length - 1 ? 12 : TILE_GAP],
    }));
};

/** The pale blue Key Takeaway box with its blue left edge. */
const takeawayBox = (text) => (text ? {
    table: {
        widths: ['*'],
        body: [[{
            stack: [
                { text: 'KEY TAKEAWAY', bold: true, fontSize: 7, color: BRAND.blue, characterSpacing: 0.3 },
                { text, fontSize: 8.5, color: BRAND.ink, margin: [0, 3, 0, 0], lineHeight: 1.25 },
            ],
            fillColor: BRAND.takeaway,
            margin: [10, 7, 10, 8],
        }]],
    },
    layout: {
        hLineWidth: () => 0,
        vLineWidth: (i) => (i === 0 ? 3 : 0),
        vLineColor: () => BRAND.blue,
        paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
    },
    margin: [0, 0, 0, 14],
} : null);

/** Charts side by side, each under its own small blue title. */
const chartRow = (charts, contentWidth) => {
    if (!charts?.length) return null;
    const width = Math.min((contentWidth - 20) / 2, CHART_W);
    return {
        columns: charts.slice(0, 2).map((chart) => ({
            width: (contentWidth - 20) / 2,
            stack: [
                { text: chart.title, bold: true, fontSize: 9, color: BRAND.blue, margin: [0, 0, 0, 4] },
                { svg: chart.svg, width },
            ],
        })),
        columnGap: 20,
        margin: [0, 0, 0, 10],
    };
};

/**
 * A data table in the reference style: blue header, white capitals, the key
 * column in bold blue, numbers right-aligned, pale zebra rows, fine grid.
 */
const dataTable = (columns, allRows, currency) => {
    const rows = (allRows || []).slice(0, MAX_PDF_ROWS);
    if (!columns?.length || !rows.length) return null;
    const numeric = columns.map((column) => isNumericColumn(column, rows));
    // Past ten columns the type steps down a size so the table fits the page.
    const compact = columns.length > 10;
    const bodySize = compact ? 6.5 : 7.5;
    const pad = compact ? [2.5, 3.5, 2.5, 3.5] : [4, 4, 4, 4];

    const head = columns.map((column, i) => ({
        text: String(column.label).toUpperCase(),
        fillColor: BRAND.blue,
        color: BRAND.white,
        bold: true,
        fontSize: compact ? 5.8 : 6.5,
        alignment: i === 0 ? 'left' : (column.align || (numeric[i] ? 'right' : 'left')),
        margin: [pad[0], 5, pad[2], 5],
    }));

    // A row may carry its own format (`__format`) for its value columns — the
    // Monthly table mixes money, counts and rates down one column.
    const body = rows.map((row, index) => columns.map((column, i) => ({
        text: formatCell(row[column.key], (i > 0 && row.__format) || column.format, currency),
        fontSize: bodySize,
        bold: i === 0,
        color: i === 0 ? BRAND.blue : BRAND.ink,
        alignment: i === 0 ? 'left' : (column.align || (numeric[i] ? 'right' : 'left')),
        fillColor: index % 2 === 1 ? BRAND.zebra : null,
        margin: pad,
    })));

    return {
        table: {
            headerRows: 1,
            // A comparison table (every value column aligned by its builder)
            // shares the page evenly, as the reference's does; any other table
            // sizes by content.
            widths: columns.slice(1).every((column) => column.align)
                ? columns.map(() => '*')
                : columnWidths(columns, rows),
            body: [head, ...body],
            dontBreakRows: true,
        },
        layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => BRAND.grid,
            vLineColor: () => BRAND.grid,
            // Cell margins carry the padding; the layout's own default of 4pt
            // a side doubled it and pushed wide tables off the page.
            paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
        },
        margin: [0, 0, 0, 6],
    };
};

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
        fontSize: 7,
        italics: true,
        color: BRAND.muted,
        margin: [0, 0, 0, 12],
    };
};

/** Plain dark bullets, as the reference; a flagged line gets a red bullet. */
const bulletList = (items, { italic = false, color = BRAND.ink, compact = 0 } = {}) => ({
    stack: items.map((item) => ({
        columns: [
            { width: 9, text: '•', color: item.tone === 'watch' ? BRAND.red : BRAND.ink, fontSize: 9 },
            { width: '*', text: item.text, fontSize: compact ? 8 : 8.5, color, italics: italic, lineHeight: compact ? 1.1 : 1.2 },
        ],
        margin: [2, 0, 0, compact ? 2.5 : 4],
    })),
    margin: [0, 0, 0, compact ? 8 : 12],
});

/** "28 September 2026" */
const issueDate = (date = new Date()) => date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

/* -------------------------------------------------------------- document */

/**
 * Build the pdfmake document definition for one report.
 *
 * @param {object} report        one entry from getEsfReports().reports
 * @param {object} opts
 * @param {object} opts.marketplace  { country, region }
 * @param {string} [opts.currency]   override; defaults to the marketplace's own
 * @param {string} [opts.clientName] shown in the page header
 * @param {Date}   [opts.issuedAt]   the date printed at the end
 */
/** A smaller blue heading, for a table inside a marketplace's section. */
const subTitle = (text) => ({ text: String(text).toUpperCase(), bold: true, fontSize: 9, color: BRAND.blue, characterSpacing: 0.3, margin: [0, 4, 0, 5] });

/**
 * One report body — main table, second table — as blocks. Used as-is for a
 * single-marketplace report, and once per marketplace section in an
 * account-wide one.
 */
const detailBlocks = (summary, tableTitle, currency, { heading = 'section', pageBreak } = {}) => {
    const blocks = [];
    if (heading === 'section') blocks.push(sectionTitle(tableTitle || 'Detail', summary.headline, { pageBreak }));
    else blocks.push(subTitle(tableTitle || 'Detail'));

    const table = dataTable(summary.columns, summary.rows, currency);
    if (table) {
        blocks.push(table);
        const note = truncationNote(summary.totalRows, summary.rows);
        blocks.push(note || { text: '', margin: [0, 0, 0, 6] });
    } else if (summary.emptyMessage) {
        blocks.push({ text: summary.emptyMessage, fontSize: 8.5, bold: true, color: BRAND.teal, margin: [0, 0, 0, 12] });
    }

    const secondary = summary.secondaryTable;
    if (secondary?.rows?.length) {
        blocks.push(heading === 'section' ? sectionTitle(secondary.title || 'Detail') : subTitle(secondary.title || 'Detail'));
        const secondaryTable = dataTable(secondary.columns, secondary.rows, currency);
        if (secondaryTable) {
            blocks.push(secondaryTable);
            const note = truncationNote(secondary.totalRows, secondary.rows);
            if (note) blocks.push(note);
        }
    }
    return blocks;
};

/**
 * Highlights, Notes and the issue date — the same for every layout.
 *
 * NO "ACTIONS TAKEN" SECTION. The builders carry a placeholder bullet for the
 * account manager ("[Purchase orders raised this cycle]"), from the original
 * template. Nothing in the system lets anyone fill it in, so it went out to
 * clients as a raw bracketed placeholder on every report. It stays in the data
 * for when a manager-comment feature exists, and is not printed until then.
 *
 * `compact` pulls the closing together when it would otherwise leave one or
 * two notes alone on a last page (see renderReportPdf):
 *   1  tighter spacing, and the issue date on the Notes heading line
 *   2  as 1, with the notes set in two columns
 */
const closingBlocks = (report, issuedAt, compact = 0) => {
    const blocks = [];
    const written = (report.highlights || []).filter((item) => item.tone !== 'fill');
    if (written.length) {
        blocks.push(sectionTitle('Performance Highlights', null, { color: BRAND.blue }));
        blocks.push(bulletList(written, { compact }));
    }

    const date = issueDate(issuedAt);
    // The limits travel with the document, so whoever reads the PDF sees the
    // same caveats as whoever opened the page. One node, with an id, so the
    // renderer can see which pages it landed on.
    if (report.caveats?.length) {
        const note = (caveat) => ({ text: caveat, fontSize: compact ? 6 : 6.5, color: BRAND.muted, margin: [0, 0, 0, compact ? 1.5 : 2.5], lineHeight: compact ? 1.08 : 1.15 });
        const label = { text: 'NOTES', bold: true, fontSize: 6.5, color: BRAND.muted, characterSpacing: 0.3 };
        const heading = compact
            ? { columns: [label, { text: date, fontSize: 7, color: BRAND.muted, alignment: 'right' }], margin: [0, 2, 0, 2] }
            : { ...label, margin: [0, 4, 0, 3] };
        let body;
        if (compact >= 2 && report.caveats.length > 1) {
            const half = Math.ceil(report.caveats.length / 2);
            body = [{
                columns: [
                    { width: '*', stack: report.caveats.slice(0, half).map(note) },
                    { width: '*', stack: report.caveats.slice(half).map(note) },
                ],
                columnGap: 14,
            }];
        } else {
            body = report.caveats.map(note);
        }
        blocks.push({ id: 'close-notes', stack: [heading, ...body] });
        if (compact) return blocks;
    }
    // Compact with no notes to carry it: the date moves up into the page
    // header (see buildReportDocDefinition) rather than sit alone on a page.
    if (compact && !report.caveats?.length) return blocks;
    blocks.push({ id: 'close-date', text: date, fontSize: 7.5, color: BRAND.muted, margin: [0, 12, 0, 0] });
    return blocks;
};

/** Every table in a report, for the page-orientation decision. */
const allTables = (report) => [
    report.summary,
    report.summary?.secondaryTable,
    report.comparison,
    ...(report.sections || []).flatMap((section) => [section.summary, section.summary?.secondaryTable]),
].filter(Boolean);

/**
 * Build the pdfmake document definition for one report.
 *
 * Two layouts from one set of parts:
 *   single marketplace   Executive Summary, the report's tables, close
 *   account-wide         Executive Summary led by the primary marketplace,
 *   (report.multi)       All Marketplaces comparison, a section per
 *                        marketplace in its own currency, close
 *
 * @param {object} report        one entry from getEsfAccountReports().reports
 * @param {object} opts
 * @param {object} opts.marketplace  { country, region } the report is led by
 * @param {string} [opts.currency]   override; defaults to the marketplace's own
 * @param {string} [opts.clientName] shown in the page header
 * @param {Date}   [opts.issuedAt]   the date printed at the end
 * @param {number} [opts.compact]    closing density, 0-2 (see closingBlocks);
 *                                   3 keeps the whole closing on one page
 */
const buildReportDocDefinition = (report, { marketplace, currency: requestedCurrency, clientName = '', issuedAt, compact = 0 } = {}) => {
    const lead = report.marketplace || marketplace;
    const currency = printableCurrency(lead?.country, requestedCurrency);
    const multi = Boolean(report.multi && report.available && report.sections?.length > 1);
    const countries = multi ? report.sections.map((section) => section.marketplace.country) : [];
    const place = multi
        ? `Amazon ${countries.join(' & ')}`
        : (lead?.country ? `Amazon ${lead.country}` : 'All marketplaces');
    const summary = report.summary || {};
    const landscape = widestTableColumnCount(report) > LANDSCAPE_COLUMN_THRESHOLD
        || allTables(report).some((table) => (table.columns?.length || 0) > LANDSCAPE_COLUMN_THRESHOLD);
    const contentWidth = (landscape ? 842 : 595) - MARGIN_X * 2;

    const content = [];

    if (!multi) {
        // ---- Executive summary --------------------------------------------
        content.push(sectionTitle('Executive Summary', [place, report.date].filter(Boolean).join('  ·  ')));
        content.push(...statTiles(summary.stats, currency, summary.comparisonLabel));
        const takeaway = takeawayBox(summary.takeaway);
        if (takeaway) content.push(takeaway);
        const charts = chartRow(summary.charts, contentWidth);
        if (charts) content.push(charts);
        // A report with charts fills its first page, as the reference does, so
        // its table starts the second.
        content.push(...detailBlocks(summary, report.tableTitle, currency, { pageBreak: charts ? 'before' : undefined }));
    } else {
        const overview = report.overview || {};
        const leadLabel = `Amazon ${lead.country} (${report.isPrimary ? 'primary marketplace' : 'leading marketplace'})`;

        // ---- Executive summary, led by the primary marketplace -------------
        content.push(sectionTitle('Executive Summary', [leadLabel, report.date].filter(Boolean).join('  ·  ')));
        content.push(...statTiles(overview.stats, currency, overview.comparisonLabel));
        const takeaway = takeawayBox(overview.takeaway);
        if (takeaway) content.push(takeaway);
        const charts = chartRow(overview.charts, contentWidth);
        if (charts) content.push(charts);

        // ---- All Marketplaces: the reference report's page two ------------
        content.push(sectionTitle('All Marketplaces', `${report.date} snapshot  ·  ${countries.length} marketplaces, each in its own currency`, {
            pageBreak: charts ? 'before' : undefined,
        }));
        const comparison = dataTable(report.comparison.columns, report.comparison.rows, currency);
        if (comparison) content.push({ ...comparison, margin: [0, 0, 0, 12] });

        // ---- One section per marketplace, primary first -------------------
        for (const section of report.sections) {
            const sectionCurrency = printableCurrency(section.marketplace.country);
            // The headline already names the period on some reports (Monthly's
            // does), so the date is added only when it does not.
            const headline = section.summary?.headline || '';
            const subtitle = headline.includes(section.date) ? headline : [section.date, headline].filter(Boolean).join('  ·  ');
            content.push(sectionTitle(`Amazon ${section.marketplace.country}`, section.available ? subtitle : section.reason));
            if (!section.available) continue;
            content.push(...statTiles(section.summary.stats, sectionCurrency, section.summary.comparisonLabel));
            content.push(...detailBlocks(section.summary, section.tableTitle, sectionCurrency, { heading: 'sub' }));
        }
    }

    // Level 3: the closing could not be pulled back, so it is kept in one
    // piece instead — the last page then carries the highlights with their
    // notes, never one or two notes on their own.
    if (compact >= 3) content.push({ stack: closingBlocks(report, issuedAt, 2), unbreakable: true });
    else content.push(...closingBlocks(report, issuedAt, compact));

    return {
        info: {
            title: `${report.name} - ${multi ? countries.join(', ') : (lead?.country || '')}`.replace(/ - $/, ''),
            author: COMPANY,
            subject: report.insight || report.name,
        },
        pageSize: 'A4',
        pageOrientation: landscape ? 'landscape' : 'portrait',
        pageMargins: [MARGIN_X, 74, MARGIN_X, 46],
        defaultStyle: { font: 'Poppins', fontSize: 8.5, color: BRAND.ink },
        // The issue date joins the header only when the closing had nowhere
        // else to put it (compact, no notes).
        header: header(report, [clientName, place, compact && !report.caveats?.length ? issueDate(issuedAt) : null].filter(Boolean).join('  ·  ')),
        footer,
        content,
    };
};

/**
 * Render one report to a PDF buffer, ready to attach to an email.
 *
 * @returns {Promise<Buffer>}
 */
/**
 * Lay a document out and report whether its closing was orphaned: the Notes
 * split so their last lines sit alone on a final page, or the Notes (or the
 * issue date) starting a final page with nothing above them.
 *
 * pdfmake's pageBreakBefore hook sees every node with the pages it landed on;
 * it is used here only to look, never to insert a break.
 */
const layOut = async (definition) => {
    const seen = { orphaned: false, pages: 0 };
    const probe = (node, nodes) => {
        seen.pages = node.pages;
        if (node.id !== 'close-notes' && node.id !== 'close-date') return false;
        const [first] = node.pageNumbers;
        const last = node.pageNumbers[node.pageNumbers.length - 1];
        const endsDocument = last === node.pages;
        const split = node.pageNumbers.length > 1 && endsDocument;
        // Only nodes that draw something count: pdfmake also reports empty
        // container stacks whose margins spill onto the next page.
        const drawn = nodes.getPreviousNodesOnPage().filter((n) => n.text || n.table || n.image || n.svg || n.canvas);
        const alone = first === node.pages && drawn.length === 0;
        if (split || alone) seen.orphaned = true;
        return false;
    };
    const buffer = await pdfmake.createPdf({ ...definition, pageBreakBefore: probe }).getBuffer();
    return { buffer, ...seen };
};

/**
 * Render one report to a PDF buffer, ready to attach to an email.
 *
 * A last page holding one or two stray notes read as a mistake, so when the
 * closing would be orphaned the document is laid out again with a tighter
 * closing (closingBlocks' compact levels), keeping the first layout that
 * pulls it back. When the page above is simply full, the last resort keeps the
 * closing in one piece so it moves over whole. Most reports need one pass.
 *
 * @returns {Promise<Buffer>}
 */
const renderReportPdfDetailed = async (report, opts = {}) => {
    ensureConfigured();
    let best = null;
    for (const compact of [0, 1, 2, 3]) {
        const attempt = { ...(await layOut(buildReportDocDefinition(report, { ...opts, compact }))), compact };
        if (!attempt.orphaned) return attempt;
        // Nothing pulled it back: keep the layout with the fewest pages.
        if (!best || attempt.pages < best.pages) best = attempt;
    }
    return best;
};

const renderReportPdf = async (report, opts = {}) => (await renderReportPdfDetailed(report, opts)).buffer;

/** "Weekly Buybox Report - US.pdf", safe for a mail client and a filesystem. */
const reportPdfFilename = (report, marketplace) => {
    const parts = [report.name, marketplace?.country].filter(Boolean).join(' - ');
    return `${parts.replace(/[^\w\s.-]/g, '').trim()}.pdf`;
};

module.exports = {
    renderReportPdf,
    // exported for tests: which compact level was used, and whether it held
    renderReportPdfDetailed,
    buildReportDocDefinition,
    reportPdfFilename,
    MAX_PDF_ROWS,
    LANDSCAPE_COLUMN_THRESHOLD,
    widestTableColumnCount,
};

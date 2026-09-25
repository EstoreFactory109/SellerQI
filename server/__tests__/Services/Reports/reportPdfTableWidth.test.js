/**
 * Does the widest report table actually fit on the page?
 *
 * WHY THIS IS A TEST AND NOT AN ASSUMPTION
 * pdfmake does not shrink text to fit and does not warn when a table is too
 * wide — it draws the overflow past the right margin, off the paper. Nothing in
 * the existing checks would catch that: verifyEsfPdfContent.js renders every
 * report and asserts the CONTENT is present, which it still is, just invisible
 * on a printed page.
 *
 * Wrapping does not rescue a wide table either. A column's minimum width is its
 * widest unbreakable word, and this report's two widest columns hold exactly
 * that kind of value — an Amazon merchant token (A1B2C3D4E5F6G) and a seller's
 * own SKU, neither of which has a space in it to break at.
 *
 * The Buy Box report went from eight columns to twelve when competitor pricing
 * was added, which is what prompted this. The measurement below uses the same
 * font metrics pdfmake does, so it is the real width, not an estimate.
 */
const {
    renderReportPdf,
    buildReportDocDefinition,
    MAX_PDF_ROWS,
    LANDSCAPE_COLUMN_THRESHOLD,
} = require('../../../Services/Reports/reportPdf.js');

/** A4, minus the 40pt side margins the document definition sets. */
const PORTRAIT_WIDTH = 595.28 - 40 - 40;
const LANDSCAPE_WIDTH = 841.89 - 40 - 40;

/**
 * Width of a string in Helvetica at a given size, from the same AFM metrics
 * pdfmake resolves for the built-in fonts.
 */
const { widthOfString } = (() => {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ autoFirstPage: false });
    return {
        widthOfString: (text, size, bold) => {
            doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
            return doc.widthOfString(String(text));
        },
    };
})();

/**
 * The narrowest this table can be drawn: for each column, the widest single
 * unbreakable word in its header or its cells, plus the cell padding. This is
 * pdfmake's own floor — below it, the table overflows rather than wrapping.
 */
const minimumTableWidth = (columns, rows, fontSize, padX) =>
    columns.reduce((total, column) => {
        const words = [
            ...String(column.label).split(/\s+/),
            ...rows.map((row) => String(row[column.key] ?? '')).flatMap((value) => value.split(/\s+/)),
        ].filter(Boolean);

        const widest = words.reduce(
            (max, word) => Math.max(max, widthOfString(word, fontSize, false)),
            widthOfString(column.label, fontSize, true)
        );
        return total + widest + padX * 2;
    }, 0);

describe('report table width', () => {
    /**
     * The Buy Box report at its worst: every pricing column populated, a long
     * unbreakable SKU, and a merchant token in the seller column.
     */
    const columns = [
        { key: 'sku', label: 'SKU' },
        { key: 'asin', label: 'ASIN' },
        { key: 'ourPrice', label: 'Our price' },
        { key: 'competingPrice', label: 'Buy Box price' },
        { key: 'priceGap', label: 'Gap' },
        { key: 'pricingFlag', label: 'Pricing' },
        { key: 'competingSeller', label: 'Buy Box seller' },
        { key: 'status', label: 'Status' },
        { key: 'ownership', label: 'Buy Box %' },
        { key: 'periodsLosing', label: 'Snapshots losing' },
        { key: 'sessions', label: 'Sessions' },
        { key: 'unitsOrdered', label: 'Units' },
    ];

    const rows = [{
        // A real-world SKU with no spaces in it — the hard case.
        sku: 'MORGANS-REPELLENT-16OZ-3PACK-2026',
        asin: 'B0CZ8HJ4KQ',
        ourPrice: '$1,299.99',
        competingPrice: '$1,199.99',
        priceGap: '$100.00',
        pricingFlag: 'No Buy Box holder',
        competingSeller: 'A1B2C3D4E5F6G7',
        status: 'Losing',
        ownership: '0.0%',
        periodsLosing: '8',
        sessions: '12,345',
        unitsOrdered: '1,234',
    }];

    /** The size dataTable() draws every table at. */
    const WIDTH = minimumTableWidth(columns, rows, 8, 2);

    it('does not fit A4 portrait — the fact the whole rule exists for', () => {
        // Not a hypothetical. Before the landscape rule this table was drawn
        // past the right margin, off the paper, with the content still present
        // in the file and simply unreadable on the page.
        expect(WIDTH).toBeGreaterThan(PORTRAIT_WIDTH);
    });

    it('is not rescued by shrinking the type either', () => {
        // The first attempt at this fix. 7pt is already small, and it is still
        // over the portrait limit — which is why the page turns instead.
        expect(minimumTableWidth(columns, rows, 7, 1)).toBeGreaterThan(PORTRAIT_WIDTH);
    });

    it('fits landscape, with room for a longer SKU than this one', () => {
        expect(WIDTH).toBeLessThan(LANDSCAPE_WIDTH);
        // Slack, not a hairline pass: a SKU 60 characters longer still fits.
        expect(LANDSCAPE_WIDTH - WIDTH).toBeGreaterThan(80);
    });

    it('turns the page for this report and leaves narrower ones alone', () => {
        const withColumns = (count) => buildReportDocDefinition({
            key: 'x', name: 'X', available: true,
            summary: {
                columns: Array.from({ length: count }, (_, i) => ({ key: `k${i}`, label: `L${i}` })),
                rows: [{ k0: 'a' }],
            },
        }, {});

        expect(withColumns(columns.length).pageOrientation).toBe('landscape');
        // Every report that fitted before is laid out exactly as it was.
        expect(withColumns(LANDSCAPE_COLUMN_THRESHOLD).pageOrientation).toBe('portrait');
        expect(withColumns(8).pageOrientation).toBe('portrait');
    });

    it('turns the page for a wide SECONDARY table too', () => {
        // The Buy Box report's suppressed-listings table is a second table on
        // the same page; a narrow primary must not leave it overflowing.
        const doc = buildReportDocDefinition({
            key: 'x', name: 'X', available: true,
            summary: {
                columns: [{ key: 'a', label: 'A' }],
                rows: [{ a: '1' }],
                secondaryTable: {
                    title: 'Wide',
                    columns: Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, label: `L${i}` })),
                    rows: [{ k0: 'a' }],
                },
            },
        }, {});

        expect(doc.pageOrientation).toBe('landscape');
    });

    it('still renders the report end to end at that width', async () => {
        const report = {
            key: 'buybox',
            name: 'Weekly Buybox Report',
            cadence: 'WEEKLY',
            available: true,
            date: '20 Sep 2026',
            summary: { headline: '1 of 2 ASINs hold the Buy Box', stats: [], columns, rows },
            highlights: [],
            caveats: [],
        };

        const buffer = await renderReportPdf(report, { marketplace: { country: 'US' } });
        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer.length).toBeGreaterThan(1000);
    }, 20000);

    it('caps rows so a large catalogue cannot grow the document without bound', () => {
        expect(MAX_PDF_ROWS).toBe(40);
    });
});

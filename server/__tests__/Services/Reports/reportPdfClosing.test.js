/**
 * The end of a report: no stray last page, and no unfilled placeholder.
 *
 *  - One or two notes (or the issue date) alone on a final page read as a
 *    mistake. renderReportPdf re-lays the closing tighter until they pull back.
 *  - The builders' "[... this cycle]" bullet is the account manager's to fill,
 *    and nothing lets anyone fill it — so it must never reach a client.
 */
const { renderReportPdfDetailed, buildReportDocDefinition } = require('../../../Services/Reports/reportPdf.js');

const textOf = (node, out = []) => {
    if (node === null || node === undefined) return out;
    if (Array.isArray(node)) { node.forEach((child) => textOf(child, out)); return out; }
    if (typeof node === 'object') {
        if (typeof node.text === 'string') out.push(node.text);
        Object.values(node).forEach((value) => textOf(value, out));
    }
    return out;
};

const report = (rows, caveats) => ({
    key: 'inventory-restock',
    name: 'Inventory Restock',
    cadence: 'BI-WEEKLY',
    available: true,
    date: '29 Sept 2026',
    summary: {
        headline: 'SKUs tracked',
        stats: [{ label: 'SKUs', value: rows }],
        columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'qty', label: 'Qty', format: 'number' }],
        rows: Array.from({ length: rows }, (_, i) => ({ sku: `SKU-${i}`, name: `Product number ${i} with a reasonably long descriptive name`, qty: i })),
        totalRows: rows,
    },
    highlights: [
        { text: 'A written highlight.', tone: 'neutral' },
        { text: 'A flagged highlight.', tone: 'watch' },
        { text: '[Purchase orders raised this cycle]', tone: 'fill' },
    ],
    caveats,
});

it('never prints the account manager placeholder or an Actions Taken section', () => {
    const text = textOf(buildReportDocDefinition(report(3, ['A note.']), { marketplace: { country: 'US' } }).content);
    expect(text.some((t) => /Purchase orders raised/.test(t))).toBe(false);
    expect(text.some((t) => /ACTIONS TAKEN/i.test(t))).toBe(false);
    expect(text).toContain('A written highlight.');
});

it('pulls stray closing lines back rather than leaving them alone on a last page', async () => {
    const notes = ['First note about what is not covered.', 'Second note, a little longer, about another source that is not yet captured.', 'Third note.'];
    let neededCompact = 0;
    // Enough table lengths that the closing lands on every part of a page.
    for (let rows = 8; rows <= 40; rows += 1) {
        for (const caveats of [notes, []]) {
            const result = await renderReportPdfDetailed(report(rows, caveats), { marketplace: { country: 'US' } });
            expect({ rows, notes: caveats.length, orphaned: result.orphaned }).toEqual({ rows, notes: caveats.length, orphaned: false });
            if (result.compact) neededCompact += 1;
        }
    }
    // The case exists and was handled, not merely never met.
    expect(neededCompact).toBeGreaterThan(0);
}, 120000);

/**
 * What the emailed PDF can actually DRAW.
 *
 * Checking the document definition's text alone missed two bugs under the old
 * built-in Helvetica: "₹1,234" drew as "¹1,234", and every "▲ 12.5%" change
 * line drew as "%² 12.5%" — the definition held the right characters, the font
 * simply had no glyphs for them and pdfmake does not warn.
 *
 * The fix is structural, and these pin the structure: Poppins is embedded (it
 * has ₹, zł and ₺), no text is set in a font without those glyphs, the arrows
 * are drawn shapes rather than characters, and a symbol Poppins lacks falls
 * back to the ISO code instead of printing nothing.
 */
const { renderReportPdf, buildReportDocDefinition } = require('../../../Services/Reports/reportPdf.js');
const { drawable, printableCurrency } = require('../../../Services/Reports/reportBrand.js');

const report = (stats) => ({ name: 'Test', summary: { stats, columns: [], rows: [] }, highlights: [], caveats: [] });
const walk = (node, visit) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
    if (typeof node === 'object') { visit(node); Object.values(node).forEach((child) => walk(child, visit)); }
};

it('embeds Poppins and sets no text in a font that lacks its glyphs', async () => {
    const pdf = (await renderReportPdf(report([{ label: 'Sales', value: 1234, format: 'currency', delta: 5 }]), { marketplace: { country: 'IN' } })).toString('latin1');
    expect(pdf).toMatch(/Poppins/);
    expect(pdf).not.toMatch(/\/BaseFont\s*\/Helvetica/);
    expect(pdf).not.toMatch(/ZapfDingbats/);
});

it('draws the change arrows as shapes, with the figure beside them rather than over them', () => {
    const doc = buildReportDocDefinition(report([
        { label: 'Up', value: 5, delta: 12.5, deltaFormat: 'percent' },
        { label: 'Down', value: 5, delta: -4 },
    ]), { marketplace: { country: 'US' } });

    const arrowRows = [];
    walk(doc.content, (node) => {
        if (Array.isArray(node.columns) && node.columns[0]?.svg?.includes('<path')) arrowRows.push(node);
    });
    expect(arrowRows).toHaveLength(2);
    // A ZapfDingbats glyph inline measured zero width, and "4" was drawn over it.
    expect(arrowRows.map((row) => row.columns[1].text)).toEqual(['12.5%', '4']);
    expect(JSON.stringify(doc.content)).not.toMatch(/\\u25b2|\\u25bc|▲|▼/i);
});

it("prints each marketplace's own symbol, which Poppins can draw", () => {
    for (const [country, symbol] of [['US', '$'], ['UK', '£'], ['DE', '€'], ['IN', '₹'], ['PL', 'zł'], ['TR', '₺']]) {
        expect(printableCurrency(country)).toBe(symbol);
        expect(drawable(symbol)).toBe(true);
    }
    const doc = buildReportDocDefinition(report([{ label: 'Sales', value: 1234, format: 'currency' }]), { marketplace: { country: 'IN' } });
    expect(JSON.stringify(doc.content)).toContain('₹1,234');
});

it('falls back to the ISO code for a symbol Poppins lacks, rather than printing nothing', () => {
    expect(drawable('د.إ')).toBe(false);
    expect(printableCurrency('AE')).toBe('AED ');
});

it('still honours an explicit currency', () => {
    const doc = buildReportDocDefinition(report([{ label: 'Sales', value: 10, format: 'currency' }]), { marketplace: { country: 'UK' }, currency: '$' });
    expect(JSON.stringify(doc.content)).toContain('$10');
});

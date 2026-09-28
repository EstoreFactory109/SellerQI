/**
 * What the emailed PDF actually DRAWS, decoded from the rendered bytes.
 *
 * Checking the document definition cannot catch this class of bug: the text
 * there was "▲ 12.5%" and "₹1,234", both correct. But the built-in Helvetica
 * has neither glyph, pdfmake does not fall back or warn, and the page printed
 * "%² 12.5%" on every change line of every tile, and "¹1,234" for rupees.
 * These tests read the glyph bytes out of the finished file.
 */
const zlib = require('zlib');
const { renderReportPdf, buildReportDocDefinition } = require('../../../Services/Reports/reportPdf.js');

/** Every text run in the page streams, as the byte codes the reader draws. */
const drawnRuns = (pdf) => {
    const source = pdf.toString('latin1');
    const streams = [...source.matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
        .map((match) => { try { return zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { return ''; } })
        .join('\n');
    return [...streams.matchAll(/<([0-9a-f]+)>/gi)].map((match) => Buffer.from(match[1], 'hex'));
};
const hex = (buffer) => buffer.toString('hex');

const report = (stats) => ({ name: 'Test', summary: { stats, columns: [], rows: [] }, highlights: [], caveats: [] });

it('draws the change arrows from ZapfDingbats, not as Helvetica noise', async () => {
    const pdf = await renderReportPdf(report([
        { label: 'Up', value: 5, delta: 12.5, deltaFormat: 'percent' },
        { label: 'Down', value: 5, delta: -3 },
    ]));
    const runs = drawnRuns(pdf).map(hex);

    // 's' and 't' are ZapfDingbats' up and down triangles.
    expect(runs).toContain(Buffer.from('s').toString('hex'));
    expect(runs).toContain(Buffer.from('t').toString('hex'));
    // The old output: U+25B2 split into the bytes "%²".
    expect(runs.some((run) => run.includes('25b2') || run.includes('25bc'))).toBe(false);
    expect(pdf.toString('latin1')).toMatch(/ZapfDingbats/);
});

it('prints a currency the font cannot draw as its ISO code', () => {
    const doc = buildReportDocDefinition(report([{ label: 'Sales', value: 1234, format: 'currency' }]), { marketplace: { country: 'IN' } });
    const tileValue = doc.content.flatMap((node) => node.table?.body?.[0] || [])
        .flatMap((cell) => cell.stack || []).map((part) => part.text).find((text) => /1,234/.test(text));
    expect(tileValue).toBe('INR 1,234');
});

it("uses the marketplace's own symbol when none is passed, and one the font can draw", async () => {
    for (const [country, expected] of [['UK', 'a3'], ['DE', '80'], ['US', '24']]) {
        const pdf = await renderReportPdf(report([{ label: 'Sales', value: 1234, format: 'currency' }]), { marketplace: { country } });
        // £ is 0xA3 and € is 0x80 in WinAnsi; $ is 0x24.
        expect(drawnRuns(pdf).map(hex).some((run) => run.startsWith(expected) && run.includes(Buffer.from('1,234').toString('hex')))).toBe(true);
    }
});

it('still honours an explicit currency', () => {
    const doc = buildReportDocDefinition(report([{ label: 'Sales', value: 10, format: 'currency' }]), { marketplace: { country: 'UK' }, currency: '$' });
    expect(JSON.stringify(doc.content)).toContain('$10');
});

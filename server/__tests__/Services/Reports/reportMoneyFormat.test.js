/**
 * Price cells keep their cents.
 *
 * WHY THIS IS SEPARATE FROM 'currency'
 * The reports' existing currency format rounds to whole units, which is right
 * for what it was written for — "Total sales $124,530" does not want a decimal
 * point. It is wrong for a per-unit price, and actively misleading for the Buy
 * Box report's price gap, where the cents are the entire finding: a real row of
 * $22.49 against $17.50 with a $4.99 gap would have printed as "$22", "$18",
 * "$5" — three numbers that no longer reconcile on the page, inviting the
 * reader to believe the report cannot add up.
 *
 * Asserted through the rendered PDF rather than the formatter, because the
 * formatter is not exported and the thing that matters is what reaches paper.
 */
const { buildReportDocDefinition } = require('../../../Services/Reports/reportPdf.js');

/** Every text node in a pdfmake document definition, flattened. */
const allText = (node, out = []) => {
    if (node === null || node === undefined) return out;
    if (Array.isArray(node)) { node.forEach((child) => allText(child, out)); return out; }
    if (typeof node === 'object') {
        if (typeof node.text === 'string') out.push(node.text);
        Object.values(node).forEach((value) => allText(value, out));
        return out;
    }
    return out;
};

const render = (columns, rows, stats = []) => allText(buildReportDocDefinition({
    key: 'buybox', name: 'Weekly Buybox Report', available: true,
    summary: { columns, rows, stats },
    highlights: [], caveats: [],
}, { currency: '$' }));

describe("the 'money' format", () => {
    const columns = [
        { key: 'sku', label: 'SKU' },
        { key: 'ourPrice', label: 'Our price', format: 'money' },
        { key: 'competingPrice', label: 'Buy Box price', format: 'money' },
        { key: 'priceGap', label: 'Gap', format: 'money' },
    ];

    it('prints prices and the gap to the cent, so the row reconciles', () => {
        const text = render(columns, [{ sku: 'S1', ourPrice: 22.49, competingPrice: 17.5, priceGap: 4.99 }]);

        expect(text).toEqual(expect.arrayContaining(['$22.49', '$17.50', '$4.99']));
        // The rounded forms must not appear at all.
        expect(text).not.toEqual(expect.arrayContaining(['$22', '$18', '$5']));
    });

    it('pads a round number rather than dropping the decimals', () => {
        // "$20" beside "$17.50" reads as a different precision, not a rounder
        // price.
        const text = render(columns, [{ sku: 'S1', ourPrice: 20, competingPrice: 17.5, priceGap: 2.5 }]);
        expect(text).toEqual(expect.arrayContaining(['$20.00', '$17.50', '$2.50']));
    });

    it('keeps the sign on a negative gap, which is the good case', () => {
        // Losing the Buy Box while priced BELOW it is the finding that says
        // price is not the problem. It must not read as a positive gap.
        const text = render(columns, [{ sku: 'S1', ourPrice: 15, competingPrice: 20, priceGap: -5 }]);
        expect(text).toEqual(expect.arrayContaining(['-$5.00']));
    });

    it('shows an em dash for a gap that could not be computed', () => {
        // Null means "not priced", and 0 would mean "matched" — the two must
        // never render the same.
        const text = render(columns, [{ sku: 'S1', ourPrice: null, competingPrice: null, priceGap: null }]);
        expect(text).toEqual(expect.arrayContaining(['—']));
        expect(text).not.toEqual(expect.arrayContaining(['$0.00']));
    });

    it('leaves the aggregate currency format rounding as it was', () => {
        // Every other report still renders whole units; this change is
        // additive, not a redefinition.
        const text = render(
            [{ key: 'sales', label: 'Sales', format: 'currency' }],
            [{ sales: 124530.4 }]
        );
        expect(text).toEqual(expect.arrayContaining(['$124,530']));
    });

    it('applies to the stat tile as well as the table', () => {
        const text = render(columns, [{ sku: 'S1', priceGap: 4.99 }], [
            { label: 'Widest price gap', value: 4.99, format: 'money' },
        ]);
        expect(text.filter((value) => value === '$4.99').length).toBeGreaterThanOrEqual(2);
    });
});

/**
 * Weekly brand-offer check: which ASINs it covers and what it keeps.
 */
jest.mock('../../../models/products/BrandOfferSnapshotModel.js', () => ({ create: jest.fn() }));
const { selectBrandAsins, toSnapshotItems, normaliseBrand, MAX_BRAND_ASINS } = require('../../../Services/Sp_API/BrandOffersSync.js');

describe('selectBrandAsins', () => {
    const p = (asin, brand, status = 'Active') => ({ asin, brand, status });

    it('keeps active listings of the account\'s own brand, best sellers first', () => {
        const asins = selectBrandAsins(
            [p('A1', 'Könighaus'), p('A2', 'KONIGHAUS'), p('A3', 'Other Co'), p('A4', 'Könighaus', 'Inactive'), p('A1', 'Könighaus')],
            'Könighaus',
            { A1: { sales: 10 }, A2: { sales: 500 } }
        );
        expect(asins).toEqual(['A2', 'A1']);
    });

    it('matches brand names loosely (case, accents, spaces, punctuation)', () => {
        expect(selectBrandAsins([p('A1', 'nootri-mind')], 'NootriMind')).toEqual(['A1']);
        expect(normaliseBrand('Könighaus')).toBe(normaliseBrand('KONIGHAUS'));
    });

    it('checks nothing without a real account brand', () => {
        expect(selectBrandAsins([p('A1', 'Brand Name')], 'Brand Name')).toEqual([]);
        expect(selectBrandAsins([p('A1', 'X')], '')).toEqual([]);
    });

    it('caps at the top 200 by revenue', () => {
        const products = Array.from({ length: 250 }, (_, i) => p(`A${i}`, 'Acme'));
        const sales = Object.fromEntries(products.map((x, i) => [x.asin, { sales: i }]));
        const asins = selectBrandAsins(products, 'Acme', sales);
        expect(asins).toHaveLength(MAX_BRAND_ASINS);
        expect(asins[0]).toBe('A249');
    });
});

describe('toSnapshotItems', () => {
    it('keeps other sellers\' IDs per ASIN, dropping ours and blanks, and keeps errors', () => {
        expect(toSnapshotItems([
            { asin: 'A1', offers: [{ sellerId: 'S1', isOurs: true }, { sellerId: 'S2' }, { sellerId: 'S2' }, { sellerId: '' }] },
            { asin: 'A2', error: 'Amazon returned 500 for this ASIN', offers: [] }
        ])).toEqual([
            { asin: 'A1', sellerIds: ['S2'], offerCount: 3, error: '' },
            { asin: 'A2', sellerIds: [], offerCount: 0, error: 'Amazon returned 500 for this ASIN' }
        ]);
    });
});

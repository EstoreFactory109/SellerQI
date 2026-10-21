/**
 * "Amazon ready" is an intersection: an Active ASIN with no Error in any check.
 *
 * It used to be built by adding ASINs: from rankings.TotalErrors, which does not
 * exist (getRankings returns { finalResult }), so that loop never added anything,
 * and then from backend keywords alone - add on clean, delete on error - so an
 * ASIN with clean keywords counted as ready whatever else was wrong.
 */

const { AnalyseService } = require('../../../Services/main/Analyse.js');

const cleanProduct = (asin, overrides = {}) => ({
    asin,
    product_title: 'Acme Ceramic Coffee Mug, 12 oz, Blue',
    about_product: ['A'.repeat(160)],
    product_description: ['A'.repeat(1800)],
    product_photos: ['1', '2', '3', '4', '5'],
    video_url: ['https://v'],
    product_star_ratings: '4.6',
    product_num_ratings: '120',
    has_brandstory: true,
    ...overrides,
});

// 220 bytes of distinct words: no Warning, no duplicates.
const goodKeywords = Array.from({ length: 40 }, (_, i) => `kw${String(i).padStart(3, '0')}`).join(' ');

const run = ({ products, reviews, keywords = [], aplus = [], buyBox = [] }) => AnalyseService.processConversionData(
    { products },
    {
        numberOfProductReviews: { Products: reviews },
        GetlistingAllItems: { GenericKeyword: keywords },
        aplusResponse: { ApiContentDetails: aplus },
        buyBoxData: { asinBuyBoxData: buyBox },
    }
);

describe('Amazon-ready products', () => {
    const asins = ['CLEAN', 'TITLE', 'IMG', 'KW', 'APLUS', 'BUYBOX', 'INACTIVE'];
    const products = asins.map((asin) => ({ asin, status: asin === 'INACTIVE' ? 'Inactive' : 'Active' }));

    const result = () => run({
        products,
        reviews: [
            cleanProduct('CLEAN'),
            cleanProduct('TITLE', { product_title: 'Acme Mug - Best Seller, Free Shipping' }),
            cleanProduct('IMG', { product_photos: ['1'] }),
            cleanProduct('KW'),
            cleanProduct('APLUS'),
            cleanProduct('BUYBOX'),
            cleanProduct('INACTIVE'),
        ],
        keywords: [
            { asin: 'CLEAN', value: goodKeywords },
            // A clean second SKU used to re-add an ASIN another check removed.
            { asin: 'TITLE', value: goodKeywords },
            { asin: 'KW', value: `${goodKeywords} kw000` },
        ],
        aplus: [
            { Asins: 'CLEAN', status: 'APPROVED' },
            { Asins: 'APLUS', status: 'NOT_AVAILABLE' },
        ],
        buyBox: [
            { childAsin: 'CLEAN', buyBoxLost: false, buyBoxPercentage: 100 },
            { childAsin: 'BUYBOX', buyBoxLost: true, buyBoxPercentage: 0 },
            ...['TITLE', 'IMG', 'KW', 'APLUS', 'INACTIVE'].map((childAsin) => ({ childAsin, buyBoxLost: false, buyBoxPercentage: 90 })),
        ],
    });

    it('keeps only Active ASINs with no Error in any check', () => {
        expect(result().conversionData.AmazonReadyproducts).toEqual(['CLEAN']);
    });

    it('does not let a short-keyword Warning cost readiness', () => {
        const r = run({
            products: [{ asin: 'A', status: 'Active' }],
            reviews: [cleanProduct('A')],
            keywords: [{ asin: 'A', value: 'short keywords' }],
        });
        expect(r.conversionData.AmazonReadyproducts).toEqual(['A']);
    });

    it('does not count an Active ASIN with no scrape data as ready', () => {
        const r = run({
            products: [{ asin: 'A', status: 'Active' }, { asin: 'UNSCRAPED', status: 'Active' }],
            reviews: [cleanProduct('A')],
        });
        expect(r.conversionData.AmazonReadyproducts).toEqual(['A']);
    });

    it('lists an ASIN once even when it has several SKUs', () => {
        const r = run({
            products: [{ asin: 'A', status: 'Active' }, { asin: 'A', status: 'Active' }],
            reviews: [cleanProduct('A')],
        });
        expect(r.conversionData.AmazonReadyproducts).toEqual(['A']);
    });

    it('removes ASINs with inventory errors afterwards', () => {
        const ready = ['CLEAN', 'OTHER'];
        AnalyseService.updateAmazonReadyProducts(ready, new Map([['OTHER', 1]]));
        expect(ready).toEqual(['CLEAN']);
    });

    it('passes the brand-story scrape flag through for task coverage', () => {
        expect(result().conversionData.brandStoryScrapePresent).toBe(true);
        expect(run({ products, reviews: [] }).conversionData.brandStoryScrapePresent).toBe(false);
    });
});

describe('calculateErrorSummary', () => {
    it('counts missing A+ and lost Buy Box (both used to read fields that do not exist)', () => {
        const conversion = run({
            products: [{ asin: 'A', status: 'Active' }, { asin: 'B', status: 'Active' }],
            reviews: [cleanProduct('A'), cleanProduct('B')],
            aplus: [{ Asins: 'A', status: 'NOT_AVAILABLE' }, { Asins: 'B', status: 'APPROVED' }],
            buyBox: [{ childAsin: 'A', buyBoxLost: true }, { childAsin: 'B', buyBoxLost: false }],
        });
        const summary = AnalyseService.calculateErrorSummary(conversion, { errorsByAsin: new Map() });
        expect(summary.conversionErrors).toBe(1); // A+ on A
        expect(summary.buyboxErrors).toBe(1);     // Buy Box on A
    });
});

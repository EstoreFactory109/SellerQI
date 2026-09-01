/**
 * Tests for TopProductsService — the AI narration layer over the product rollup.
 *
 * The discipline being protected: the model writes prose and nothing else. Every
 * number, the ordering, and the set of products all come from our own rollup, and
 * anything the model invents or omits must not reach a seller.
 */

const {
    validateSelections,
    buildDeterministicSelections,
    buildPromptPayload,
    MAX_SELECTIONS
} = require('../../../Services/AI/TopProductsService.js');

const product = (over = {}) => ({
    asin: over.asin || 'B0AAAAAAAA',
    productName: over.productName || 'A Product',
    // Capped profit figure — a product's gap already contains its ad waste.
    profitImpact: over.profitImpact ?? 100,
    profitGap: over.profitGap ?? 100,
    adWasteComponent: over.adWasteComponent ?? 0,
    capitalTiedUp: over.capitalTiedUp ?? 0,
    amountIsEstimated: over.amountIsEstimated ?? false,
    taskCount: over.taskCount ?? 3,
    adsTaskCount: over.adsTaskCount ?? 0,
    categories: over.categories || ['profitability'],
    notInCatalogue: over.notInCatalogue ?? false,
    topTasks: []
});

describe('buildPromptPayload', () => {
    it('sends only what the model needs to write prose', () => {
        const [row] = buildPromptPayload([product({ taskCount: 3, adsTaskCount: 12 })]);
        expect(Object.keys(row).sort()).toEqual([
            'adWasteShare', 'capitalTiedUp', 'issueCategories', 'issueCount', 'name', 'notInCatalogue', 'productId', 'profitImpact'
        ]);
        // Issue count is the seller-visible total across both tallies.
        expect(row.issueCount).toBe(15);
    });

    it('stays small enough to be worth the round trip', () => {
        const products = Array.from({ length: 8 }, (_, i) =>
            product({ asin: `B0${String(i).padStart(8, '0')}`, productName: 'x'.repeat(200) }));
        const bytes = JSON.stringify(buildPromptPayload(products)).length;
        // ~4 chars/token: 8 products must cost far less than sending raw tasks.
        expect(bytes / 4).toBeLessThan(1000);
    });
});

describe('validateSelections', () => {
    const products = [
        product({ asin: 'B01', profitImpact: 500, profitGap: 500 }),
        product({ asin: 'B02', profitImpact: 100, profitGap: 100 }),
        product({ asin: 'B03', profitImpact: 0, profitGap: 0, categories: ['ranking'] })
    ];

    it('keeps the model prose but our numbers', () => {
        const [first] = validateSelections(
            [{ productId: 'B01', rank: 1, why: 'model why', action: 'model action' }],
            products
        );
        expect(first.why).toBe('model why');
        expect(first.action).toBe('model action');
        expect(first.profitImpact).toBe(500); // ours, not the model's
    });

    it('drops a product the model invented', () => {
        const out = validateSelections(
            [{ productId: 'B0HALLUCINATED', rank: 1, why: 'w', action: 'a' }],
            products
        );
        expect(out.map(p => p.asin)).not.toContain('B0HALLUCINATED');
        expect(out.every(p => ['B01', 'B02', 'B03'].includes(p.asin))).toBe(true);
    });

    it('ignores a duplicated product', () => {
        const out = validateSelections([
            { productId: 'B01', rank: 1, why: 'w', action: 'a' },
            { productId: 'B01', rank: 2, why: 'w', action: 'a' }
        ], products);
        expect(out.filter(p => p.asin === 'B01')).toHaveLength(1);
    });

    it('tops up from our own ranking when the model under-delivers', () => {
        const out = validateSelections([{ productId: 'B02', rank: 1, why: 'w', action: 'a' }], products);
        expect(out.length).toBe(3);
        expect(out.map(p => p.asin)).toContain('B01');
    });

    it('never lets a product worth nothing outrank one worth money', () => {
        const out = validateSelections([
            { productId: 'B03', rank: 1, why: 'w', action: 'a' },
            { productId: 'B01', rank: 2, why: 'w', action: 'a' }
        ], products);
        expect(out[0].asin).toBe('B01');
        expect(out[out.length - 1].asin).toBe('B03');
        expect(out.map(p => p.rank)).toEqual([1, 2, 3]);
    });

    it('caps the list', () => {
        const many = Array.from({ length: 20 }, (_, i) => product({ asin: `B${i}`, profitImpact: 100 - i, profitGap: 100 - i }));
        const raw = many.map((p, i) => ({ productId: p.asin, rank: i + 1, why: 'w', action: 'a' }));
        expect(validateSelections(raw, many).length).toBe(MAX_SELECTIONS);
    });

    // The model reliably folds the next step into "why" and leaves action blank.
    it('substitutes a real action when the model omits it', () => {
        const [only] = validateSelections(
            [{ productId: 'B01', rank: 1, why: 'explains the problem', action: '' }],
            [products[0]]
        );
        expect(only.action).toBeTruthy();
        expect(only.action.toLowerCase()).toContain('price');
    });

    it('handles junk instead of an array', () => {
        expect(() => validateSelections(null, products)).not.toThrow();
        expect(validateSelections(null, products).length).toBe(3); // fully topped up
    });
});

describe('buildDeterministicSelections', () => {
    it('always produces both a why and an action', () => {
        const out = buildDeterministicSelections([
            product({ asin: 'B01', profitImpact: 100 }),
            product({ asin: 'B02', profitImpact: 0, profitGap: 0, categories: ['ranking'] }),
            product({ asin: 'B03', notInCatalogue: true, profitImpact: 50, profitGap: 0, adWasteComponent: 50 })
        ]);
        expect(out).toHaveLength(3);
        out.forEach(p => {
            expect(p.why).toBeTruthy();
            expect(p.action).toBeTruthy();
        });
    });

    it('calls out a product that is advertised but not listed', () => {
        const [p] = buildDeterministicSelections([product({ notInCatalogue: true })]);
        expect(p.why).toMatch(/isn't in your active listings/i);
        expect(p.action).toMatch(/relist|stop advertising/i);
    });

    it('says so when a product\'s value is mostly inferred from ad attribution', () => {
        const [p] = buildDeterministicSelections([
            // Ad waste is the dominant part of the capped figure.
            product({ profitImpact: 90, profitGap: 10, adWasteComponent: 90, amountIsEstimated: true })
        ]);
        expect(p.why).toMatch(/advertising spend attributed/i);
    });

    it('does not claim money for a product that has none', () => {
        const [p] = buildDeterministicSelections([
            product({ profitImpact: 0, profitGap: 0, categories: ['ranking'] })
        ]);
        expect(p.why).toMatch(/no direct monetary loss/i);
    });
});

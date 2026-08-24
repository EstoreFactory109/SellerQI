/**
 * Tests for carrying per-product fields across the merchant-listings rebuild.
 *
 * WHY THIS EXISTS
 * `GET_MERCHANT_LISTINGS_ALL_DATA` rebuilds `sellerAccount[].products` from Amazon's listings
 * report, which only supplies {asin, sku, itemName, price, status, quantity}. Assigning that array
 * straight over the existing one made Mongoose apply sub-schema defaults to every other field, so
 * `issueCount` reset to 0 and `issues` / `has_b2b_pricing` were dropped — for the ENTIRE account,
 * in the INIT phase, minutes into a run.
 *
 * Those values are only recomputed in CALC_REVIEW, phase 7 of 8, after the 40-50 min ADS phase and
 * the 10-25 min FINANCE phase. The dashboard reads the live Seller document with no snapshot layer
 * and hides any product whose effective issue count is 0, so a customer watching the "products to
 * fix" widgets saw them empty for hours and then repopulate. That was the reported bug.
 * `has_b2b_pricing` was worse: nothing on the scheduled path restores it at all, so the daily run
 * destroyed it permanently.
 *
 * THE TRAP THIS FILE GUARDS
 * `issues` cannot simply be carried forward. It is only ever SET for Inactive/Incomplete products
 * and NOTHING ever clears it — today the wholesale replace is the only mechanism that does. Carry
 * it unconditionally and a product that gets FIXED keeps its stale issue strings forever, and
 * because DashboardCalculation falls back to `issues.length` when `issueCount` is 0, that product
 * permanently re-enters "top products to fix". The status gate is the whole point; the test named
 * "loses its stale issues" is the one that fails if someone removes it.
 */

const {
    carryForwardProductFields,
    productKey,
    TOTAT_PRODUCTS_HISTORY_LIMIT,
} = require('../../../Services/Sp_API/GET_MERCHANT_LISTINGS_ALL_DATA.js');

/** A stored product, as it exists on the seller doc after a previous cycle. */
const stored = (over = {}) => ({
    asin: 'B000000001',
    sku: 'SKU-1',
    itemName: 'Widget',
    price: '10.00',
    status: 'Active',
    quantity: 5,
    issueCount: 7,
    issueCountUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
    has_b2b_pricing: true,
    ...over,
});

/** A freshly-parsed report row — exactly the six fields the report supplies, nothing else. */
const incoming = (over = {}) => ({
    asin: 'B000000001',
    sku: 'SKU-1',
    itemName: 'Widget',
    price: '10.00',
    status: 'Active',
    quantity: 5,
    ...over,
});

describe('productKey', () => {
    test('is the asin|sku composite, trimmed', () => {
        expect(productKey({ asin: ' B1 ', sku: ' S1 ' })).toBe('B1|S1');
    });

    test('missing pieces do not throw or collide with a real key', () => {
        expect(productKey({})).toBe('|');
        expect(productKey(null)).toBe('|');
        expect(productKey({ asin: 'B1' })).toBe('B1|');
    });
});

describe('carryForwardProductFields — the fields that were being wiped', () => {
    test('issueCount, issueCountUpdatedAt and has_b2b_pricing survive the rebuild', () => {
        const when = new Date('2026-08-01T00:00:00.000Z');
        const out = carryForwardProductFields(
            [stored({ issueCount: 7, issueCountUpdatedAt: when, has_b2b_pricing: true })],
            [incoming()]
        );

        expect(out[0].issueCount).toBe(7);
        expect(out[0].issueCountUpdatedAt).toBe(when);
        expect(out[0].has_b2b_pricing).toBe(true);
    });

    test('an issueCount of 0 is carried, not treated as absent', () => {
        // `0` is falsy; a truthiness check here would silently leave the field undefined and let
        // the schema default re-apply, which is the exact bug being fixed.
        const out = carryForwardProductFields([stored({ issueCount: 0 })], [incoming()]);
        expect(out[0].issueCount).toBe(0);
    });

    test('has_b2b_pricing false is carried, not skipped as falsy', () => {
        const out = carryForwardProductFields([stored({ has_b2b_pricing: false })], [incoming()]);
        expect(out[0].has_b2b_pricing).toBe(false);
    });

    test('report-owned fields always take the INCOMING value, never the stored one', () => {
        const out = carryForwardProductFields(
            [stored({ itemName: 'Old Name', price: '10.00', status: 'Active', quantity: 5 })],
            [incoming({ itemName: 'New Name', price: '12.50', status: 'Inactive', quantity: 99 })]
        );

        expect(out[0].itemName).toBe('New Name');
        expect(out[0].price).toBe('12.50');
        expect(out[0].status).toBe('Inactive');
        // quantity is deliberately not carried — the FBA sync overwrites it seconds later.
        expect(out[0].quantity).toBe(99);
    });
});

describe('carryForwardProductFields — the `issues` status gate', () => {
    // THE regression test. Without the gate this passes stale strings through forever.
    test('a product fixed to Active LOSES its stale issues', () => {
        const out = carryForwardProductFields(
            [stored({ status: 'Inactive', issues: ['Missing images', 'No description'] })],
            [incoming({ status: 'Active' })]
        );

        expect(out[0].issues).toBeUndefined();
    });

    test('a still-Inactive product KEEPS its issues', () => {
        const out = carryForwardProductFields(
            [stored({ status: 'Inactive', issues: ['Missing images'] })],
            [incoming({ status: 'Inactive' })]
        );

        expect(out[0].issues).toEqual(['Missing images']);
    });

    test('Incomplete is issue-bearing too', () => {
        const out = carryForwardProductFields(
            [stored({ status: 'Incomplete', issues: ['Missing brand'] })],
            [incoming({ status: 'Incomplete' })]
        );

        expect(out[0].issues).toEqual(['Missing brand']);
    });

    test('a product that was Active and stays Active never gains an issues array', () => {
        const out = carryForwardProductFields([stored({ status: 'Active' })], [incoming({ status: 'Active' })]);
        expect(out[0].issues).toBeUndefined();
    });

    test('issueCount still carries even when issues is dropped', () => {
        // The two fields are governed by different rules; dropping one must not drop the other.
        const out = carryForwardProductFields(
            [stored({ status: 'Inactive', issues: ['x'], issueCount: 3 })],
            [incoming({ status: 'Active' })]
        );

        expect(out[0].issues).toBeUndefined();
        expect(out[0].issueCount).toBe(3);
    });
});

describe('carryForwardProductFields — identity and mis-attribution', () => {
    // The reason the key is composite rather than sku-only. issueCount is derived PER ASIN, so
    // inheriting it across an ASIN change would attribute one product's errors to another.
    test('a SKU re-pointed to a different ASIN does NOT inherit the old issueCount', () => {
        const out = carryForwardProductFields(
            [stored({ asin: 'B000000001', sku: 'SKU-1', issueCount: 9 })],
            [incoming({ asin: 'B000000002', sku: 'SKU-1' })]
        );

        expect(out[0].issueCount).toBeUndefined();
        expect(out[0].has_b2b_pricing).toBeUndefined();
    });

    test('one ASIN under several SKUs keeps each SKU its own values', () => {
        // 95 real accounts have this shape (6,084 such ASINs), so it is not a hypothetical.
        const out = carryForwardProductFields(
            [
                stored({ asin: 'B0SHARED', sku: 'SKU-A', issueCount: 1, has_b2b_pricing: true }),
                stored({ asin: 'B0SHARED', sku: 'SKU-B', issueCount: 2, has_b2b_pricing: false }),
            ],
            [
                incoming({ asin: 'B0SHARED', sku: 'SKU-A' }),
                incoming({ asin: 'B0SHARED', sku: 'SKU-B' }),
            ]
        );

        expect(out.map((p) => p.issueCount)).toEqual([1, 2]);
        expect(out.map((p) => p.has_b2b_pricing)).toEqual([true, false]);
    });

    test('a brand-new listing gets nothing carried onto it', () => {
        const out = carryForwardProductFields(
            [stored({ asin: 'B0OLD', sku: 'SKU-OLD', issueCount: 5 })],
            [incoming({ asin: 'B0NEW', sku: 'SKU-NEW' })]
        );

        expect(out[0].issueCount).toBeUndefined();
        expect(out[0].issues).toBeUndefined();
        expect(out[0].has_b2b_pricing).toBeUndefined();
    });

    test('keys are trimmed on both sides, so whitespace does not break a match', () => {
        const out = carryForwardProductFields(
            [stored({ asin: 'B000000001', sku: 'SKU-1', issueCount: 4 })],
            [incoming({ asin: ' B000000001 ', sku: ' SKU-1 ' })]
        );

        expect(out[0].issueCount).toBe(4);
    });
});

describe('carryForwardProductFields — the rebuild contract', () => {
    // The whole reason the array is replaced rather than merged in place.
    test('a delisted product is NOT resurrected', () => {
        const out = carryForwardProductFields(
            [stored({ sku: 'SKU-1' }), stored({ asin: 'B000000002', sku: 'SKU-GONE' })],
            [incoming({ sku: 'SKU-1' })]
        );

        expect(out).toHaveLength(1);
        expect(out.map((p) => p.sku)).toEqual(['SKU-1']);
    });

    test('the incoming array is returned, with its length and order untouched', () => {
        const rows = [
            incoming({ asin: 'B1', sku: 'S1' }),
            incoming({ asin: 'B2', sku: 'S2' }),
            incoming({ asin: 'B3', sku: 'S3' }),
        ];
        const out = carryForwardProductFields([stored({ asin: 'B2', sku: 'S2' })], rows);

        expect(out).toBe(rows);
        expect(out.map((p) => p.sku)).toEqual(['S1', 'S2', 'S3']);
    });

    test('the stored products are never mutated', () => {
        const existing = [stored({ issueCount: 7 })];
        const snapshot = JSON.stringify(existing);

        carryForwardProductFields(existing, [incoming({ status: 'Inactive', quantity: 99 })]);

        expect(JSON.stringify(existing)).toBe(snapshot);
    });

    test('first-ever connect (no existing products) is a clean no-op', () => {
        const rows = [incoming()];
        const out = carryForwardProductFields([], rows);

        expect(out).toBe(rows);
        expect(out[0].issueCount).toBeUndefined();
    });

    test('null/undefined inputs do not throw', () => {
        expect(() => carryForwardProductFields(null, null)).not.toThrow();
        expect(carryForwardProductFields(null, [incoming()])).toHaveLength(1);
        expect(carryForwardProductFields([stored()], null)).toEqual([]);
        expect(carryForwardProductFields([stored(), null], [incoming()])).toHaveLength(1);
    });

    test('a large account merges without quadratic blow-up', () => {
        // 27k products is a real production figure; a nested-loop implementation would crawl here.
        const existing = Array.from({ length: 27000 }, (_, i) =>
            stored({ asin: `B${i}`, sku: `S${i}`, issueCount: i % 5 }));
        const rows = Array.from({ length: 27000 }, (_, i) =>
            incoming({ asin: `B${i}`, sku: `S${i}` }));

        const started = Date.now();
        const out = carryForwardProductFields(existing, rows);

        expect(out[26999].issueCount).toBe(26999 % 5);
        expect(Date.now() - started).toBeLessThan(2000);
    });
});

describe('TotatProducts history cap', () => {
    test('is exported and bounded', () => {
        expect(TOTAT_PRODUCTS_HISTORY_LIMIT).toBe(90);
    });

    test('the trim keeps the NEWEST entries', () => {
        // Mirrors the splice at the call site: entries are appended, so the tail is newest.
        const history = Array.from({ length: 1131 }, (_, i) => ({ NumberOfProducts: i }));
        if (history.length > TOTAT_PRODUCTS_HISTORY_LIMIT) {
            history.splice(0, history.length - TOTAT_PRODUCTS_HISTORY_LIMIT);
        }

        expect(history).toHaveLength(90);
        expect(history[89].NumberOfProducts).toBe(1130);
        expect(history[0].NumberOfProducts).toBe(1041);
    });

    test('a short history is left alone', () => {
        const history = Array.from({ length: 5 }, (_, i) => ({ NumberOfProducts: i }));
        if (history.length > TOTAT_PRODUCTS_HISTORY_LIMIT) {
            history.splice(0, history.length - TOTAT_PRODUCTS_HISTORY_LIMIT);
        }

        expect(history).toHaveLength(5);
    });
});

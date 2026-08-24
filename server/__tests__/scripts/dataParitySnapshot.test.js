/**
 * Locks the dataParitySnapshot collection registry.
 *
 * Why this test exists: the script is the safety net used to prove a change did not alter the data
 * the daily pipeline writes. For a long time it covered ads + DashboardSlice + AsinWiseSalesDateItem
 * and NONE of the four finance-dashboard collections — so a finance change could be "verified" by a
 * green "✅ Data parity confirmed" that had never looked at DailySkuFinance at all. A false pass is
 * worse than no check, because it stops you looking further.
 *
 * These assertions are deliberately about coverage and key-shape, not behaviour, because that is
 * exactly the property that silently regressed.
 */

const { buildCollections, stripVolatile } = require('../../scripts/dataParitySnapshot.js');

describe('dataParitySnapshot — collection registry', () => {
    const byName = () => {
        const map = new Map();
        for (const c of buildCollections()) map.set(c.name, c);
        return map;
    };

    test('every finance-dashboard collection the finance sync writes is registered', () => {
        const names = [...byName().keys()];
        for (const required of ['DailySkuFinance', 'DailyOverheadFinance', 'FinanceSyncLog', 'PendingExpenseOrder']) {
            expect(names).toContain(required);
        }
    });

    test('the pre-existing ads / slice / asin coverage is retained', () => {
        const names = [...byName().keys()];
        for (const required of ['PPCMetrics', 'ProductWiseSponsoredAdsItem', 'DashboardSlice', 'AsinWiseSalesDateItem']) {
            expect(names).toContain(required);
        }
    });

    // The daily pipeline rebuilds sellerAccount[].products wholesale on every run, and a regression
    // there (issue counts reset, products dropped) was invisible to every other entry — the same
    // false-pass class this file exists to prevent.
    test('seller products are registered, expanded per product', () => {
        const entry = byName().get('SellerProducts');

        expect(entry).toBeDefined();
        expect(typeof entry.expand).toBe('function');
        // Country/region live on the nested account, so the document filter is user-only.
        expect(entry.filter('u1', 'US', 'NA')).toEqual({ User: 'u1' });
    });

    test('SellerProducts expands to one entry per product, scoped to the requested marketplace', () => {
        const entry = byName().get('SellerProducts');
        const doc = {
            sellerAccount: [
                { country: 'US', region: 'NA', products: [{ asin: 'B1', sku: 'S1' }, { asin: 'B2', sku: 'S2' }] },
                { country: 'UK', region: 'EU', products: [{ asin: 'B9', sku: 'S9' }] },
            ],
        };

        const out = entry.expand(doc, 'u1', 'US', 'NA');

        expect(out).toHaveLength(2);
        expect(out.map((p) => p.sku)).toEqual(['S1', 'S2']);
        expect(out.map((p) => entry.keyOf(p))).toEqual(['US|NA|B1|S1', 'US|NA|B2|S2']);
    });

    test('SellerProducts expansion drops TotatProducts, which changes on every run by design', () => {
        // If that array reached the hash, every comparison would report a mismatch that is not real.
        const entry = byName().get('SellerProducts');
        const doc = {
            sellerAccount: [{
                country: 'US', region: 'NA',
                TotatProducts: [{ NumberOfProducts: 1 }, { NumberOfProducts: 2 }],
                products: [{ asin: 'B1', sku: 'S1' }],
            }],
        };

        const out = entry.expand(doc, 'u1', 'US', 'NA');

        expect(out).toHaveLength(1);
        expect(out[0]).not.toHaveProperty('TotatProducts');
    });

    test('SellerProducts expansion tolerates an account with no products', () => {
        const entry = byName().get('SellerProducts');
        expect(entry.expand({ sellerAccount: [{ country: 'US', region: 'NA' }] }, 'u1', 'US', 'NA')).toEqual([]);
        expect(entry.expand({}, 'u1', 'US', 'NA')).toEqual([]);
    });

    test('every entry loaded its model — a bad path is skipped with a warning, silently reducing coverage', () => {
        for (const c of buildCollections()) {
            expect(c.model).toBeDefined();
        }
    });

    test('finance collections filter on User + upper-cased country', () => {
        // FinanceService stores country upper-cased. Passing --country=us must not silently match
        // zero documents and hash two empty sets to "identical".
        for (const name of ['DailySkuFinance', 'DailyOverheadFinance', 'FinanceSyncLog', 'PendingExpenseOrder']) {
            const q = byName().get(name).filter('u1', 'us', 'NA');
            expect(q.country).toBe('US');
            expect(q.User).toBe('u1');
            expect(q.region).toBe('NA');
        }
    });

    test('each finance collection has a date field so --days actually scopes it', () => {
        expect(byName().get('DailySkuFinance').dateField).toBe('date');
        expect(byName().get('DailyOverheadFinance').dateField).toBe('date');
        expect(byName().get('FinanceSyncLog').dateField).toBe('date');
        expect(byName().get('PendingExpenseOrder').dateField).toBe('purchasePacificDate');
    });

    test('natural keys distinguish documents that share a date', () => {
        const m = byName();
        // Two SKUs on the same day must not collide, or one would mask the other in the diff.
        const a = m.get('DailySkuFinance').keyOf({ date: '2026-07-01', sku: 'SKU-A', asin: 'B1' });
        const b = m.get('DailySkuFinance').keyOf({ date: '2026-07-01', sku: 'SKU-B', asin: 'B2' });
        expect(a).not.toBe(b);

        const c1 = m.get('DailyOverheadFinance').keyOf({ date: '2026-07-01', category: 'storage' });
        const c2 = m.get('DailyOverheadFinance').keyOf({ date: '2026-07-01', category: 'ads' });
        expect(c1).not.toBe(c2);

        // PendingExpenseOrder is unique on (orderId, sku) — multi-SKU orders have several rows.
        const p1 = m.get('PendingExpenseOrder').keyOf({ orderId: '111-22', sku: 'SKU-A' });
        const p2 = m.get('PendingExpenseOrder').keyOf({ orderId: '111-22', sku: 'SKU-B' });
        expect(p1).not.toBe(p2);
    });
});

describe('dataParitySnapshot — volatile-field handling', () => {
    test('per-entry ignoreFields keep a re-run from reading as a data change', () => {
        const m = new Map(buildCollections().map((c) => [c.name, c]));

        // PendingExpenseOrder is a work queue: `attempts` increments every time Step 2 tries to
        // resolve the order, and `firstSeenAt` is a timestamp. Neither is data.
        expect(m.get('PendingExpenseOrder').ignoreFields).toEqual(
            expect.arrayContaining(['attempts', 'firstSeenAt'])
        );
        // syncRunId records WHICH run wrote a day, not what it wrote.
        expect(m.get('FinanceSyncLog').ignoreFields).toEqual(expect.arrayContaining(['syncRunId']));
    });

    test('stripVolatile drops the extra fields as well as the global ones', () => {
        const out = stripVolatile(
            { _id: 'x', date: '2026-07-01', productSales: 10, attempts: 3, firstSeenAt: new Date() },
            new Set(['attempts', 'firstSeenAt'])
        );
        expect(out).toEqual({ date: '2026-07-01', productSales: 10 });
    });

    test('two docs differing ONLY in an ignored field normalise identically', () => {
        const extra = new Set(['attempts']);
        const a = stripVolatile({ orderId: '1', sku: 'A', salesAmount: 5, attempts: 1 }, extra);
        const b = stripVolatile({ orderId: '1', sku: 'A', salesAmount: 5, attempts: 9 }, extra);
        expect(a).toEqual(b);
    });

    test('a real data change is still caught', () => {
        const extra = new Set(['attempts']);
        const a = stripVolatile({ orderId: '1', sku: 'A', salesAmount: 5, attempts: 1 }, extra);
        const b = stripVolatile({ orderId: '1', sku: 'A', salesAmount: 6, attempts: 1 }, extra);
        expect(a).not.toEqual(b);
    });
});

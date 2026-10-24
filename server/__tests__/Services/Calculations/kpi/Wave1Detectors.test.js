/**
 * Wave 1 of the tasks-logics.xlsx detectors. Thresholds are the spreadsheet's;
 * each test names the rule it pins.
 */
const W1 = require('../../../../Services/Calculations/kpi/Wave1Detectors.js');

const NOW = new Date('2026-10-24T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 864e5).toISOString();
const day = (n) => daysAgo(n).slice(0, 10);

const products = new Map([
    ['A1', { asin: 'A1', sku: 'S1', itemName: 'Garlic Press', quantity: 0 }],
    ['A2', { asin: 'A2', sku: 'S2', itemName: 'Peeler', quantity: 0 }],
    ['A3', { asin: 'A3', sku: 'S3', itemName: 'Ladle', quantity: 12 }]
]);

describe('topRevenueAsins', () => {
    it('keeps the top 20% of ASINs that sold, rounded up', () => {
        const sales = { A1: { sales: 900 }, A2: { sales: 50 }, A3: { sales: 10 }, A4: { sales: 0 } };
        expect([...W1.topRevenueAsins(sales)]).toEqual(['A1']);
    });
});

describe('detectListingSuppressed', () => {
    const suppressed = (items, at = daysAgo(1)) => ({ createdAt: at, items });
    const stock = { fetchedAt: daysAgo(0), byAsin: { A1: { total: 40, fulfillable: 40, inbound: 0 } } };

    it('raises a task for a suppressed listing with stock, with Amazon\'s reason', () => {
        const r = W1.detectListingSuppressed({
            suppressed: suppressed([{ sku: 'S1', asin: 'A1', status: 'Search Suppressed', reason: 'Missing image', issueDescription: 'Main image missing' }]),
            stock, salesByAsin: { A1: { sales: 300, unitsSold: 10 } }, productsByAsin: products, now: NOW
        });
        expect(r.covered).toBe(true);
        expect(r.tasks).toHaveLength(1);
        expect(r.tasks[0]).toMatchObject({
            asin: 'A1', errorCategory: 'inventory', errorType: 'listing_suppressed',
            productName: 'Garlic Press', amount: 300, amountIsEstimated: true
        });
        expect(r.tasks[0].error).toBe('Listing Blocked | Search Suppressed: Amazon is hiding this product from search results, so shoppers cannot find it, because: Main image missing.');
        expect(r.tasks[0].renderData.topSeller).toBe(true);
        expect(r.asins.get('A1')).toBeTruthy();
    });

    it('counts seller-fulfilled stock on the catalogue rows', () => {
        const r = W1.detectListingSuppressed({
            suppressed: suppressed([{ sku: 'S3', asin: 'A3', status: 'Blocked', reason: 'x' }]),
            stock: null, salesByAsin: {}, catalogue: W1.catalogueByAsin([...products.values()]),
            productsByAsin: products, now: NOW
        });
        expect(r.tasks.map(t => t.asin)).toEqual(['A3']);
        // A3's only SKU is the suppressed one, so the product is unbuyable.
        expect(r.asins.has('A3')).toBe(true);
    });

    it('keeps the SKU task but does not call the product unbuyable while another SKU sells', () => {
        const catalogue = W1.catalogueByAsin([
            { asin: 'A3', sku: 'S3', status: 'Active', quantity: 12 },
            { asin: 'A3', sku: 'S3-FBM', status: 'Active', quantity: 40 }
        ]);
        const r = W1.detectListingSuppressed({
            suppressed: suppressed([{ sku: 'S3', asin: 'A3', status: 'Blocked', reason: 'x' }]),
            stock: null, salesByAsin: {}, catalogue, productsByAsin: products, now: NOW
        });
        expect(r.tasks.map(t => t.asin)).toEqual(['A3']);
        expect(r.asins.has('A3')).toBe(false);
    });

    it('skips a suppressed listing with no stock and no sales (spreadsheet: stock or sales)', () => {
        const r = W1.detectListingSuppressed({
            suppressed: suppressed([{ sku: 'S2', asin: 'A2', status: 'Blocked', reason: 'x' }]),
            stock, salesByAsin: {}, productsByAsin: products, now: NOW
        });
        expect(r.tasks).toEqual([]);
        expect(r.covered).toBe(true);
    });

    it('counts sales from the 60-day lookback when the dashboard window has none', () => {
        const input = {
            suppressed: suppressed([{ sku: 'S2', asin: 'A2', status: 'Blocked', reason: 'x' }]),
            stock: null, salesByAsin: {}, productsByAsin: products, now: NOW
        };
        expect(W1.detectListingSuppressed(input).tasks).toEqual([]);
        const r = W1.detectListingSuppressed({ ...input, salesLookback: { A2: { sales: 80, unitsSold: 4 } } });
        expect(r.tasks.map(t => t.asin)).toEqual(['A2']);
        // The amount stays on the dashboard window, like every other task's.
        expect(r.tasks[0].amount).toBe(0);
    });

    it('merges several SKUs of one ASIN into one task', () => {
        const r = W1.detectListingSuppressed({
            suppressed: suppressed([
                { sku: 'S1', asin: 'A1', status: 'Blocked', reason: 'one' },
                { sku: 'S1-B', asin: 'A1', status: 'Blocked', reason: 'two' }
            ]),
            stock, salesByAsin: {}, productsByAsin: products, now: NOW
        });
        expect(r.tasks).toHaveLength(1);
        expect(r.tasks[0].renderData.skus).toEqual(['S1', 'S1-B']);
        expect(r.tasks[0].error).toContain('one; two');
    });

    it('is not covered when the report is missing or older than 7 days', () => {
        expect(W1.detectListingSuppressed({ suppressed: null, now: NOW }).covered).toBe(false);
        expect(W1.detectListingSuppressed({ suppressed: suppressed([], daysAgo(8)), now: NOW }).covered).toBe(false);
    });
});

describe('detectOutOfStock', () => {
    const stock = (byAsin, at = daysAgo(0)) => ({ fetchedAt: at, byAsin });

    it('fires on fulfillable 0 + inbound 0 + sold in the window, with lost sales per day', () => {
        const r = W1.detectOutOfStock({
            stock: stock({ A1: { fulfillable: 0, inbound: 0, total: 0, skus: ['S1'] } }),
            salesByAsin: { A1: { sales: 600, unitsSold: 60 } },
            financeFresh: true, windowDays: 30, catalogue: W1.catalogueByAsin([...products.values()]),
            productsByAsin: products, now: NOW
        });
        expect(r.tasks).toHaveLength(1);
        expect(r.tasks[0]).toMatchObject({ asin: 'A1', errorType: 'out_of_stock', amount: 600, amountIsEstimated: true });
        expect(r.tasks[0].error).toContain('It sold 60 units in the last 30 days, so it is losing about 2 sales a day.');
        expect(r.tasks[0].renderData).toMatchObject({ unitsPerDay: 2, salesPerDay: 20 });
    });

    // Seen on a German account: FBA SKUs at 0 next to an active self-shipped SKU
    // holding 69,967 units. 78 false "out of stock" tasks before this rule.
    it('does not fire while another active SKU of the product has stock', () => {
        const r = W1.detectOutOfStock({
            stock: stock({ A1: { fulfillable: 0, inbound: 0, total: 0 } }),
            salesByAsin: { A1: { sales: 600, unitsSold: 60 } }, financeFresh: true, windowDays: 30,
            catalogue: W1.catalogueByAsin([
                { asin: 'A1', sku: 'S1-FBA', status: 'Inactive', quantity: 0 },
                { asin: 'A1', sku: 'S1', status: 'Active', quantity: 69967 }
            ]),
            now: NOW
        });
        expect(r.tasks).toEqual([]);
    });

    // Seen on a US account: an old FBA SKU at 0 for an ASIN no longer in the catalogue.
    it('does not fire for a product that is no longer in the catalogue', () => {
        const r = W1.detectOutOfStock({
            stock: stock({ GONE: { fulfillable: 0, inbound: 0, total: 0 } }),
            salesByAsin: { GONE: { sales: 350, unitsSold: 1 } }, financeFresh: true, windowDays: 30,
            catalogue: W1.catalogueByAsin([...products.values()]), now: NOW
        });
        expect(r.tasks).toEqual([]);
    });

    it('an inactive SKU with a stale quantity does not count as stock', () => {
        const r = W1.detectOutOfStock({
            stock: stock({ A1: { fulfillable: 0, inbound: 0, total: 0 } }),
            salesByAsin: { A1: { sales: 600, unitsSold: 60 } }, financeFresh: true, windowDays: 30,
            catalogue: W1.catalogueByAsin([{ asin: 'A1', sku: 'S1', status: 'Inactive', quantity: 5 }]),
            now: NOW
        });
        expect(r.tasks).toHaveLength(1);
    });

    it('states slow sellers plainly instead of "0.0 units a day"', () => {
        const run = (unitsSold) => W1.detectOutOfStock({
            stock: stock({ A1: { fulfillable: 0, inbound: 0, total: 0 } }),
            salesByAsin: { A1: { sales: 350, unitsSold } }, financeFresh: true, windowDays: 30,
            catalogue: W1.catalogueByAsin([...products.values()]), now: NOW
        }).tasks[0].error;
        expect(run(1)).toContain('It sold 1 unit in the last 30 days.');
        expect(run(8)).toContain('It sold 8 units in the last 30 days, so it is losing about 2 sales a week.');
    });

    it('does not fire while stock is inbound', () => {
        const r = W1.detectOutOfStock({
            stock: stock({ A1: { fulfillable: 0, inbound: 24, total: 24 } }),
            salesByAsin: { A1: { sales: 600, unitsSold: 60 } }, financeFresh: true, windowDays: 30, now: NOW
        });
        expect(r.tasks).toEqual([]);
    });

    it('does not fire for a product that did not sell (spreadsheet: sold in the last 30 days)', () => {
        const r = W1.detectOutOfStock({
            stock: stock({ A1: { fulfillable: 0, inbound: 0, total: 0 } }),
            salesByAsin: {}, financeFresh: true, windowDays: 30, now: NOW
        });
        expect(r.tasks).toEqual([]);
        expect(r.covered).toBe(true);
    });

    it('is not covered on stale stock rows or stale finance', () => {
        const s = stock({ A1: { fulfillable: 0, inbound: 0 } }, daysAgo(4));
        expect(W1.detectOutOfStock({ stock: s, financeFresh: true, now: NOW }).covered).toBe(false);
        expect(W1.detectOutOfStock({ stock: stock({}), financeFresh: false, now: NOW }).covered).toBe(false);
    });
});

describe('detectAdsOnUnbuyable', () => {
    const ads = [
        { asin: 'A1', date: day(1), spend: 5 },
        { asin: 'A1', date: day(5), spend: 10 },
        { asin: 'A1', date: day(20), spend: 99 },  // outside the 7-day measure
        { asin: 'A2', date: day(6), spend: 8 },    // spent, but not in the last 3 days
        { asin: 'A3', date: day(1), spend: 4 }
    ];

    it('flags spend on an out-of-stock ASIN, measuring the newest 7 days', () => {
        const r = W1.detectAdsOnUnbuyable({
            adsRows: ads, unbuyable: new Map([['A1', 'it is out of stock'], ['A2', 'it is out of stock']]),
            buyBoxRows: [], unbuyableCovered: true, country: 'US', productsByAsin: products, now: NOW
        });
        expect(r.covered).toBe(true);
        expect(r.tasks.map(t => t.asin)).toEqual(['A1']);
        expect(r.tasks[0]).toMatchObject({ errorCategory: 'sponsoredAds', errorType: 'ads_on_unbuyable', amount: 15, amountIsEstimated: false });
        expect(r.tasks[0].error).toContain('it is out of stock');
    });

    it('treats a Buy Box under 50% as unbuyable', () => {
        const r = W1.detectAdsOnUnbuyable({
            adsRows: ads, unbuyable: new Map(),
            buyBoxRows: [{ childAsin: 'A3', buyBoxPercentage: 30 }, { childAsin: 'A1', buyBoxPercentage: 50 }],
            unbuyableCovered: true, country: 'US', now: NOW
        });
        expect(r.tasks.map(t => t.asin)).toEqual(['A3']);
        expect(r.tasks[0].error).toContain('30% of visits');
    });

    it('ignores a Buy Box row with no percentage', () => {
        const r = W1.detectAdsOnUnbuyable({
            adsRows: ads, unbuyable: new Map(), buyBoxRows: [{ childAsin: 'A3', buyBoxPercentage: null }],
            unbuyableCovered: true, country: 'US', now: NOW
        });
        expect(r.tasks).toEqual([]);
    });

    it('is not covered on stale ads data or when stock/suppression were not judged', () => {
        const old = [{ asin: 'A1', date: day(30), spend: 5 }];
        expect(W1.detectAdsOnUnbuyable({ adsRows: old, unbuyable: new Map(), unbuyableCovered: true, country: 'US', now: NOW }).covered).toBe(false);
        expect(W1.detectAdsOnUnbuyable({ adsRows: ads, unbuyable: new Map(), unbuyableCovered: false, country: 'US', now: NOW }).covered).toBe(false);
    });
});

describe('detectCogsMissing', () => {
    it('raises one account task naming best sellers without a cost', () => {
        const r = W1.detectCogsMissing({
            cogsAsins: ['A2'],
            salesByAsin: { A1: { sales: 100 }, A2: { sales: 500 }, A3: { sales: 300 }, A4: { sales: 0 } },
            financeFresh: true, windowDays: 30, productsByAsin: products
        });
        expect(r.tasks).toHaveLength(1);
        expect(r.tasks[0]).toMatchObject({ asin: 'ACCOUNT', errorCategory: 'profitability', errorType: 'cogs_missing' });
        expect(r.tasks[0].renderData).toEqual({ count: 2, asins: ['A3', 'A1'] });
        expect(r.tasks[0].solution).toContain('A3 (Ladle), A1 (Garlic Press)');
    });

    it('is quiet when every selling product has a cost', () => {
        const r = W1.detectCogsMissing({ cogsAsins: ['A1'], salesByAsin: { A1: { sales: 1 } }, financeFresh: true });
        expect(r).toEqual({ tasks: [], covered: true });
    });

    it('is not covered when COGS could not be read or finance is stale', () => {
        expect(W1.detectCogsMissing({ cogsAsins: null, financeFresh: true }).covered).toBe(false);
        expect(W1.detectCogsMissing({ cogsAsins: [], financeFresh: false }).covered).toBe(false);
    });
});

describe('detectAhrEarlyWarning', () => {
    const h = (...rows) => rows.map(([n, score]) => ({ at: daysAgo(n), score }));

    it('fires on a 20-point drop within 7 days', () => {
        const r = W1.detectAhrEarlyWarning({ ahrHistory: h([6, 420], [3, 410], [0, 395]), now: NOW });
        expect(r.tasks).toHaveLength(1);
        expect(r.tasks[0]).toMatchObject({ asin: 'ACCOUNT', errorCategory: 'account', errorType: 'ahr_early_warning' });
        expect(r.tasks[0].error).toContain('dropped 25 points in the last 6 days, from 420 to 395');
    });

    it('does not fire on a 19-point drop', () => {
        expect(W1.detectAhrEarlyWarning({ ahrHistory: h([6, 414], [0, 395]), now: NOW }).tasks).toEqual([]);
    });

    it('fires when the score crosses below 250 this week, even by less than 20 points', () => {
        const r = W1.detectAhrEarlyWarning({ ahrHistory: h([5, 262], [0, 246]), now: NOW });
        expect(r.tasks).toHaveLength(1);
        expect(r.tasks[0].error).toBe("Account | Account Health Early Warning: It fell below 250 this week and at 246 is close to Amazon's At Risk cutoff of 200.");
    });

    // Production, 24 Oct 2026: 56 of 81 fresh marketplaces sat at 200-249; one held
    // exactly 200 every day for a month. A resting score is not a warning.
    it('does not fire on a score resting below 250', () => {
        expect(W1.detectAhrEarlyWarning({ ahrHistory: h([6, 200], [3, 200], [0, 200]), now: NOW })).toEqual({ tasks: [], covered: true });
        expect(W1.detectAhrEarlyWarning({ ahrHistory: h([0, 240]), now: NOW }).tasks).toEqual([]);
    });

    it('leaves below 200 to the account-status task', () => {
        expect(W1.detectAhrEarlyWarning({ ahrHistory: h([0, 180]), now: NOW }).tasks).toEqual([]);
    });

    it('never judges a newest report without a score', () => {
        expect(W1.detectAhrEarlyWarning({ ahrHistory: h([6, 600], [0, null]), now: NOW })).toEqual({ tasks: [], covered: false });
    });

    it('needs a baseline at least a day older than the newest report', () => {
        // Two reports the same day: no 7-day comparison possible.
        const r = W1.detectAhrEarlyWarning({ ahrHistory: [{ at: daysAgo(0.2), score: 500 }, { at: daysAgo(0), score: 450 }], now: NOW });
        expect(r.tasks).toEqual([]);
    });
});

describe('detectRemovalShortfall', () => {
    const line = (over) => ({
        orderId: 'R1', orderType: 'Return', orderStatus: 'Completed', lastUpdatedDate: daysAgo(10), sku: 'S1',
        requestedQuantity: 10, shippedQuantity: 6, disposedQuantity: 0, cancelledQuantity: 1, inProcessQuantity: 0, ...over
    });
    const removals = (lines, at = daysAgo(2)) => ({ createdAt: at, lines });
    const catalogue = [...products.values()];

    it('flags a completed order with units unaccounted for', () => {
        const r = W1.detectRemovalShortfall({ removals: removals([line()]), products: catalogue, productsByAsin: products, now: NOW });
        expect(r.tasks).toHaveLength(1);
        expect(r.tasks[0]).toMatchObject({ asin: 'A1', productName: 'Garlic Press', errorType: 'removal_shortfall' });
        expect(r.tasks[0].error).toBe('Removal Order Shortfall: Removal order R1 was completed with 3 units not accounted for (requested 10, shipped 6, disposed 0, cancelled 1).');
    });

    it('ignores open orders, full orders and orders outside 60 days', () => {
        const r = W1.detectRemovalShortfall({
            removals: removals([
                line({ orderStatus: 'Pending' }),
                line({ orderId: 'R2', shippedQuantity: 9 }),
                line({ orderId: 'R3', lastUpdatedDate: daysAgo(61) })
            ]),
            products: catalogue, productsByAsin: products, now: NOW
        });
        expect(r.tasks).toEqual([]);
        expect(r.covered).toBe(true);
    });

    it('subtracts units Amazon already reimbursed against the order', () => {
        const r = W1.detectRemovalShortfall({
            removals: removals([line()]), reimbursements: { R1: { S1: 2 } },
            products: catalogue, productsByAsin: products, now: NOW
        });
        expect(r.tasks[0].renderData.units).toBe(1);
        expect(r.tasks[0].error).toContain('with 1 unit not accounted for');
        expect(r.tasks[0].error).toContain('already reimbursed 2');
    });

    it('raises nothing once the reimbursement covers the shortfall, using SKU-less rows too', () => {
        const r = W1.detectRemovalShortfall({
            removals: removals([line()]), reimbursements: { R1: { S1: 1, '': 5 } },
            products: catalogue, productsByAsin: products, now: NOW
        });
        expect(r.tasks).toEqual([]);
    });

    it('spends one order\'s reimbursed units only once across its lines', () => {
        const r = W1.detectRemovalShortfall({
            removals: removals([line(), line({ sku: 'S2' })]), reimbursements: { R1: { '': 3 } },
            products: catalogue, productsByAsin: products, now: NOW
        });
        // 3 short on each line; the 3 reimbursed units clear the first line only.
        expect(r.tasks.map(t => [t.asin, t.renderData.units])).toEqual([['A2', 3]]);
    });

    it('ignores reimbursements for other orders', () => {
        const r = W1.detectRemovalShortfall({
            removals: removals([line()]), reimbursements: { R9: { S1: 10 } },
            products: catalogue, productsByAsin: products, now: NOW
        });
        expect(r.tasks[0].renderData.units).toBe(3);
    });

    it('keys an unknown SKU by the SKU, not a made-up ASIN', () => {
        const r = W1.detectRemovalShortfall({ removals: removals([line({ sku: 'GONE-1' })]), products: catalogue, now: NOW });
        expect(r.tasks[0]).toMatchObject({ asin: 'SKU:GONE-1', productName: 'SKU GONE-1' });
    });

    it('is not covered when the weekly report is older than 10 days', () => {
        expect(W1.detectRemovalShortfall({ removals: removals([], daysAgo(11)), now: NOW }).covered).toBe(false);
    });
});

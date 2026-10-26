/**
 * Wave 3 of the tasks-logics.xlsx detectors.
 */
const W3 = require('../../../../Services/Calculations/kpi/Wave3Detectors.js');

const NOW = new Date('2026-10-24T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 864e5).toISOString();
const products = new Map([['A1', { asin: 'A1', itemName: 'Garlic Press' }]]);

describe('detectListingWarnings', () => {
    it('raises one task per ASIN with its WARNING messages, ignoring errors', () => {
        const r = W3.detectListingWarnings({
            products: [
                { asin: 'A1', sku: 'S1', listingIssues: [{ severity: 'WARNING', message: 'Missing color' }, { severity: 'ERROR', message: 'x' }] },
                { asin: 'A1', sku: 'S1-B', listingIssues: [{ severity: 'warning', message: 'Missing color' }] },
                { asin: 'A2', sku: 'S2', listingIssues: [] }
            ],
            productsByAsin: products
        });
        expect(r.tasks).toHaveLength(1);
        expect(r.tasks[0]).toMatchObject({ asin: 'A1', errorType: 'listing_warnings' });
        expect(r.tasks[0].error).toBe('Listing Warning: Amazon has a warning on this listing: Missing color.');
        expect(r.tasks[0].renderData.skus).toEqual(['S1', 'S1-B']);
    });

    // Seen on a German account: one rejected compliance document behind 2,041 listings' warnings.
    it('turns a warning on 3+ listings into one grouped task, keeping rarer ones per product', () => {
        const doc = { severity: 'WARNING', message: 'The document that you previously submitted was rejected.' };
        const r = W3.detectListingWarnings({
            products: [
                { asin: 'A1', sku: 'S1', listingIssues: [doc, { severity: 'WARNING', message: 'Missing color' }] },
                { asin: 'A2', sku: 'S2', listingIssues: [doc] },
                { asin: 'A3', sku: 'S3', listingIssues: [doc] }
            ],
            productsByAsin: products
        });
        expect(r.tasks).toHaveLength(2);
        const grouped = r.tasks.find(t => t.asin.startsWith('WARNING:'));
        expect(grouped).toMatchObject({ productName: '3 listings', errorType: 'listing_warnings' });
        expect(grouped.error).toBe('Listing Warning: Amazon has the same warning on 3 of your listings: The document that you previously submitted was rejected.');
        expect(grouped.renderData.asins).toEqual(['A1', 'A2', 'A3']);
        const single = r.tasks.find(t => t.asin === 'A1');
        expect(single.error).toBe('Listing Warning: Amazon has a warning on this listing: Missing color.');
        // Same message, same id on the next run.
        const again = W3.detectListingWarnings({ products: [
            { asin: 'A1', sku: 'S1', listingIssues: [doc] }, { asin: 'A2', sku: 'S2', listingIssues: [doc] }, { asin: 'A3', sku: 'S3', listingIssues: [doc] }
        ] });
        expect(again.tasks[0].asin).toBe(grouped.asin);
    });

    it('is not covered until the weekly sync has stored issues on any SKU', () => {
        expect(W3.detectListingWarnings({ products: [{ asin: 'A1', sku: 'S1' }] }).covered).toBe(false);
    });
});

describe('detectInvoiceDefectRate', () => {
    it('fires when the status is not GOOD', () => {
        const r = W3.detectInvoiceDefectRate({ v2: { invoiceDefectRateStatus: 'AT_RISK', invoiceDefectRatePct: 6.5 } });
        expect(r.tasks[0]).toMatchObject({ asin: 'ACCOUNT', errorCategory: 'account', errorType: 'invoice_defect_rate' });
        expect(r.tasks[0].error).toContain('invoice defect rate 6.5%');
        expect(r.tasks[0].error).toContain('Amazon rates this as at risk');
    });

    it('treats GOOD, NONE and blank as fine, and an old report as unjudged', () => {
        for (const s of ['GOOD', 'NONE', '']) expect(W3.detectInvoiceDefectRate({ v2: { invoiceDefectRateStatus: s } })).toEqual({ tasks: [], covered: true });
        expect(W3.detectInvoiceDefectRate({ v2: {} }).covered).toBe(false);
        expect(W3.detectInvoiceDefectRate({ v2: null }).covered).toBe(false);
    });
});

describe('detectLowInventoryFeeRisk', () => {
    const sold = { A1: { unitsSold: 30 } };
    const run = (rows, salesByAsin = sold) => W3.detectLowInventoryFeeRisk({ planning: { rows }, salesByAsin, productsByAsin: products });

    it('fires when both measures are under 28 days, or Amazon flags the fee', () => {
        expect(run([{ asin: 'A1', short: 20, long: 25, feeApplied: null }]).tasks[0].renderData.level).toBe('applies');
        expect(run([{ asin: 'A1', short: 60, long: 70, feeApplied: 'Yes' }]).tasks[0].renderData.level).toBe('applies');
    });

    it('warns under 35 days on both, and not when only one measure is low', () => {
        expect(run([{ asin: 'A1', short: 30, long: 33, feeApplied: null }]).tasks[0].renderData.level).toBe('warning');
        expect(run([{ asin: 'A1', short: 10, long: 50, feeApplied: null }]).tasks).toEqual([]);
    });

    it('skips products that are not selling', () => {
        expect(run([{ asin: 'A1', short: 5, long: 5, feeApplied: null }], {}).tasks).toEqual([]);
    });

    it('is not covered until the report carries these columns', () => {
        expect(run([{ asin: 'A1', short: null, long: null, feeApplied: null }]).covered).toBe(false);
        expect(W3.detectLowInventoryFeeRisk({ planning: null }).covered).toBe(false);
    });
});

describe('detectFbaFeeIncrease', () => {
    const snap = (bySku, at) => ({ at, bySku });
    const run = (newest, previous, salesByAsin = { A1: { unitsSold: 100 } }) => W3.detectFbaFeeIncrease({
        fbaFees: { newest: snap(newest, daysAgo(2)), previous: previous && snap(previous, daysAgo(9)) },
        salesByAsin, productsByAsin: products, now: NOW
    });

    it('flags a fee rise, with a month of the extra fee as the amount', () => {
        const r = run({ S1: { asin: 'A1', sizeTier: 'Large standard', fee: 5.5 } }, { S1: { asin: 'A1', sizeTier: 'Large standard', fee: 5.0 } });
        expect(r.tasks[0]).toMatchObject({ asin: 'A1', errorType: 'fba_fee_increase', amount: 50, amountIsEstimated: true });
        expect(r.tasks[0].error).toBe('FBA Fee Increase: Amazon now charges 5.50 per unit to fulfil, up from 5.00.');
    });

    it('flags a size tier change and names both tiers', () => {
        const r = run({ S1: { asin: 'A1', sizeTier: 'Large bulky', fee: 9 } }, { S1: { asin: 'A1', sizeTier: 'Large standard', fee: 9 } });
        expect(r.tasks[0].error).toContain('Its size tier changed from "Large standard" to "Large bulky".');
    });

    it('ignores rounding-sized rises, cheaper tiers, and SKUs new this week', () => {
        expect(run({ S1: { asin: 'A1', sizeTier: 'X', fee: 5.05 } }, { S1: { asin: 'A1', sizeTier: 'X', fee: 5.0 } }).tasks).toEqual([]);
        expect(run({ S1: { asin: 'A1', sizeTier: 'Small', fee: 3 } }, { S1: { asin: 'A1', sizeTier: 'Large', fee: 5 } }).tasks).toEqual([]);
        expect(run({ S9: { asin: 'A1', sizeTier: 'X', fee: 9 } }, { S1: { asin: 'A1', sizeTier: 'X', fee: 5 } }).tasks).toEqual([]);
    });

    it('is not covered without two snapshots or with an old newest one', () => {
        expect(run({ S1: { asin: 'A1', fee: 5 } }, null).covered).toBe(false);
        expect(W3.detectFbaFeeIncrease({ fbaFees: { newest: snap({}, daysAgo(11)), previous: snap({}, daysAgo(18)) }, now: NOW }).covered).toBe(false);
    });
});

describe('detectLongHandlingTime', () => {
    it('flags active seller-fulfilled SKUs over 2 days, per ASIN with the longest', () => {
        const r = W3.detectLongHandlingTime({
            products: [
                { asin: 'A1', sku: 'S1', status: 'Active', fulfillmentChannel: 'DEFAULT', handlingTimeDays: 3 },
                { asin: 'A1', sku: 'S1-B', status: 'Active', fulfillmentChannel: 'DEFAULT', handlingTimeDays: 5 },
                { asin: 'A2', sku: 'S2', status: 'Active', fulfillmentChannel: 'AMAZON_NA', handlingTimeDays: 9 },
                { asin: 'A3', sku: 'S3', status: 'Active', fulfillmentChannel: 'DEFAULT', handlingTimeDays: 2 },
                { asin: 'A4', sku: 'S4', status: 'Inactive', fulfillmentChannel: 'DEFAULT', handlingTimeDays: 7 }
            ],
            productsByAsin: products
        });
        expect(r.tasks.map(t => [t.asin, t.renderData.handlingTimeDays])).toEqual([['A1', 5]]);
        expect(r.tasks[0].error).toBe('Long Handling Time: This product, shipped by you, has a 5-day handling time, so Amazon shows shoppers a later delivery date.');
    });

    it('is not covered until the weekly sync has stored a fulfilment channel', () => {
        expect(W3.detectLongHandlingTime({ products: [{ asin: 'A1', sku: 'S1', status: 'Active' }] }).covered).toBe(false);
    });
});

describe('detectNewSellerOnBrand', () => {
    const check = (byAsin, at, sellerIdsReturned = true) => ({ at, sellerIdsReturned, byAsin });
    const run = (newest, previous, authorized = []) => W3.detectNewSellerOnBrand({
        brandOffers: { newest: check(newest, daysAgo(2)), previous: previous && check(previous, daysAgo(9)), authorized },
        productsByAsin: products, now: NOW
    });

    it('flags a seller not on last week\'s list', () => {
        const r = run({ A1: { sellerIds: ['S1', 'S9'], error: '' } }, { A1: { sellerIds: ['S1'], error: '' } });
        expect(r.tasks[0]).toMatchObject({ asin: 'A1', errorType: 'new_seller_on_brand', renderData: { sellerIds: ['S9'] } });
        expect(r.tasks[0].error).toContain('A new seller started offering this product since last week (seller S9)');
    });

    it('skips authorised resellers and ASINs either check could not read', () => {
        expect(run({ A1: { sellerIds: ['S9'], error: '' } }, { A1: { sellerIds: [], error: '' } }, ['S9']).tasks).toEqual([]);
        expect(run({ A1: { sellerIds: ['S9'], error: '' } }, { A1: { sellerIds: [], error: 'Amazon returned 500' } }).tasks).toEqual([]);
        expect(run({ A1: { sellerIds: ['S9'], error: '' } }, {}).tasks).toEqual([]);
    });

    it('is not covered without two checks, or when Amazon withheld seller IDs', () => {
        expect(run({ A1: { sellerIds: ['S9'], error: '' } }, null).covered).toBe(false);
        const withheld = W3.detectNewSellerOnBrand({
            brandOffers: { newest: check({}, daysAgo(2), false), previous: check({}, daysAgo(9)), authorized: [] }, now: NOW
        });
        expect(withheld.covered).toBe(false);
    });
});

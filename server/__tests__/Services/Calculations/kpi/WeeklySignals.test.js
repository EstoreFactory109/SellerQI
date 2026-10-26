/**
 * tasks-logics.xlsx: priced above featured offer expected price, Subscribe & Save
 * (suspended offers; "eligible but not enrolled" is not readable), inbound placement fees.
 */
const W3 = require('../../../../Services/Calculations/kpi/Wave3Detectors.js');
const { parseFoepResponses } = require('../../../../Services/Sp_API/WeeklySignalsSync.js');

describe('parseFoepResponses (live response shape, Oct 2026)', () => {
    it('reads the expected price, or none without a competing offer', () => {
        const rows = parseFoepResponses([
            { status: { statusCode: 200 }, body: { offerIdentifier: { asin: 'B1', sku: 'S1', sellerId: 'ME' }, featuredOfferExpectedPriceResults: [{ resultStatus: 'VALID_FOEP', featuredOfferExpectedPrice: { listingPrice: { currencyCode: 'USD', amount: 126.78 } }, currentFeaturedOffer: { offerIdentifier: { sellerId: 'ME' } } }] } },
            { status: { statusCode: 200 }, body: { offerIdentifier: { asin: 'B2', sku: 'S2', sellerId: 'ME' }, featuredOfferExpectedPriceResults: [{ resultStatus: 'NO_COMPETING_OFFER' }] } }
        ]);
        expect(rows).toEqual([
            { sku: 'S1', asin: 'B1', status: 'VALID_FOEP', expectedPrice: 126.78, currency: 'USD', weAreFeatured: true },
            { sku: 'S2', asin: 'B2', status: 'NO_COMPETING_OFFER', expectedPrice: null, currency: '', weAreFeatured: false }
        ]);
    });
});

describe('detectPricedAboveFeaturedOffer', () => {
    const signals = { featuredOffers: [{ sku: 'S1', asin: 'B1', status: 'VALID_FOEP', expectedPrice: 20, currency: 'USD' }] };
    const run = (price, share) => W3.detectPricedAboveFeaturedOffer({
        weeklySignals: signals, products: [{ asin: 'B1', sku: 'S1', price }], buyBoxRows: [{ childAsin: 'B1', buyBoxPercentage: share }]
    });
    it('flags a price above the expected price while the Buy Box is under 80%', () => {
        const { tasks } = run(24.99, 40);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].error).toContain('($24.99) is above the level Amazon expects to win the Buy Box ($20.00)');
    });
    it('skips when the price is at or under it, or the Buy Box is 80%+', () => {
        expect(run(19.99, 40).tasks).toHaveLength(0);
        expect(run(24.99, 85).tasks).toHaveLength(0);
    });
    it('makes no verdict without the weekly read', () => {
        expect(W3.detectPricedAboveFeaturedOffer({ weeklySignals: { featuredOffers: null } }).covered).toBe(false);
    });
});

describe('detectSubscribeSaveSuspended', () => {
    it('flags suspended offers once per product', () => {
        const { tasks } = W3.detectSubscribeSaveSuspended({ weeklySignals: { subscribeSave: [
            { asin: 'B1', sku: 'S1', eligibility: 'SUSPENDED', subscriptions: 3 },
            { asin: 'B1', sku: 'S1b', eligibility: 'SUSPENDED', subscriptions: 0 },
            { asin: 'B2', sku: 'S2', eligibility: 'ELIGIBLE', subscriptions: 9 }
        ] } });
        expect(tasks.map(t => t.asin)).toEqual(['B1']);
        expect(tasks[0].error).toContain('3 subscribers');
    });
});

describe('detectInboundPlacementFees', () => {
    const run = (total) => W3.detectInboundPlacementFees({ weeklySignals: { placementFees: { total, currency: 'USD', windowDays: 30, plans: [{}, {}] } } });
    it('flags fees over $100 in 30 days', () => {
        expect(run(140.5).tasks[0]).toMatchObject({ errorType: 'inbound_placement_fees', amount: 140.5 });
        expect(run(100).tasks).toHaveLength(0);
        expect(W3.detectInboundPlacementFees({ weeklySignals: { placementFees: null } }).covered).toBe(false);
    });
});

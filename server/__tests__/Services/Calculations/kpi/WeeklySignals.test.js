/**
 * tasks-logics.xlsx: priced above featured offer expected price, Subscribe & Save
 * (suspended offers; "eligible but not enrolled" is not readable), inbound placement fees.
 */
const W3 = require('../../../../Services/Calculations/kpi/Wave3Detectors.js');
const { parseFoepResponses, negativeFeedbackRows, feedbackDay } = require('../../../../Services/Sp_API/WeeklySignalsSync.js');

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

describe('detectBudgetLimitedProfitable', () => {
    const NOW = new Date('2026-10-26T12:00:00Z');
    const recs = (over) => ({ at: new Date('2026-10-25T00:00:00Z'), recs: [{ campaignId: 'C1', name: 'Garlic exact', budget: 5, suggestedBudget: 10, percentTimeInBudget: 0.69, missedSalesLower: 37, missedSalesUpper: 92, ...over }] });
    const rows = (spend, sales) => [{ campaignId: 'C1', totalSpend: spend, totalSales: sales }];

    it('flags a profitable campaign that ran out of budget, with Amazon\'s suggestion', () => {
        const { tasks } = W3.detectBudgetLimitedProfitable({ budgetRecs: recs(), campaignRows: rows(30, 100), now: NOW });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].error).toContain('within its budget only 69% of the time');
        expect(tasks[0].solution).toContain('Amazon suggests $10.00 a day (now $5.00)');
        expect(tasks[0].amount).toBe(37);
    });

    it('skips campaigns above the ACoS target, mostly in budget, or without missed sales', () => {
        expect(W3.detectBudgetLimitedProfitable({ budgetRecs: recs(), campaignRows: rows(50, 100), now: NOW }).tasks).toHaveLength(0);
        expect(W3.detectBudgetLimitedProfitable({ budgetRecs: recs({ percentTimeInBudget: 0.95 }), campaignRows: rows(30, 100), now: NOW }).tasks).toHaveLength(0);
        expect(W3.detectBudgetLimitedProfitable({ budgetRecs: recs({ missedSalesUpper: 0 }), campaignRows: rows(30, 100), now: NOW }).tasks).toHaveLength(0);
        // -1 is Amazon's "unknown" (seen live).
        expect(W3.detectBudgetLimitedProfitable({ budgetRecs: recs({ percentTimeInBudget: -1 }), campaignRows: rows(30, 100), now: NOW }).tasks).toHaveLength(0);
    });

    it('makes no verdict on an old or failed read', () => {
        expect(W3.detectBudgetLimitedProfitable({ budgetRecs: { at: new Date('2026-10-01'), recs: [] }, now: NOW }).covered).toBe(false);
        expect(W3.detectBudgetLimitedProfitable({ budgetRecs: { at: NOW, recs: null }, now: NOW }).covered).toBe(false);
    });
});

describe('negativeFeedbackRows (live report columns, Oct 2026)', () => {
    it('keeps 1-2 star rows per order, without the rater email', () => {
        const rows = negativeFeedbackRows([
            { Date: '10/5/26', Rating: '1', Comments: 'post office says it was delivered in another state', 'Your Response': '', 'Order ID': '114-1', 'Rater Email': 'x@y.com' },
            { Date: '10/6/26', Rating: '5', Comments: 'great', 'Your Response': '', 'Order ID': '114-2' },
            { Date: '10/7/26', Rating: '2', Comments: '', 'Your Response': 'Sorry!', 'Order ID': '114-3' }
        ], 'US');
        expect(rows).toEqual([
            { orderId: '114-1', rating: 1, date: '2026-10-05', comment: 'post office says it was delivered in another state', responded: false },
            { orderId: '114-3', rating: 2, date: '2026-10-07', comment: '', responded: true }
        ]);
    });

    it('reads dates month first in North America, day first elsewhere', () => {
        expect(feedbackDay('10/5/26', 'US')).toBe('2026-10-05');
        expect(feedbackDay('10/5/26', 'UK')).toBe('2026-05-10');
        expect(feedbackDay('2026-10-05T00:00:00Z', 'DE')).toBe('2026-10-05');
        expect(feedbackDay('13/13/26', 'US')).toBeNull();
    });
});

describe('detectNegativeFeedbackOrders', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    const signals = (negatives) => ({ sellerFeedback: { windowDays: 60, negatives } });

    it('makes one task per order from the last 30 days, with removal advice by topic', () => {
        const { tasks, covered } = W3.detectNegativeFeedbackOrders({ now, weeklySignals: signals([
            { orderId: '114-1', rating: 1, date: '2026-10-05', comment: 'Never received it, the package was lost' },
            { orderId: '114-2', rating: 2, date: '2026-10-20', comment: 'Poor quality, broke after a day' },
            { orderId: '114-3', rating: 1, date: '2026-10-21', comment: 'Seller was rude' },
            { orderId: '114-4', rating: 1, date: '2026-09-01', comment: 'old' }
        ]) });
        expect(covered).toBe(true);
        expect(tasks.map(t => [t.asin, t.renderData.topic])).toEqual([['ORDER:114-1', 'delivery'], ['ORDER:114-2', 'product'], ['ORDER:114-3', 'other']]);
        expect(tasks[0]).toMatchObject({ errorCategory: 'account', errorType: 'negative_feedback_order' });
        expect(tasks[0].error).toContain('1-star seller feedback on order 114-1');
        expect(tasks[0].solution).toContain('Request removal');
        expect(tasks[2].solution).toContain('Contact the buyer');
    });

    it('makes no verdict when the report was not read', () => {
        expect(W3.detectNegativeFeedbackOrders({ now, weeklySignals: { sellerFeedback: null } })).toEqual({ tasks: [], covered: false });
        expect(W3.detectNegativeFeedbackOrders({ now, weeklySignals: signals([]) })).toEqual({ tasks: [], covered: true });
    });
});

describe('storageUtilizationFrom (live report columns, Oct 2026)', () => {
    const { storageUtilizationFrom } = require('../../../../Services/Sp_API/WeeklySignalsSync.js');
    it('reads the account ratio, sums volume and surcharge, and ranks products by space', () => {
        const row = (asin, vol, sus) => ({ asin, estimated_total_item_volume: String(vol), est_sus: String(sus), storage_utilization_ratio: '24.5', storage_utilization_ratio_units: 'weeks', month_of_charge: '2026-09', volume_units: 'cubic feet', currency: 'USD' });
        expect(storageUtilizationFrom([row('A', 10, 1.5), row('B', 30, 4), row('A', 5, 0.5)])).toEqual({
            month: '2026-09', ratio: 24.5, ratioUnits: 'weeks', currency: 'USD', volumeUnits: 'cubic feet',
            totalVolume: 45, estimatedSurcharge: 6, topAsins: [{ asin: 'B', volume: 30 }, { asin: 'A', volume: 15 }]
        });
        expect(storageUtilizationFrom([]).ratio).toBeNull();
    });
});

describe('detectStorageUtilization', () => {
    const su = (over) => ({ storageUtilization: { month: '2026-09', ratio: 24, ratioUnits: 'weeks', volumeUnits: 'cubic feet', totalVolume: 100, estimatedSurcharge: 40, currency: 'USD', topAsins: [{ asin: 'B1', volume: 50 }], ...over } });

    it('raises the surcharge task over 22 weeks, with Amazon\'s estimate', () => {
        const [task] = W3.detectStorageUtilization({ weeklySignals: su() }).tasks;
        expect(task).toMatchObject({ errorType: 'storage_utilization_risk', amount: 40, renderData: { level: 'surcharge' } });
        expect(task.solution).toContain('B1');
    });

    it('warns between 18 and 22 weeks, and says when no surcharge was charged', () => {
        expect(W3.detectStorageUtilization({ weeklySignals: su({ ratio: 19 }) }).tasks[0].renderData.level).toBe('warning');
        expect(W3.detectStorageUtilization({ weeklySignals: su({ estimatedSurcharge: 0 }) }).tasks[0].error).toContain('may be exempt');
    });

    it('stays quiet under 18 weeks or under 25 cubic feet, and makes no verdict without the report', () => {
        expect(W3.detectStorageUtilization({ weeklySignals: su({ ratio: 7.6 }) })).toEqual({ tasks: [], covered: true });
        expect(W3.detectStorageUtilization({ weeklySignals: su({ totalVolume: 20 }) })).toEqual({ tasks: [], covered: true });
        expect(W3.detectStorageUtilization({ weeklySignals: { storageUtilization: null } })).toEqual({ tasks: [], covered: false });
    });
});

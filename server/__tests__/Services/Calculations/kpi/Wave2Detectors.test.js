/**
 * Wave 2 of the tasks-logics.xlsx detectors: trends and coverage.
 */
const W2 = require('../../../../Services/Calculations/kpi/Wave2Detectors.js');

const NOW = new Date('2026-10-24T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 864e5).toISOString();
const day = (n) => daysAgo(n).slice(0, 10);
const products = new Map([['A1', { asin: 'A1', itemName: 'Garlic Press' }]]);

const traffic = (byAsin, over = {}) => ({
    newestDate: day(2), recent14Days: 14, baselineDays: 60, recent7Days: 7, prior28Days: 28, byAsin, ...over
});

describe('detectSalesDrop', () => {
    it('fires when the last 7 days are 30%+ below the prior 28 days\' weekly average', () => {
        const r = W2.detectSalesDrop({ traffic: traffic({ A1: { u7: 20, u28: 160 } }), productsByAsin: products, now: NOW });
        expect(r.covered).toBe(true);
        expect(r.tasks[0]).toMatchObject({ asin: 'A1', errorCategory: 'conversion', errorType: 'sales_drop' });
        expect(r.tasks[0].error).toBe('Sales Drop: Sales of this product fell 50% this week compared with its recent average (20 units in the last 7 days against about 40 a week before).');
    });

    it('needs a baseline of 20+ units a week, and skips drops another task explains', () => {
        expect(W2.detectSalesDrop({ traffic: traffic({ A1: { u7: 1, u28: 70 } }), now: NOW }).tasks).toEqual([]);
        const r = W2.detectSalesDrop({ traffic: traffic({ A1: { u7: 0, u28: 160 } }), skipAsins: new Map([['A1', 'it is out of stock']]), now: NOW });
        expect(r.tasks).toEqual([]);
    });

    it('is not covered on stale or short data', () => {
        expect(W2.detectSalesDrop({ traffic: traffic({}, { newestDate: day(9) }), now: NOW }).covered).toBe(false);
        expect(W2.detectSalesDrop({ traffic: traffic({}, { prior28Days: 10 }), now: NOW }).covered).toBe(false);
        expect(W2.detectSalesDrop({ traffic: null, now: NOW }).covered).toBe(false);
    });
});

describe('detectConversionRateDrop', () => {
    it('fires on a 25%+ relative drop with 200+ recent sessions, naming both rates', () => {
        const r = W2.detectConversionRateDrop({ traffic: traffic({ A1: { rs: 400, ru: 20, bs: 3000, bu: 300 } }), productsByAsin: products, now: NOW });
        expect(r.tasks[0].error).toBe('Conversion Rate Drop: Fewer visitors are buying this product. Conversion fell from 10% to 5% (last 14 days against the 60 days before).');
    });

    it('uses a shorter baseline when that is all the history there is, and says so', () => {
        const r = W2.detectConversionRateDrop({ traffic: traffic({ A1: { rs: 400, ru: 20, bs: 1500, bu: 150 } }, { baselineDays: 30 }), now: NOW });
        expect(r.tasks[0].error).toContain('against the 30 days of history before');
        expect(W2.detectConversionRateDrop({ traffic: traffic({}, { baselineDays: 20 }), now: NOW }).covered).toBe(false);
    });

    it('ignores low-traffic products and small drops', () => {
        expect(W2.detectConversionRateDrop({ traffic: traffic({ A1: { rs: 150, ru: 1, bs: 3000, bu: 300 } }), now: NOW }).tasks).toEqual([]);
        expect(W2.detectConversionRateDrop({ traffic: traffic({ A1: { rs: 400, ru: 32, bs: 3000, bu: 300 } }), now: NOW }).tasks).toEqual([]);
    });
});

describe('detectTrafficDrop', () => {
    it('fires on a 30%+ drop against the baseline daily average', () => {
        const r = W2.detectTrafficDrop({ traffic: traffic({ A1: { rs: 210, bs: 1800 } }), productsByAsin: products, now: NOW });
        expect(r.tasks[0].error).toBe('Traffic Drop: Visits to this product page fell 50% in the last 14 days (about 15 a day against 30 in the 60 days before).');
    });

    it('needs 300+ baseline sessions per 14 days', () => {
        // 1,300 over 60 days = 303 per 14 days; 1,250 = 292.
        expect(W2.detectTrafficDrop({ traffic: traffic({ A1: { rs: 10, bs: 1300 } }), now: NOW }).tasks).toHaveLength(1);
        expect(W2.detectTrafficDrop({ traffic: traffic({ A1: { rs: 10, bs: 1250 } }), now: NOW }).tasks).toEqual([]);
    });
});

describe('detectTacosRising', () => {
    const series = (recentSpend, priorSpend, recentSales, priorSales, days = 30) => {
        const spendByDay = {};
        const salesByDay = {};
        for (let i = 0; i < days; i++) {
            spendByDay[day(2 + i)] = recentSpend / days; salesByDay[day(2 + i)] = recentSales / days;
            spendByDay[day(32 + i)] = priorSpend / days; salesByDay[day(32 + i)] = priorSales / days;
        }
        return { newestDate: day(2), spendByDay, salesByDay };
    };

    it('fires when TACoS rises 3+ points on flat sales, with the extra spend as the amount', () => {
        const r = W2.detectTacosRising({ tacos: series(1300, 1000, 10000, 10000), now: NOW });
        expect(r.tasks[0]).toMatchObject({ asin: 'ACCOUNT', errorType: 'tacos_rising', amount: 300 });
        expect(r.tasks[0].error).toContain('TACoS rose from 10% to 13%');
    });

    it('does not fire when sales grew with the spend, or below $1,000 of sales', () => {
        expect(W2.detectTacosRising({ tacos: series(1300, 1000, 11000, 10000), now: NOW }).tasks).toEqual([]);
        expect(W2.detectTacosRising({ tacos: series(130, 50, 900, 900), now: NOW }).tasks).toEqual([]);
    });

    it('is not covered without enough days in each window', () => {
        expect(W2.detectTacosRising({ tacos: series(1300, 1000, 10000, 10000, 20), now: NOW }).covered).toBe(false);
    });
});

describe('detectTopSellerNotAdvertised', () => {
    const rows = [
        { asin: 'A9', date: day(1), spend: 3 },
        { asin: 'A2', date: day(20), spend: 3 }    // advertised, but not in the last 14 days
    ];
    const run = (over = {}) => W2.detectTopSellerNotAdvertised({
        adsRows: rows, topAsins: new Set(['A1', 'A2', 'A9']), buyable: () => true, country: 'US', productsByAsin: products, now: NOW, ...over
    });

    it('flags top sellers with no ads in the last 14 days', () => {
        expect(run().tasks.map(t => t.asin).sort()).toEqual(['A1', 'A2']);
    });

    it('skips products that cannot be bought', () => {
        expect(run({ buyable: (a) => a !== 'A1' }).tasks.map(t => t.asin)).toEqual(['A2']);
    });

    it('is not covered when ads data does not reach back 14 days, or is stale', () => {
        expect(run({ adsRows: [{ asin: 'A9', date: day(1), spend: 3 }] }).covered).toBe(false);
        expect(run({ adsRows: [{ asin: 'A9', date: day(30), spend: 3 }, { asin: 'A9', date: day(60), spend: 3 }] }).covered).toBe(false);
    });
});

describe('detectRatingDrop / detectLowReviewCount', () => {
    const reviews = (newest, older, at = daysAgo(2)) => ({
        newest: { at, byAsin: newest },
        older: older ? { at: daysAgo(32), byAsin: older } : null
    });

    it('flags a 0.2+ drop on 20+ ratings', () => {
        const r = W2.detectRatingDrop({ reviews: reviews({ A1: { rating: 4.1, count: 80 } }, { A1: { rating: 4.4, count: 70 } }), productsByAsin: products, now: NOW });
        expect(r.tasks[0].error).toBe('Rating Drop: This product\'s rating dropped from 4.4 to 4.1 in the last month (80 ratings).');
    });

    it('ignores small drops and products with few ratings, and needs an older scrape', () => {
        expect(W2.detectRatingDrop({ reviews: reviews({ A1: { rating: 4.3, count: 80 } }, { A1: { rating: 4.4, count: 70 } }), now: NOW }).tasks).toEqual([]);
        expect(W2.detectRatingDrop({ reviews: reviews({ A1: { rating: 3.0, count: 10 } }, { A1: { rating: 4.4, count: 9 } }), now: NOW }).tasks).toEqual([]);
        expect(W2.detectRatingDrop({ reviews: reviews({ A1: { rating: 3, count: 80 } }, null), now: NOW }).covered).toBe(false);
    });

    it('flags active products under 50 reviews, as the existing insufficient_reviews type', () => {
        const r = W2.detectLowReviewCount({
            reviews: reviews({ A1: { rating: 4.5, count: 12 }, A2: { rating: 4.5, count: 60 }, A3: { rating: 4, count: 3 } }),
            activeAsins: new Set(['A1', 'A2']), productsByAsin: products, now: NOW
        });
        expect(r.tasks.map(t => [t.asin, t.errorType])).toEqual([['A1', 'insufficient_reviews']]);
        expect(r.tasks[0].error).toContain('has 12 reviews');
    });

    it('is not covered on a stale scrape', () => {
        expect(W2.detectLowReviewCount({ reviews: reviews({}, null, daysAgo(11)), now: NOW }).covered).toBe(false);
    });
});

describe('detectWeeksOfCover', () => {
    it('flags over 26 weeks and over 200 in stock value, with the excess as capital', () => {
        const r = W2.detectWeeksOfCover({
            restock: { rows: [{ asin: 'A1', available: 280, inbound: 20, unitsSold30: 30, price: 10 }] },
            productsByAsin: products
        });
        // 7 a week -> 300 / 7 = 43 weeks; 12 weeks = 84 units; excess 216 x 10.
        expect(r.tasks[0]).toMatchObject({ asin: 'A1', errorType: 'weeks_of_cover', capitalAmount: 2160 });
        expect(r.tasks[0].error).toContain('about 43 weeks of stock');
    });

    it('sums SKUs per ASIN and skips zero sellers and low-value stock', () => {
        const run = (rows) => W2.detectWeeksOfCover({ restock: { rows } }).tasks;
        expect(run([{ asin: 'A1', available: 300, inbound: 0, unitsSold30: 0, price: 10 }])).toEqual([]);
        expect(run([{ asin: 'A1', available: 30, inbound: 0, unitsSold30: 3, price: 5 }])).toEqual([]);
        expect(run([
            { asin: 'A1', available: 150, inbound: 0, unitsSold30: 15, price: 10 },
            { asin: 'A1', available: 150, inbound: 0, unitsSold30: 15, price: 10 }
        ])).toHaveLength(1);
    });

    it('is not covered without a fresh restock report', () => {
        expect(W2.detectWeeksOfCover({ restock: null }).covered).toBe(false);
    });
});

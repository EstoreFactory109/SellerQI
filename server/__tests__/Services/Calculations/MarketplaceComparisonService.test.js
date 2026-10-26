jest.mock('../../../utils/Logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
jest.mock('../../../config/redisConn.js', () => ({ getRedisClient: () => null }));

const mockCogsFindOne = jest.fn();
jest.mock('../../../models/finance/CogsModel.js', () => ({
    findOne: (...a) => ({ select: () => ({ lean: () => mockCogsFindOne(...a) }) }),
}));

const { toComparisonRow, computeUsdTotals, computeUsdDaily, loadMarketplaceCogs, isWithinLast30Days, mapLimited } = require('../../../Services/Calculations/MarketplaceComparisonService.js');

const snap = (over = {}) => ({
    country: 'UK',
    region: 'EU',
    currencyCode: 'GBP',
    window: { startDate: '2026-09-12', endDate: '2026-10-11' },
    counts: { totalIssues: 6, numberOfProductsWithIssues: 2 },
    health: { Percentage: 50, status: 'At Risk' },
    ppc: { spend: 240, sales: 600, totalSales: 2400, impressions: 15000, clicks: 300, unitsSold: 30 },
    wastedSpend: 6,
    reimbursement: { total: 12.5 },
    finance: { hasFinanceData: true, productSales: 500, grossProfitRaw: 135, cogsCoverage: { productsWithCogs: 3, productsSold: 10 } },
    opportunities: {
        list: [{ title: 'Small', amount: 4 }, { title: 'Big', amount: 40, category: 'Sponsored Ads', issueType: 'wasted' }, { title: 'Count only', amount: 0 }],
        potentialProfitImpact: 60,
    },
    ...over,
});

describe('toComparisonRow', () => {
    test('keeps every figure in the marketplace\'s own currency, with ratios from its own numbers', () => {
        const row = toComparisonRow(snap());
        expect(row.currencyCode).toBe('GBP');
        expect(row.metrics.totalSales).toBe(500);
        expect(row.metrics.grossProfit).toBe(135);
        expect(row.metrics.marginPct).toBeCloseTo(27, 6);
        expect(row.metrics.acos).toBeCloseTo(40, 6);
        expect(row.metrics.tacos).toBeCloseTo(10, 6);
        expect(row.metrics.roas).toBeCloseTo(2.5, 6);
        expect(row.metrics.ctr).toBeCloseTo(2, 6);
        expect(row.metrics.cpc).toBeCloseTo(0.8, 6);
        expect(row.metrics.wastedSpend).toBe(6);
        expect(row.metrics.moneyOwed).toBe(12.5);
        expect(row.metrics.healthPct).toBe(50);
        expect(row.metrics.profitInPlay).toBe(60);
        expect(row.metrics.adSalesSharePct).toBeCloseTo(25, 6);
        expect(row.metrics.productsWithIssues).toBe(2);
        expect(row.metrics.productsCosted).toBe(3);
        expect(row.metrics.productsSold).toBe(10);
    });

    test('a ratio with nothing to divide by is null, not 0', () => {
        const row = toComparisonRow(snap({ ppc: { spend: 0, sales: 0, totalSales: 0, impressions: 0, clicks: 0 } }));
        expect(row.metrics.acos).toBeNull();
        expect(row.metrics.roas).toBeNull();
        expect(row.metrics.ctr).toBeNull();
        expect(row.metrics.cpc).toBeNull();
        expect(row.metrics.tacos).toBeNull();
    });

    test('no finance data: sales, profit and margin are null rather than a misleading 0', () => {
        const row = toComparisonRow(snap({ finance: { hasFinanceData: false } }));
        expect(row.metrics.totalSales).toBeNull();
        expect(row.metrics.grossProfit).toBeNull();
        expect(row.metrics.marginPct).toBeNull();
    });

    test('no health score reads as null, not 0%', () => {
        expect(toComparisonRow(snap({ health: { Percentage: 0, status: 'Data Not Available' } })).metrics.healthPct).toBeNull();
    });

    test('top fix is the largest money-backed opportunity', () => {
        expect(toComparisonRow(snap()).metrics.topFix).toEqual({ title: 'Big', amount: 40, category: 'Sponsored Ads', issueType: 'wasted' });
        expect(toComparisonRow(snap({ opportunities: { list: [{ title: 'x', amount: 0 }] } })).metrics.topFix).toBeNull();
    });

    test('hint is attached only when a usable rate exists, and never changes the figures', () => {
        const withHint = toComparisonRow(snap(), { rate: 1.32, asOf: '2026-10-09', stale: false });
        expect(withHint.hint).toEqual({ rate: 1.32, asOf: '2026-10-09', stale: false });
        expect(withHint.metrics.totalSales).toBe(500);
        expect(toComparisonRow(snap(), null).hint).toBeNull();
        expect(toComparisonRow(snap(), { rate: 0 }).hint).toBeNull();
    });
});

describe('computeUsdTotals', () => {
    const row = (country, currencyCode, sales, profit, hint, extra = {}) => ({
        country, currencyCode, hint,
        metrics: { totalSales: sales, grossProfit: profit, productsCosted: 5, productsSold: 5, ppcSales: 0, adSpend: 0, ...extra },
    });
    const gbp = { rate: 1.32, asOf: '2026-10-09', stale: false };

    test('US as-is plus UK converted at its rate, then added', () => {
        const t = computeUsdTotals([row('US', 'USD', 1000, 450, null), row('UK', 'GBP', 500, 135, gbp)]);
        expect(t.currency).toBe('USD');
        expect(t.totalSales).toBe(1000 + 500 * 1.32);       // 1660
        expect(t.grossProfit).toBe(450 + 135 * 1.32);       // 628.2
        expect(t.included.map((m) => m.country)).toEqual(['US', 'UK']);
        expect(t.included[1]).toMatchObject({ salesLocal: 500, salesUsd: 660, rate: 1.32 });
        expect(t.ratesAsOf).toBe('2026-10-09');
        expect(t.excluded).toEqual([]);
    });

    test('a US-only seller gets exactly the US figures', () => {
        const t = computeUsdTotals([row('US', 'USD', 1000, 450, null)]);
        expect(t.totalSales).toBe(1000);
        expect(t.grossProfit).toBe(450);
        expect(t.marginPct).toBeCloseTo(45, 6);
        expect(t.ratesAsOf).toBeNull();
    });

    test('margin is profit over the summed sales, not an average of margins', () => {
        const t = computeUsdTotals([row('US', 'USD', 1000, 500, null), row('UK', 'GBP', 100, -50, { rate: 1, asOf: 'x' })]);
        // (500 - 50) / (1000 + 100) = 40.9%, not the average of 50% and -50%.
        expect(t.marginPct).toBeCloseTo((450 / 1100) * 100, 6);
    });

    test('a marketplace without a rate is left out of BOTH figures and reported', () => {
        const t = computeUsdTotals([row('US', 'USD', 1000, 450, null), row('UK', 'GBP', 500, 135, null)]);
        expect(t.totalSales).toBe(1000);
        expect(t.grossProfit).toBe(450);
        expect(t.excluded).toEqual([{ country: 'UK', currencyCode: 'GBP', reason: 'fx_unavailable' }]);
    });

    test('a marketplace with no finance data is left out and reported, never counted as zero', () => {
        const t = computeUsdTotals([row('US', 'USD', 1000, 450, null), row('MX', 'MXN', null, null, { rate: 0.05, asOf: 'x' })]);
        expect(t.totalSales).toBe(1000);
        expect(t.excluded).toEqual([{ country: 'MX', currencyCode: 'MXN', reason: 'no_finance_data' }]);
    });

    test('nothing usable gives null figures rather than 0', () => {
        const t = computeUsdTotals([row('UK', 'GBP', 500, 135, null)]);
        expect(t.totalSales).toBeNull();
        expect(t.grossProfit).toBeNull();
        expect(t.marginPct).toBeNull();
    });

    test('flags stale rates and marketplaces whose profit lacks product costs', () => {
        const t = computeUsdTotals([
            row('US', 'USD', 1000, 450, null, { productsCosted: 0, productsSold: 10 }),
            row('UK', 'GBP', 500, 135, { rate: 1.32, asOf: '2026-10-05', stale: true }),
        ]);
        expect(t.anyStaleRate).toBe(true);
        expect(t.costsIncompleteFor).toEqual(['US']);
    });

    test('PPC sales and ad spend are converted and added the same way, with ACoS from the sums', () => {
        const t = computeUsdTotals([
            row('US', 'USD', 1000, 450, null, { ppcSales: 1200, adSpend: 300 }),
            row('UK', 'GBP', 500, 135, gbp, { ppcSales: 600, adSpend: 240 }),
        ]);
        expect(t.ppcSales).toBe(1200 + 600 * 1.32);      // 1992
        expect(t.adSpend).toBe(300 + 240 * 1.32);        // 616.8
        expect(t.acos).toBeCloseTo((616.8 / 1992) * 100, 6);
        expect(t.ads[1]).toMatchObject({ country: 'UK', ppcSalesLocal: 600, adSpendLocal: 240, ppcSalesUsd: 792, adSpendUsd: 316.8 });
        expect(t.adsExcluded).toEqual([]);
    });

    test('ad totals need only a rate: a marketplace with no finance data still counts, one with no rate does not', () => {
        const t = computeUsdTotals([
            row('US', 'USD', 1000, 450, null, { ppcSales: 1200, adSpend: 300 }),
            row('MX', 'MXN', null, null, { rate: 0.05, asOf: 'x' }, { ppcSales: 2000, adSpend: 400 }),
            row('UK', 'GBP', 500, 135, null, { ppcSales: 600, adSpend: 240 }),
        ]);
        expect(t.totalSales).toBe(1000);                  // finance: US only
        expect(t.ppcSales).toBe(1200 + 2000 * 0.05);      // ads: US + MX
        expect(t.adSpend).toBe(300 + 400 * 0.05);
        expect(t.adsExcluded).toEqual([{ country: 'UK', currencyCode: 'GBP', reason: 'fx_unavailable' }]);
        expect(t.excluded.map((e) => e.country)).toEqual(['MX', 'UK']);
    });

    test('no ad sales gives a null ACoS, not 0', () => {
        const t = computeUsdTotals([row('US', 'USD', 1000, 450, null, { ppcSales: 0, adSpend: 0 })]);
        expect(t.ppcSales).toBe(0);
        expect(t.acos).toBeNull();
    });

    test('no rows gives null', () => {
        expect(computeUsdTotals([])).toBeNull();
    });
});

describe('computeUsdDaily', () => {
    const rowOf = (currencyCode, rate) => ({ currencyCode, hint: rate ? { rate } : null });
    const snap = (country, currencyCode, { finance, ppc }) => ({
        country, currencyCode,
        finance: { hasFinanceData: Boolean(finance), daily: finance || [], dailyUnavailable: null },
        ppc: { timeseries: ppc || [] },
    });

    const us = snap('US', 'USD', {
        finance: [{ date: '2026-10-01', sales: 1000, profit: 300 }, { date: '2026-10-02', sales: 500, profit: 100 }],
        ppc: [{ date: '2026-10-01', sales: 400, spend: 100 }, { date: '2026-10-02', sales: 200, spend: 50 }],
    });
    const uk = snap('UK', 'GBP', {
        finance: [{ date: '2026-10-02', sales: 200, profit: 50 }, { date: '2026-10-03', sales: 300, profit: 90 }],
        ppc: [{ date: '2026-10-03', sales: 100, spend: 40 }],
    });

    test('converts each day at its marketplace\'s rate and adds the same days together (union of dates)', () => {
        const { daily } = computeUsdDaily([us, uk], [rowOf('USD'), rowOf('GBP', 1.5)]);
        expect(daily).toEqual([
            { date: '2026-10-01', totalSales: 1000, grossProfit: 300, ppcSales: 400, adSpend: 100 },
            { date: '2026-10-02', totalSales: 500 + 200 * 1.5, grossProfit: 100 + 50 * 1.5, ppcSales: 200, adSpend: 50 },
            { date: '2026-10-03', totalSales: 300 * 1.5, grossProfit: 90 * 1.5, ppcSales: 100 * 1.5, adSpend: 40 * 1.5 },
        ]);
    });

    test('the days add up to the headline totals', () => {
        const snapshots = [us, uk];
        const rows = [
            { country: 'US', currencyCode: 'USD', hint: null, metrics: { totalSales: 1500, grossProfit: 400, ppcSales: 600, adSpend: 150 } },
            { country: 'UK', currencyCode: 'GBP', hint: { rate: 1.5, asOf: 'x' }, metrics: { totalSales: 500, grossProfit: 140, ppcSales: 100, adSpend: 40 } },
        ];
        const totals = computeUsdTotals(rows);
        const { daily } = computeUsdDaily(snapshots, rows);
        const sum = (k) => Math.round(daily.reduce((s, d) => s + d[k], 0) * 100) / 100;
        expect(sum('totalSales')).toBe(totals.totalSales);
        expect(sum('grossProfit')).toBe(totals.grossProfit);
        expect(sum('ppcSales')).toBe(totals.ppcSales);
        expect(sum('adSpend')).toBe(totals.adSpend);
    });

    test('a marketplace with no rate is left out of every series', () => {
        const { daily } = computeUsdDaily([us, uk], [rowOf('USD'), rowOf('GBP', null)]);
        expect(daily.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02']);
        expect(daily[1]).toMatchObject({ totalSales: 500, adSpend: 50 });
    });

    test('a marketplace with no finance data still adds its ads, but not sales or profit', () => {
        const mx = snap('MX', 'MXN', { ppc: [{ date: '2026-10-01', sales: 2000, spend: 400 }] });
        const { daily } = computeUsdDaily([us, mx], [rowOf('USD'), rowOf('MXN', 0.05)]);
        expect(daily[0]).toMatchObject({ totalSales: 1000, ppcSales: 400 + 2000 * 0.05, adSpend: 100 + 400 * 0.05 });
    });

    test('a marketplace whose daily profit is unavailable is reported and left out of sales/profit only', () => {
        const flagged = { ...uk, finance: { ...uk.finance, dailyUnavailable: 'ad_spend_not_daily' } };
        const { daily, dailyExcluded } = computeUsdDaily([us, flagged], [rowOf('USD'), rowOf('GBP', 1.5)]);
        expect(dailyExcluded).toEqual([{ country: 'UK', currencyCode: 'GBP', reason: 'ad_spend_not_daily' }]);
        expect(daily.find((d) => d.date === '2026-10-03')).toMatchObject({ totalSales: 0, grossProfit: 0, ppcSales: 150 });
    });

    test('nothing in gives an empty series', () => {
        expect(computeUsdDaily([], [])).toEqual({ daily: [], dailyExcluded: [] });
    });
});

describe('loadMarketplaceCogs', () => {
    beforeEach(() => mockCogsFindOne.mockReset());

    test('looks up by this marketplace\'s country and currency code only', async () => {
        mockCogsFindOne.mockResolvedValue({ cogsEntries: [{ asin: 'A1', cogs: 4.5 }, { asin: 'A2', sku: 'S', cogs: 0 }] });
        const out = await loadMarketplaceCogs('u1', 'UK');
        expect(mockCogsFindOne).toHaveBeenCalledWith({
            userId: 'u1',
            $or: [{ country: { $in: ['UK', 'GBP'] } }, { countryCode: { $in: ['UK', 'GBP'] } }],
        });
        expect(out.entries).toEqual([{ asin: 'A1', sku: null, cogs: 4.5 }, { asin: 'A2', sku: 'S', cogs: 0 }]);
    });

    test('a marketplace with no costs entered gets none — never another marketplace\'s', async () => {
        mockCogsFindOne.mockResolvedValue(null);
        expect(await loadMarketplaceCogs('u1', 'DE')).toEqual({ entries: [] });
        expect(mockCogsFindOne).toHaveBeenCalledTimes(1);
    });
});

describe('isWithinLast30Days', () => {
    const now = new Date('2026-10-12T00:00:00Z');
    test.each([
        [null, true], ['N/A', true], ['2026-10-01', true], ['2026-08-01', false], ['10/2026', true], ['07/2026', false], ['not a date', true],
    ])('%p → %p', (value, expected) => {
        expect(isWithinLast30Days(value, now)).toBe(expected);
    });
});

describe('mapLimited', () => {
    test('caps concurrency and never rejects', async () => {
        let inFlight = 0;
        let peak = 0;
        const out = await mapLimited([1, 2, 3, 4, 5], 2, async (n) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            if (n === 3) throw new Error('boom');
            return n * 10;
        });
        expect(peak).toBe(2);
        expect(out.map((r) => r.ok)).toEqual([true, true, false, true, true]);
    });
});

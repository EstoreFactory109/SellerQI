/**
 * computeDailyGrossProfit must agree with computeDashboardPieSlices: the daily chart's gross profit
 * adds up to the headline Gross Profit box. Worked by hand below.
 */
const { computeDailyGrossProfit, computeDashboardPieSlices, computeTotalCogsFromAsinWise } = require('../../shared/financeCalculations.js');

// Two days, two ASINs. Fees are negative (as stored); refunds are positive money-out lines.
const skuRows = [
  { date: '2026-10-01', asin: 'A1', units: 10, productSales: 600, fbaFulfillmentFee: -60, referralCommission: -90, refundedAmount: 20, fbaInventoryReimbursement: 5 },
  { date: '2026-10-01', asin: 'A2', units: 5,  productSales: 400, fbaFulfillmentFee: -40, referralCommission: -60 },
  { date: '2026-10-02', asin: 'A1', units: 4,  productSales: 250, fbaFulfillmentFee: -24, referralCommission: -37.5, refundedAmount: 10 },
];
const overheadRows = [
  { date: '2026-10-01', category: 'Storage', isRevenue: false, amount: -30 },
  { date: '2026-10-02', category: 'Storage', isRevenue: false, amount: -10 },
  { date: '2026-10-02', category: 'Disbursement', isRevenue: false, amount: -999 }, // money movement, not a cost
  { date: '2026-10-01', category: 'Seller Reward', isRevenue: true, amount: 50 },
];
const adSpendByDate = { '2026-10-01': 50, '2026-10-02': 20 };
const cogsByAsin = { A1: 20, A2: 30 }; // A2 sold 5 -> 150; A1 sold 10 -> 200, 4 -> 80

test('each day: sales − (fees + refunds + overhead − reimbursements) − ad spend − COGS', () => {
  const out = computeDailyGrossProfit({ skuRows, overheadRows, adSpendByDate, cogsByAsin });
  expect(out.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02']);

  // Day 1: sales 1000; fees 60+90+40+60=250; refunds 20; overhead 30; reimbursements 5;
  //        expenses = 250+20+30-5 = 295; ad 50; COGS 200+150=350 -> 1000-295-50-350 = 305
  expect(out[0]).toEqual({ date: '2026-10-01', sales: 1000, profit: 305 });
  // Day 2: sales 250; fees 24+37.5=61.5; refunds 10; overhead 10; expenses 81.5; ad 20; COGS 80 -> 250-81.5-20-80 = 68.5
  expect(out[1]).toEqual({ date: '2026-10-02', sales: 250, profit: 68.5 });
});

test('the days add up to the headline gross profit and sales', () => {
  const daily = computeDailyGrossProfit({ skuRows, overheadRows, adSpendByDate, cogsByAsin });

  // The headline view of the same window: summed totals, window overhead, total COGS, total ad spend.
  const totals = skuRows.reduce((t, r) => {
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number' && k !== 'units') t[k] = (t[k] || 0) + v;
    return t;
  }, {});
  const byAsin = {};
  for (const r of skuRows) byAsin[r.asin] = (byAsin[r.asin] || 0) + r.units;
  const cogs = computeTotalCogsFromAsinWise(
    Object.entries(byAsin).map(([asin, units]) => ({ asin, units })),
    { entries: Object.entries(cogsByAsin).map(([asin, cogs]) => ({ asin, cogs })) },
  );
  const overheadByCategory = Object.values(overheadRows.reduce((m, r) => {
    const k = `${r.category}|${r.isRevenue}`;
    m[k] = m[k] || { category: r.category, isRevenue: r.isRevenue, amount: 0 };
    m[k].amount += r.amount;
    return m;
  }, {}));
  const headline = computeDashboardPieSlices(totals, overheadByCategory, cogs, 70);

  expect(daily.reduce((s, d) => s + d.profit, 0)).toBeCloseTo(headline.grossProfitRaw, 6);
  expect(daily.reduce((s, d) => s + d.sales, 0)).toBeCloseTo(headline.productSales, 6);
});

test('a day with no ad spend entry, no COGS entry and no overhead is just sales minus fees', () => {
  const out = computeDailyGrossProfit({ skuRows: [{ date: '2026-10-03', asin: 'X', units: 2, productSales: 100, fbaFulfillmentFee: -10 }], overheadRows: [], adSpendByDate: {}, cogsByAsin: {} });
  expect(out).toEqual([{ date: '2026-10-03', sales: 100, profit: 90 }]);
});

test('empty input gives an empty series', () => {
  expect(computeDailyGrossProfit({ skuRows: [], overheadRows: [], adSpendByDate: {}, cogsByAsin: {} })).toEqual([]);
  expect(computeDailyGrossProfit({})).toEqual([]);
});

test('days come back in date order whatever order the rows arrive in', () => {
  const out = computeDailyGrossProfit({
    skuRows: [{ date: '2026-10-05', asin: 'A', units: 1, productSales: 10 }, { date: '2026-10-02', asin: 'A', units: 1, productSales: 20 }],
  });
  expect(out.map((d) => d.date)).toEqual(['2026-10-02', '2026-10-05']);
});

test('a day with ad spend but no sales is a loss day, and the series still adds up to the headline', () => {
  const sku = [{ date: '2026-10-01', asin: 'A', units: 1, productSales: 100, fbaFulfillmentFee: -10 }];
  const ads = { '2026-10-01': 20, '2026-10-02': 15 }; // the 2nd has spend and no sales
  const out = computeDailyGrossProfit({ skuRows: sku, overheadRows: [], adSpendByDate: ads, cogsByAsin: {} });
  expect(out).toEqual([
    { date: '2026-10-01', sales: 100, profit: 70 },
    { date: '2026-10-02', sales: 0, profit: -15 },
  ]);
  const headline = computeDashboardPieSlices({ productSales: 100, fbaFulfillmentFee: -10 }, [], 0, 35);
  expect(out.reduce((s, d) => s + d.profit, 0)).toBeCloseTo(headline.grossProfitRaw, 6);
});

test('overhead posted on a day with no sales also counts', () => {
  const out = computeDailyGrossProfit({ skuRows: [], overheadRows: [{ date: '2026-10-04', category: 'Storage', isRevenue: false, amount: -9 }], adSpendByDate: {}, cogsByAsin: {} });
  expect(out).toEqual([{ date: '2026-10-04', sales: 0, profit: -9 }]);
});

test('a field that changes sign between days still adds up to the headline (window-level signs)', () => {
  // shippingDiscount is a charge on day 1 (+) and a credit on day 2 (-): abs per day would give 30,
  // abs of the window total gives 10. The days must add up to the window figure.
  const sku = [
    { date: '2026-10-01', asin: 'A', units: 1, productSales: 100, shippingDiscount: -20 },
    { date: '2026-10-02', asin: 'A', units: 1, productSales: 100, shippingDiscount: 10 },
  ];
  const daily = computeDailyGrossProfit({ skuRows: sku, overheadRows: [], adSpendByDate: {}, cogsByAsin: {} });
  const headline = computeDashboardPieSlices({ productSales: 200, shippingDiscount: -10 }, [], 0, 0);
  expect(daily.reduce((s, d) => s + d.profit, 0)).toBeCloseTo(headline.grossProfitRaw, 6);
  expect(headline.grossProfitRaw).toBe(190);
});

test('overhead whose category changes sign between days is spread the same way', () => {
  const overhead = [
    { date: '2026-10-01', category: 'Storage', isRevenue: false, amount: -30 },
    { date: '2026-10-02', category: 'Storage', isRevenue: false, amount: 12 },
  ];
  const daily = computeDailyGrossProfit({ skuRows: [], overheadRows: overhead, adSpendByDate: {}, cogsByAsin: {} });
  // Window total for Storage is -18 -> |18| cost, not 30 + 12.
  expect(daily.reduce((s, d) => s + d.profit, 0)).toBeCloseTo(-18, 6);
});

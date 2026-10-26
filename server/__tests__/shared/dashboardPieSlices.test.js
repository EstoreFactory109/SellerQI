/**
 * computeDashboardPieSlices must match TotalSales.jsx's pieMetrics exactly — the combined
 * Dashboard adds these up per marketplace, so any drift shows as a combined total that doesn't
 * equal the single-marketplace Dashboards. The expected numbers below are worked by hand from
 * the TotalSales.jsx formulas.
 */
const { computeDashboardPieSlices } = require('../../shared/financeCalculations.js');

const totals = {
    productSales: 1000,
    fbaFulfillmentFee: -150,
    referralCommission: -120,
    closingFee: -5,
    technologyFee: 0,
    refundedAmount: -40,
    refundCommission: -2,
    refundedReferralFee: 4,
    promotionsDiscount: -10,
    fbaInventoryReimbursement: 12,
    otherExpenses: -8,
    otherExpensesBreakdown: [{ category: 'Misc', amount: -8 }],
    adsSpend: 70,
};
const overhead = [
    { category: 'Storage', isRevenue: false, amount: -30 },
    { category: 'Disbursement', isRevenue: false, amount: -500 }, // money movement, not a cost
    { category: 'Seller Reward', isRevenue: false, amount: 20 },
];

test('matches the TotalSales.jsx formulas', () => {
    const s = computeDashboardPieSlices(totals, overhead, 100, 60);

    expect(s.productSales).toBe(1000);
    expect(s.amazonFees).toBe(275);                 // |-150 -120 -5 + 0|
    expect(s.refundsPromos).toBe(56);               // |-40 + -2 - 4 - 0 - 0 + -10|
    expect(s.uncategorizedAmazonFees).toBe(8);
    expect(s.additionalAmazonFees).toBe(108);       // 8 + COGS 100
    expect(s.overhead).toBe(30);
    expect(s.reimbursements).toBe(12);
    expect(s.ppcSpend).toBe(60);
    // perAsinExpenses = 150+120+5+40+2-4+10+8 = 331; + overhead 30 - reimbursements 12 = 349
    // gross = 1000 - 349 - 60 - 100 = 491
    expect(s.grossProfitRaw).toBe(491);
});

test('no totals: everything is zero', () => {
    const s = computeDashboardPieSlices(null, [], 0, 0);
    expect(s.productSales).toBe(0);
    expect(s.grossProfitRaw).toBe(0);
});

/**
 * Tests for the canonical finance calculation functions.
 *
 * NOTE: jest.config.js sets `roots: ['<rootDir>/__tests__']`, so the runner
 * only discovers tests under server/__tests__/. The implementation under test
 * lives at server/shared/financeCalculations.js; this spec sits here so
 * `npm run test:server` picks it up while still mirroring the repo convention.
 *
 * Numbers below mirror the DB sign convention: productSales positive,
 * Amazon fee fields NEGATIVE (as stored in DailySkuFinance), overhead mixed.
 */

const {
  computeDisplayTotalExpenses,
  computeDisplayProfit,
  computeTotalCogsFromAsinWise,
  computeRowProfit,
} = require('../../shared/financeCalculations.js');

describe('financeCalculations', () => {
  // ── Mock totals: every DailySkuFinance field, fees stored NEGATIVE ──
  const totals = {
    productSales: 10000,
    fbaInventoryReimbursement: 50, // money back → reduces expenses
    units: 200,
    adsSpend: 300,
    // Amazon fees (negative)
    fbaFulfillmentFee: -1000,
    referralCommission: -1500,
    closingFee: -50,
    technologyFee: -20,
    shippingChargeback: -30,
    giftWrapChargeback: -10,
    fbaDisposalFee: -5,
    fbaReversedReimbursement: -15,
    // Refund cost
    refundedAmount: -200,
    refundCommission: -25,
    refundedReferralFee: -40, // SUBTRACTED
    refundedPromotion: -12,   // SUBTRACTED
    restockingFee: -8,        // SUBTRACTED
    // Promotions / discounts
    promotionsDiscount: -100,
    shippingDiscount: -60,
    taxDiscount: -7,
    shippingTaxDiscount: -3,
    tdsDeducted: -90,
    tcsCollected: -45,
    otherExpenses: -33,
  };

  // ── Mock overhead: real expenses + excluded money-movement/revenue cats ──
  const overhead = [
    { category: 'Storage Fees', isRevenue: false, amount: -200 },     // counts → 200
    { category: 'Subscription', isRevenue: false, amount: -39.99 },   // counts → 39.99
    { category: 'Disbursement', isRevenue: false, amount: -5000 },    // excluded (category)
    { category: 'Reimbursement', isRevenue: false, amount: 120 },     // excluded (category)
    { category: 'Seller Reward', isRevenue: true, amount: 80 },       // excluded (isRevenue + category)
    { category: 'Interest Income', isRevenue: true, amount: 500 },    // excluded (isRevenue)
  ];

  describe('computeDisplayTotalExpenses', () => {
    it('mirrors the dashboard field-by-field with realistic signed values', () => {
      // perAsinExpenses:
      //   +1000+1500+50+20+30+10+5+15+200+25  = 2855
      //   -40-12-8                            = -60  → 2795
      //   +100+60+7+3+90+45+33                = +338 → 3133
      // overheadExpenseTotal = 200 + 39.99    = 239.99
      // reimbursements       = 50
      // adSpend              = 300
      // total = 3133 + 239.99 - 50 + 300      = 3622.99
      const result = computeDisplayTotalExpenses(totals, overhead, totals.adsSpend);
      expect(result).toBeCloseTo(3622.99, 2);
    });

    it('excludes revenue and money-movement overhead categories', () => {
      const onlyExcluded = [
        { category: 'Disbursement', isRevenue: false, amount: -9999 },
        { category: 'Interest Income', isRevenue: true, amount: 1234 },
      ];
      // perAsinExpenses(3133) + 0 overhead - 50 reimb + 300 ads = 3383
      const result = computeDisplayTotalExpenses(totals, onlyExcluded, totals.adsSpend);
      expect(result).toBeCloseTo(3383, 2);
    });

    it('defaults missing fields to 0 (no NaN)', () => {
      const result = computeDisplayTotalExpenses({}, [], 0);
      expect(result).toBe(0);
    });
  });

  describe('computeDisplayProfit', () => {
    it('returns sales - expenses - cogs', () => {
      // 10000 - 3622.99 - 900 = 5477.01
      expect(computeDisplayProfit(10000, 3622.99, 900)).toBeCloseTo(5477.01, 2);
    });

    it('handles undefined args as 0', () => {
      expect(computeDisplayProfit(undefined, undefined, undefined)).toBe(0);
    });
  });

  describe('computeTotalCogsFromAsinWise', () => {
    const asinWiseRows = [
      { asin: 'B001', units: 100 },
      { asin: 'B002', units: 50 },
      { asin: 'B003', units: 20 }, // no cogs entry → 0 contribution
    ];
    const cogsData = {
      entries: [
        { asin: 'B001', sku: 'S1', cogs: 5 }, // 5 * 100 = 500
        { asin: 'B002', sku: 'S2', cogs: 8 }, // 8 * 50  = 400
        { asin: 'BXXX', sku: 'SX', cogs: 99 }, // no matching row → 0
      ],
    };

    it('sums per-unit cogs * units across matching rows', () => {
      expect(computeTotalCogsFromAsinWise(asinWiseRows, cogsData)).toBeCloseTo(900, 2);
    });

    it('returns 0 with no cogs data', () => {
      expect(computeTotalCogsFromAsinWise(asinWiseRows, { entries: [] })).toBe(0);
      expect(computeTotalCogsFromAsinWise(asinWiseRows, undefined)).toBe(0);
    });

    it('supports unitsSold alias', () => {
      const rows = [{ asin: 'B001', unitsSold: 10 }];
      expect(computeTotalCogsFromAsinWise(rows, cogsData)).toBeCloseTo(50, 2);
    });
  });

  describe('computeRowProfit', () => {
    it('computes a single ASIN P&L with the shared field formula', () => {
      const row = {
        asin: 'B001',
        productSales: 4000,
        units: 100,
        fbaFulfillmentFee: -500,
        referralCommission: -600,
        refundedReferralFee: -20, // SUBTRACTED
        fbaInventoryReimbursement: 10, // reduces expenses
      };
      // perAsinExpenses = 500 + 600 - 20 = 1080
      // totalExpenses   = 1080 - 10 reimb + 120 ads = 1190
      // cogs            = 5 * 100 = 500
      // grossProfit     = 4000 - 1190 - 500 = 2310
      // profitMargin    = 2310 / 4000 * 100 = 57.75
      const r = computeRowProfit(row, 5, 120);
      expect(r.productSales).toBeCloseTo(4000, 2);
      expect(r.totalExpenses).toBeCloseTo(1190, 2);
      expect(r.cogs).toBeCloseTo(500, 2);
      expect(r.adSpend).toBeCloseTo(120, 2);
      expect(r.grossProfit).toBeCloseTo(2310, 2);
      expect(r.profitMargin).toBeCloseTo(57.75, 2);
    });

    it('handles a row with no sales (margin 0, no NaN)', () => {
      const r = computeRowProfit({ asin: 'B009', units: 0 }, 0, 0);
      expect(r.productSales).toBe(0);
      expect(r.cogs).toBe(0);
      expect(r.profitMargin).toBe(0);
      expect(Number.isNaN(r.grossProfit)).toBe(false);
    });
  });
});

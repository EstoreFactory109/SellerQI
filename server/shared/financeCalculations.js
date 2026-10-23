/**
 * Canonical finance calculation functions.
 *
 * These are THE single source of truth for finance math. Both the dashboard
 * API path and QMate must use these so their numbers can never drift apart.
 *
 * The formulas here mirror, field-by-field, sign-by-sign, the calculation in
 * `client/src/Pages/Dashboard/ProfitibilityDashboard.jsx` (the `perAsinExpenses`
 * / `overheadExpenseTotal` / `displayTotalExpenses` / `displayProfit` block,
 * ~lines 345-466). If the dashboard changes a field, this file must change too.
 *
 * Pure math only: ZERO dependencies, no AI/QMate imports, no DB access.
 * Every numeric field is defaulted with `|| 0` to avoid NaN.
 *
 * Data shapes (from server/Services/Finance/FinanceDashboardReadService.js):
 *   - totals  : object from getTotals() — a $group/$sum over DailySkuFinance
 *               NUMERIC_FIELDS, so every fee field is present directly, plus
 *               adsSpend/adsSpendSP/adsSpendSD, units, productSales.
 *   - overhead: array from getOverhead().items — each item is
 *               { category, isRevenue, amount, count }.
 *   - asinWise: array from getAsinWisePL() — each row carries every
 *               NUMERIC_FIELD plus asin, sku, productName, units, adsSpend.
 *
 * NOTE on signs: DailySkuFinance fee fields are stored as NEGATIVE numbers
 * (see DailySkuFinanceModel.js "Amazon Fees (negative values)"), which is why
 * every term uses Math.abs().
 */

/**
 * Overhead categories that are NOT real expenses (money movements, reserves,
 * reimbursements). Excluded from `overheadExpenseTotal`.
 * Mirrors `OVERHEAD_EXCLUDE` in ProfitibilityDashboard.jsx (~line 369).
 */
const REVENUE_OVERHEAD_CATEGORIES = new Set([
  'Disbursement',
  'Reserve Hold',
  'Reserve Release',
  'Seller Reward',
  'Reimbursement',
  'SAFE-T Reimbursement',
  'SERRAC Reimbursement',
  'EBT Refund Reimbursement',
  'Fulfillment Fee Refund',
]);

/**
 * The fields behind the per-ASIN expense total, with the sign each one carries in it
 * (+1 adds to expenses, -1 reduces them). One list drives both the headline calculation
 * (_perAsinExpenses) and the day-by-day one, so they cannot drift apart. Order and signs mirror
 * ProfitibilityDashboard.jsx perAsinExpenses exactly.
 */
const PER_ASIN_EXPENSE_TERMS = [
  ['fbaFulfillmentFee', 1], ['referralCommission', 1], ['closingFee', 1], ['technologyFee', 1],
  ['shippingChargeback', 1], ['giftWrapChargeback', 1], ['fbaDisposalFee', 1], ['fbaReversedReimbursement', 1],
  ['refundedAmount', 1], ['refundCommission', 1],
  ['refundedReferralFee', -1], ['refundedPromotion', -1], ['restockingFee', -1],
  ['promotionsDiscount', 1], ['shippingDiscount', 1], ['taxDiscount', 1], ['shippingTaxDiscount', 1],
  ['tdsDeducted', 1], ['tcsCollected', 1], ['otherExpenses', 1],
];

/**
 * Per-ASIN (Amazon SKU-level) expense sum — the shared kernel used by both
 * `computeDisplayTotalExpenses` (account totals) and `computeRowProfit`
 * (single ASIN row). Keeping the field list in ONE place guarantees the
 * account-level and row-level numbers use identical math.
 *
 * Field order and signs mirror ProfitibilityDashboard.jsx perAsinExpenses
 * (~lines 346-365) exactly.
 *
 * @param {Object} t - totals or a single asinWise row (same field names)
 * @returns {number} sum of per-ASIN Amazon fees/refund costs/discounts
 */
function _perAsinExpenses(t) {
  if (!t) return 0;
  return PER_ASIN_EXPENSE_TERMS.reduce((sum, [field, sign]) => sum + sign * Math.abs(t[field] || 0), 0);
}

/**
 * THE canonical account-level expense calculation.
 * Mirrors ProfitibilityDashboard.jsx `displayTotalExpenses` (~line 391):
 *   perAsinExpenses + overheadExpenseTotal - reimbursements + adSpend
 *
 * @param {Object} totals  - getTotals() result (DailySkuFinance $group shape)
 * @param {Array}  overhead - getOverhead().items array of { category, isRevenue, amount }
 * @param {number} adSpend  - PPC spend (totals.adsSpend)
 * @returns {number} total expenses exactly as the dashboard shows
 */
function computeDisplayTotalExpenses(totals, overhead, adSpend) {
  const abs = Math.abs;

  const perAsinExpenses = _perAsinExpenses(totals);

  // Overhead = real account costs only (exclude revenue + money-movement cats).
  // Mirrors ProfitibilityDashboard.jsx overheadExpenseTotal (~line 376).
  const overheadExpenseTotal = (overhead || [])
    .filter((item) => !item.isRevenue && !REVENUE_OVERHEAD_CATEGORIES.has(item.category))
    .reduce((sum, item) => sum + abs(item.amount || 0), 0);

  // Reimbursements are money back → reduce net expenses (~line 381).
  const reimbursements = abs((totals && totals.fbaInventoryReimbursement) || 0);

  return perAsinExpenses + overheadExpenseTotal - reimbursements + abs(adSpend || 0);
}

/**
 * THE canonical profit calculation.
 * Mirrors ProfitibilityDashboard.jsx `displayProfit` (~line 465):
 *   totalSales - displayTotalExpenses - totalCogs
 *
 * @param {number} totalSales          - totals.productSales
 * @param {number} displayTotalExpenses - result of computeDisplayTotalExpenses
 * @param {number} totalCogs           - result of computeTotalCogsFromAsinWise
 * @returns {number} profit exactly as the dashboard shows
 */
function computeDisplayProfit(totalSales, displayTotalExpenses, totalCogs) {
  return (totalSales || 0) - (displayTotalExpenses || 0) - (totalCogs || 0);
}

/**
 * Total COGS across ASIN rows: per-unit COGS(asin) × units sold.
 * Mirrors client/src/utils/cogsCalculations.js computeTotalCogs(), adapted to
 * the server-side COGS shape `{ entries: [{ asin, sku, cogs }] }`.
 *
 * @param {Array}  asinWiseRows - getAsinWisePL() rows (need asin + units)
 * @param {Object} cogsData     - { entries: [{ asin, sku, cogs }] } (cogs = per unit)
 * @returns {number} total cost of goods sold
 */
function computeTotalCogsFromAsinWise(asinWiseRows, cogsData) {
  if (!Array.isArray(asinWiseRows)) return 0;

  // Build asin → per-unit cogs map from entries.
  const cogsMap = {};
  const entries = (cogsData && Array.isArray(cogsData.entries)) ? cogsData.entries : [];
  for (const e of entries) {
    if (!e || !e.asin) continue;
    cogsMap[e.asin] = Number(e.cogs || 0);
  }

  let total = 0;
  for (const row of asinWiseRows) {
    const asin = row && row.asin;
    if (!asin) continue;
    const perUnit = Number(cogsMap[asin] || 0);
    if (perUnit <= 0) continue;
    const units = Number((row.units != null ? row.units : row.unitsSold) || 0);
    if (units <= 0) continue;
    total += perUnit * units;
  }
  return total;
}

/**
 * Single-ASIN P&L. Uses the same per-ASIN expense kernel as the account-level
 * calculation (no overhead at row scope — overhead is account-wide, not
 * per-ASIN). Reimbursements and ad spend are applied per row.
 *
 * @param {Object} asinRow     - one getAsinWisePL() row (carries all fee fields)
 * @param {number} cogsPerUnit - per-unit COGS for this ASIN
 * @param {number} rowAdSpend  - PPC spend attributed to this ASIN (row.adsSpend)
 * @returns {{ productSales:number, totalExpenses:number, cogs:number, adSpend:number, grossProfit:number, profitMargin:number }}
 */
function computeRowProfit(asinRow, cogsPerUnit, rowAdSpend) {
  const abs = Math.abs;
  const row = asinRow || {};

  const productSales = Number(row.productSales || 0);
  const perAsinExpenses = _perAsinExpenses(row);
  const reimbursements = abs(row.fbaInventoryReimbursement || 0);
  const adSpend = abs(rowAdSpend || 0);

  const totalExpenses = perAsinExpenses - reimbursements + adSpend;

  const units = Number((row.units != null ? row.units : row.unitsSold) || 0);
  const perUnit = Number(cogsPerUnit || 0);
  const cogs = perUnit > 0 && units > 0 ? perUnit * units : 0;

  const grossProfit = productSales - totalExpenses - cogs;
  const profitMargin = productSales > 0 ? (grossProfit / productSales) * 100 : 0;

  return { productSales, totalExpenses, cogs, adSpend, grossProfit, profitMargin };
}

/**
 * The Dashboard's "Where your money goes" figures for one marketplace.
 *
 * A field-by-field port of the pieMetrics block in
 * client/src/Components/Dashboard/SamePageComponents/TotalSales.jsx (~lines 170-260), so the
 * combined (all-marketplaces) Dashboard can build the same slices on the server for each
 * marketplace and add them up after currency conversion. If TotalSales.jsx changes a field,
 * this must change too (financeCalculations.test.js pins the two together on fixed numbers).
 *
 * @param {Object} totals    - getTotals() result
 * @param {Array}  overhead  - getOverhead().items
 * @param {number} totalCogs - computeTotalCogsFromAsinWise() result
 * @param {number} ppcSpend  - ad spend for the window (PPCMetrics, else totals.adsSpend)
 * @returns {{productSales:number, amazonFees:number, refundsPromos:number, uncategorizedAmazonFees:number,
 *            totalCogs:number, additionalAmazonFees:number, overhead:number, reimbursements:number,
 *            ppcSpend:number, grossProfitRaw:number}}
 */
function computeDashboardPieSlices(totals, overhead, totalCogs, ppcSpend) {
  const abs = Math.abs;
  const t = totals || null;

  const productSales = t && t.productSales != null ? Number(t.productSales) : 0;
  const reimbursements = t ? abs(t.fbaInventoryReimbursement || 0) : 0;

  const amazonFees = t ? abs(
    (t.fbaFulfillmentFee || 0) +
    (t.referralCommission || 0) +
    (t.closingFee || 0) +
    (t.technologyFee || 0) +
    (t.shippingChargeback || 0) +
    (t.giftWrapChargeback || 0) +
    (t.fbaDisposalFee || 0) +
    (t.fbaReversedReimbursement || 0)
  ) : 0;

  const refundsPromos = t ? abs(
    (t.refundedAmount || 0) +
    (t.refundCommission || 0) -
    abs(t.refundedReferralFee || 0) -
    abs(t.refundedPromotion || 0) -
    abs(t.restockingFee || 0) +
    (t.promotionsDiscount || 0) +
    (t.shippingDiscount || 0)
  ) : 0;

  const breakdown = ((t && t.otherExpensesBreakdown) || []).filter((item) => abs((item && item.amount) || 0) > 0.01);
  const uncategorizedAmazonFees = breakdown.length > 0
    ? breakdown.reduce((sum, item) => sum + abs(item.amount), 0)
    : abs((t && t.otherExpenses) || 0);

  const cogs = Number(totalCogs || 0);
  const overheadTotal = (overhead || [])
    .filter((item) => item && !item.isRevenue && !REVENUE_OVERHEAD_CATEGORIES.has(item.category))
    .reduce((sum, item) => sum + abs(item.amount || 0), 0);

  const spend = abs(ppcSpend || 0);
  const grossProfitRaw = computeDisplayProfit(productSales, computeDisplayTotalExpenses(t, overhead, spend), cogs);

  return {
    productSales,
    amazonFees,
    refundsPromos,
    uncategorizedAmazonFees,
    totalCogs: cogs,
    additionalAmazonFees: uncategorizedAmazonFees + cogs,
    overhead: overheadTotal,
    reimbursements,
    ppcSpend: spend,
    grossProfitRaw,
  };
}

/**
 * Gross profit for each day of a window, for ONE marketplace, in its own currency.
 *
 * The same arithmetic as computeDashboardPieSlices — sales − (per-ASIN expenses + overhead −
 * reimbursements) − ad spend − COGS — spread over the days, so the series adds up to the headline
 * Gross Profit EXACTLY.
 *
 * Why not just run the formula on each day: expenses take abs() of each field, and the headline does
 * that once on the window total. A field whose sign changes between days (a shipping discount that is
 * a charge one day and a credit the next) would give abs(day) values that add up to MORE than
 * abs(window) — on a real account that was a $19 gap. So each field's sign is taken from the whole
 * window, and a day contributes sign(window) × its own amount. Those add up to abs(window total).
 * Overhead is spread the same way, per category.
 *
 * @param {Object}   p
 * @param {Array}    p.skuRows        DailySkuFinance summed per {date, asin}: { date, asin, units, productSales, ...fee fields }
 * @param {Array}    p.overheadRows   DailyOverheadFinance rows: { date, category, isRevenue, amount }
 * @param {Object}   p.adSpendByDate  { 'YYYY-MM-DD': spend } — PPC spend per day
 * @param {Object}   p.cogsByAsin     { asin: per-unit cost } (only entered costs)
 * @returns {Array<{date:string, sales:number, profit:number}>} ascending by date
 */
function computeDailyGrossProfit({ skuRows, overheadRows, adSpendByDate, cogsByAsin }) {
  const abs = Math.abs;
  const sign = (n) => (n < 0 ? -1 : 1);
  const days = new Map();
  const day = (date) => {
    if (!days.has(date)) days.set(date, { totals: {}, cogs: 0, overheadByCategory: {} });
    return days.get(date);
  };

  const windowTotals = {};
  for (const row of skuRows || []) {
    if (!row || !row.date) continue;
    const d = day(row.date);
    for (const [key, value] of Object.entries(row)) {
      if (key === 'date' || key === 'asin' || typeof value !== 'number') continue;
      d.totals[key] = (d.totals[key] || 0) + value;
      windowTotals[key] = (windowTotals[key] || 0) + value;
    }
    const perUnit = Number((cogsByAsin && cogsByAsin[row.asin]) || 0);
    const units = Number(row.units || 0);
    if (perUnit > 0 && units > 0) d.cogs += perUnit * units;
  }

  const windowOverhead = {};
  for (const row of overheadRows || []) {
    if (!row || !row.date || row.isRevenue || REVENUE_OVERHEAD_CATEGORIES.has(row.category)) continue;
    const amount = Number(row.amount || 0);
    day(row.date).overheadByCategory[row.category] = (day(row.date).overheadByCategory[row.category] || 0) + amount;
    windowOverhead[row.category] = (windowOverhead[row.category] || 0) + amount;
  }

  // A day can have costs and no sales at all (ads kept running, a storage fee posted). Those days
  // still belong in the series — the headline subtracts that spend — as a loss.
  for (const [date, spend] of Object.entries(adSpendByDate || {})) {
    if (abs(spend || 0) > 0) day(date);
  }

  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, d]) => {
      const sales = Number(d.totals.productSales || 0);
      let expenses = PER_ASIN_EXPENSE_TERMS.reduce(
        (sum, [field, termSign]) => sum + termSign * sign(windowTotals[field] || 0) * (d.totals[field] || 0), 0);
      expenses -= sign(windowTotals.fbaInventoryReimbursement || 0) * (d.totals.fbaInventoryReimbursement || 0);
      for (const [category, amount] of Object.entries(d.overheadByCategory)) {
        expenses += sign(windowOverhead[category] || 0) * amount;
      }
      const adSpend = abs((adSpendByDate && adSpendByDate[date]) || 0);
      return { date, sales, profit: computeDisplayProfit(sales, expenses + adSpend, d.cogs) };
    });
}

module.exports = {
  _perAsinExpenses,
  computeDailyGrossProfit,
  computeDashboardPieSlices,
  REVENUE_OVERHEAD_CATEGORIES,
  computeDisplayTotalExpenses,
  computeDisplayProfit,
  computeTotalCogsFromAsinWise,
  computeRowProfit,
};

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
  const abs = Math.abs;
  if (!t) return 0;
  return (
    abs(t.fbaFulfillmentFee || 0) +
    abs(t.referralCommission || 0) +
    abs(t.closingFee || 0) +
    abs(t.technologyFee || 0) +
    abs(t.shippingChargeback || 0) +
    abs(t.giftWrapChargeback || 0) +
    abs(t.fbaDisposalFee || 0) +
    abs(t.fbaReversedReimbursement || 0) +
    abs(t.refundedAmount || 0) +
    abs(t.refundCommission || 0) -
    abs(t.refundedReferralFee || 0) -
    abs(t.refundedPromotion || 0) -
    abs(t.restockingFee || 0) +
    abs(t.promotionsDiscount || 0) +
    abs(t.shippingDiscount || 0) +
    abs(t.taxDiscount || 0) +
    abs(t.shippingTaxDiscount || 0) +
    abs(t.tdsDeducted || 0) +
    abs(t.tcsCollected || 0) +
    abs(t.otherExpenses || 0)
  );
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

module.exports = {
  REVENUE_OVERHEAD_CATEGORIES,
  computeDisplayTotalExpenses,
  computeDisplayProfit,
  computeTotalCogsFromAsinWise,
  computeRowProfit,
};

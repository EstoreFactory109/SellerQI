/**
 * Whether a /api/finance-dashboard response actually holds finance data.
 *
 * The server returns `totals: null` and `metadata.hasFinanceData: false` when
 * the account has no DailySkuFinance rows for the range. Older servers return
 * zero-filled totals with `metadata.totalDays: 0` instead, so both shapes mean
 * "no data" — which the UI shows as not available, never as $0.00.
 * A response with real rows whose amounts are 0 still counts as data.
 *
 * @param {object|null|undefined} totals - `data.totals` from the response
 * @param {object|null|undefined} metadata - `data.metadata` from the response
 * @returns {boolean}
 */
export function hasFinanceDashboardData(totals, metadata) {
  if (totals == null) return false;
  if (metadata?.hasFinanceData === false) return false;
  if (metadata?.totalDays === 0) return false;
  return true;
}

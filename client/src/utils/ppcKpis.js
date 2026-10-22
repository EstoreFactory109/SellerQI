import { NOT_AVAILABLE, isMissingNumber } from './currencyUtils.js';

/**
 * TACoS (ad spend as % of total sales).
 *
 * Prefers the backend's value. Otherwise derives it from total sales — and
 * returns null (not available) when total sales are unknown or not positive,
 * because there is nothing to divide by: never 0% or Infinity.
 *
 * @param {object} args
 * @param {number|null|undefined} args.backendTacos - value from /api/pagewise/ppc/summary, if any
 * @param {number} args.spend - ad spend for the window
 * @param {number|null|undefined} args.totalSales - all-channel sales for the window (null = no data)
 * @returns {number|null}
 */
export function computeTacos({ backendTacos, spend, totalSales }) {
  if (!isMissingNumber(backendTacos)) {
    const v = Number(backendTacos);
    return Number.isFinite(v) ? v : null;
  }
  if (isMissingNumber(totalSales) || !(Number(totalSales) > 0)) return null;
  return (Number(spend || 0) / Number(totalSales)) * 100;
}

/** `12.34%`, or '—' when the percentage is not available. */
export const formatPercentOrNA = (value, decimals = 2) =>
  isMissingNumber(value) || !Number.isFinite(Number(value))
    ? NOT_AVAILABLE
    : `${Number(value).toFixed(decimals)}%`;

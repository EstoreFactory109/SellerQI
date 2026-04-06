/**
 * True when Redux has both bounds — use /date-range and total-sales filter with periodType=custom
 * so expenses, profitability, and sales match the calendar (not rolling ?period= from server).
 */
export function shouldUseCalendarDateRange(startDate, endDate) {
  return Boolean(startDate && endDate);
}

/**
 * Builds GET /api/total-sales/filter URL aligned with calendar Redux state.
 * When startDate + endDate exist (last7, last14, custom, or default after dashboard load),
 * use periodType=custom so the backend sums SalesOnlyMetrics datewise rows for that exact range.
 * Otherwise fall back to last30 (first paint before dates exist).
 */
export function buildTotalSalesFilterUrl(baseUri, { startDate, endDate }) {
  const root = `${String(baseUri || '').replace(/\/$/, '')}/api/total-sales/filter`;
  if (startDate && endDate) {
    return `${root}?periodType=custom&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  }
  return `${root}?periodType=last30`;
}

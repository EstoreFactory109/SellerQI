/**
 * True when Redux has both start and end dates (from DataFetchTracking or calendar selection).
 * Includes default mode — default uses the tracking window, not rolling last30.
 */
export function shouldUseCalendarDateRange(startDate, endDate) {
  return Boolean(startDate && endDate);
}

/**
 * Builds GET /api/total-sales/filter with periodType=custom for the exact date window.
 * Caller must pass resolved startDate/endDate (see profitabilityDateRange.js).
 */
export function buildTotalSalesFilterUrl(baseUri, { startDate, endDate }) {
  const root = `${String(baseUri || '').replace(/\/$/, '')}/api/total-sales/filter`;
  if (!shouldUseCalendarDateRange(startDate, endDate)) {
    return null;
  }
  return `${root}?periodType=custom&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
}

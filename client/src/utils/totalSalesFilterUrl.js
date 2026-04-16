/**
 * True when Redux has both bounds AND the user selected a non-default calendar mode.
 * "default" represents the first-load Last 30 Days dataset and should use default endpoints.
 */
export function shouldUseCalendarDateRange(startDate, endDate, calendarMode) {
  const hasBounds = Boolean(startDate && endDate);
  // Backward compatibility: old callsites pass only start/end.
  if (calendarMode === undefined || calendarMode === null) {
    return hasBounds;
  }
  const isDefaultMode = calendarMode === 'default';
  return hasBounds && !isDefaultMode;
}

/**
 * Builds GET /api/total-sales/filter URL aligned with calendar Redux state.
 * When startDate + endDate exist (last7, last14, custom, or default after dashboard load),
 * use periodType=custom so the backend sums SalesOnlyMetrics datewise rows for that exact range.
 * Otherwise fall back to last30 (first paint before dates exist).
 */
export function buildTotalSalesFilterUrl(baseUri, { startDate, endDate, calendarMode }) {
  const root = `${String(baseUri || '').replace(/\/$/, '')}/api/total-sales/filter`;
  if (shouldUseCalendarDateRange(startDate, endDate, calendarMode)) {
    return `${root}?periodType=custom&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  }
  return `${root}?periodType=last30`;
}

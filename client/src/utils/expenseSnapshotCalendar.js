/** `date` on snapshot rows is YYYY-MM-DD (dateKey from ExpenseDateAgg / ExpenseAmazonFeeDateAgg). */
export function sumSnapshotDateWiseInRange(dateWiseRows, startDateStr, endDateStr) {
  if (!Array.isArray(dateWiseRows) || !startDateStr || !endDateStr) return 0;
  let sum = 0;
  for (const row of dateWiseRows) {
    const key = row?.date;
    if (!key || key === 'Unknown') continue;
    if (key >= startDateStr && key <= endDateStr) {
      sum += Number(row.totalAmount) || 0;
    }
  }
  return sum;
}

/**
 * Pre-calculated fees from GET /api/expenses/snapshot (ExpenseReportRun + aggs).
 * - last7 / last14: stored rolling buckets from analyzeExpenses
 * - custom + start/end: sum dateWiseAmazonFees & dateWiseExpenses in range (stored DB series)
 * - default (and other non-custom): full run totals
 */
export function pickSnapshotFeeTotalsForCalendar(snapshot, calendarMode, startDateStr, endDateStr) {
  if (!snapshot) return null;
  if (calendarMode === 'last7') {
    return {
      amazonFees: Number(snapshot.totalAmazonFeesLast7Days?.total ?? 0),
      totalExpenses: Number(snapshot.totalExpensesLast7Days?.total ?? 0),
    };
  }
  if (calendarMode === 'last14') {
    return {
      amazonFees: Number(snapshot.totalAmazonFeesLast14Days?.total ?? 0),
      totalExpenses: Number(snapshot.totalExpensesLast14Days?.total ?? 0),
    };
  }
  if (calendarMode === 'custom' && startDateStr && endDateStr) {
    return {
      amazonFees: sumSnapshotDateWiseInRange(snapshot.dateWiseAmazonFees, startDateStr, endDateStr),
      totalExpenses: sumSnapshotDateWiseInRange(snapshot.dateWiseExpenses, startDateStr, endDateStr),
    };
  }
  return {
    amazonFees: Number(snapshot.totalAmazonFees?.total ?? 0),
    totalExpenses: Number(snapshot.totalExpenses?.total ?? 0),
  };
}

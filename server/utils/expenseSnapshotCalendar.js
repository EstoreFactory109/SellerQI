/**
 * Mirrors client/src/utils/expenseSnapshotCalendar.js so server code can pick the same
 * totalExpenses / amazonFees as GET /api/expenses/snapshot + dashboard calendar mode.
 */

function sumSnapshotDateWiseInRange(dateWiseRows, startDateStr, endDateStr) {
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
 * @param {object|null} snapshot — payload from buildExpenseReportResponseFromDB
 * @param {string} calendarMode — default | last7 | last14 | custom | ...
 * @param {string|null} startDateStr
 * @param {string|null} endDateStr
 */
function pickSnapshotFeeTotalsForCalendar(snapshot, calendarMode, startDateStr, endDateStr) {
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

module.exports = {
    sumSnapshotDateWiseInRange,
    pickSnapshotFeeTotalsForCalendar,
};

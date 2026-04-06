/**
 * Default window for Finance API expense fetch: (yesterday - N days) → yesterday.
 * Override with env EXPENSE_FINANCE_DAYS_BACK (integer 1–3650). Unset or invalid → 30.
 */

const FALLBACK_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 3650;

function getDefaultExpenseFinanceDaysBack() {
  const raw = process.env.EXPENSE_FINANCE_DAYS_BACK;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return FALLBACK_DAYS;
  }
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n < MIN_DAYS || n > MAX_DAYS) {
    return FALLBACK_DAYS;
  }
  return n;
}

module.exports = {
  getDefaultExpenseFinanceDaysBack,
  FALLBACK_DAYS,
  MIN_DAYS,
  MAX_DAYS,
};

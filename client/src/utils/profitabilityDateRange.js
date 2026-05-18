import { parseLocalDate } from './dateUtils.js';

function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeYmd(value) {
  if (!value) return null;
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

/**
 * Resolve start/end for profitability API calls.
 * - default: dataFetchTracking range in Redux (startDate/endDate from phase 1)
 * - last7 / last14: N days ending at tracking endDate (Redux endDate anchor)
 * - custom: explicit Redux start/end
 */
export function resolveProfitabilityQueryDates({ calendarMode = 'default', startDate, endDate }) {
  const anchorEnd = normalizeYmd(endDate);
  if (!anchorEnd) {
    return { startDate: null, endDate: null, ready: false };
  }

  const endD = parseLocalDate(anchorEnd);

  if (calendarMode === 'last7') {
    const startD = new Date(endD);
    startD.setDate(endD.getDate() - 6);
    return { startDate: toYmd(startD), endDate: anchorEnd, ready: true };
  }

  if (calendarMode === 'last14') {
    const startD = new Date(endD);
    startD.setDate(endD.getDate() - 13);
    return { startDate: toYmd(startD), endDate: anchorEnd, ready: true };
  }

  const anchorStart = normalizeYmd(startDate);
  if (!anchorStart) {
    return { startDate: null, endDate: null, ready: false };
  }

  return { startDate: anchorStart, endDate: anchorEnd, ready: true };
}

/** Inclusive YYYY-MM-DD range check (string compare is safe for ISO dates). */
export function isYmdInRange(ymd, startDate, endDate) {
  const d = normalizeYmd(ymd);
  if (!d || !startDate || !endDate) return false;
  return d >= startDate && d <= endDate;
}

/** Every calendar day from startDate through endDate (inclusive). */
export function enumerateDatesInRange(startDate, endDate) {
  const start = normalizeYmd(startDate);
  const end = normalizeYmd(endDate);
  if (!start || !end) return [];

  const dates = [];
  const cur = parseLocalDate(start);
  const endD = parseLocalDate(end);
  while (cur <= endD) {
    dates.push(toYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

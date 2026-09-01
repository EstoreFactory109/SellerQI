/**
 * Utility functions for date handling
 */

/**
 * Format an instant as an absolute UTC timestamp: "18/08/2026, 22:02:01 UTC".
 *
 * WHY THIS LIVES HERE. This exact formatter was hand-copied into three pages
 * (Tools/UserLogging, Admin/UserLogDetails, DemoSellerCentralChecker/DemoUserLogging). When the
 * pipeline-progress widget was added it used a RELATIVE label ("started 13h ago") instead, so the
 * same instant was shown two different ways side by side on one page and read as though the two
 * disagreed — they never did; measured across 60 production runs the underlying timestamps differ by
 * at most ~1 second. Sharing one formatter is what stops that recurring.
 *
 * Deliberately UTC, not local: these are server-side pipeline events, and operators comparing them
 * against logs or database queries need the server's clock, not the browser's.
 *
 * @param {string|Date} value
 * @returns {string} formatted timestamp, or 'N/A' when there is nothing to show
 */
export const formatUtcTimestamp = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}, ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
};

/**
 * Compact "how long ago" label, e.g. "3m ago", "2h 14m ago".
 *
 * Meant to ACCOMPANY formatUtcTimestamp, not replace it: the absolute time is what can be compared
 * against other rows and against logs, while this answers "is this recent?" at a glance.
 *
 * @param {string|Date} value
 * @returns {string|null} null when there is nothing to show
 */
export const formatTimeAgo = (value) => {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m ago` : `${h}h ago`;
};

/**
 * Parse a date string (YYYY-MM-DD) to a Date object in LOCAL time.
 * 
 * This prevents timezone issues where new Date("2025-11-28") is parsed as UTC
 * and then shifts by a day when displayed in local time.
 * 
 * The issue: JavaScript's new Date("YYYY-MM-DD") interprets the string as UTC midnight,
 * but when displayed, it converts to local time, potentially shifting the date by a day
 * depending on the user's timezone.
 * 
 * @param {string|Date} dateString - Date string in YYYY-MM-DD format or Date object
 * @returns {Date} Date object in local timezone
 * 
 * @example
 * // Database has: "2025-11-28"
 * // Without parseLocalDate: new Date("2025-11-28") → Nov 27 or Nov 29 depending on timezone
 * // With parseLocalDate: parseLocalDate("2025-11-28") → Nov 28 (always correct)
 */
export const parseLocalDate = (dateString) => {
  if (!dateString) return new Date();
  
  // If it's already a Date object, return it
  if (dateString instanceof Date) return dateString;
  
  // Parse YYYY-MM-DD format manually to avoid UTC interpretation
  const parts = dateString.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Months are 0-indexed in JS
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day);
  }
  
  // Fallback: parse with time component to force local interpretation
  return new Date(dateString + 'T00:00:00');
};

/**
 * Format a date to YYYY-MM-DD string in local time
 * @param {Date} date - Date object to format
 * @returns {string} Date string in YYYY-MM-DD format
 */
export const formatDateToYYYYMMDD = (date) => {
  if (!date || !(date instanceof Date)) return '';
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Format a date to human-readable string
 * @param {string|Date} date - Date string or Date object
 * @param {object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string
 */
export const formatDateDisplay = (date, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  const dateObj = typeof date === 'string' ? parseLocalDate(date) : date;
  return dateObj.toLocaleDateString('en-US', options);
};


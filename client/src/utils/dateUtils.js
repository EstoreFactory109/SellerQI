/**
 * Utility functions for date handling
 */

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


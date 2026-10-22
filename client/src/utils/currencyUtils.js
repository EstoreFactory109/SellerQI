/**
 * Utility functions for currency formatting
 */

/** Shown in place of an amount we do not have (no data), as distinct from a real 0. */
export const NOT_AVAILABLE = '—';

/**
 * True when a value is "no data" rather than a number: null, undefined or NaN.
 * A real 0 is not missing.
 * @param {*} value
 * @returns {boolean}
 */
export const isMissingNumber = (value) =>
  value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value));

/**
 * Format a number as currency using the provided currency symbol
 * @param {number|null|undefined} value - The numeric value to format ('—' when null/undefined/NaN)
 * @param {string} currency - The currency symbol (e.g., '$', '€', '£')
 * @returns {string} - Formatted currency string
 */
export const formatCurrency = (value, currency = '$') => {
  if (isMissingNumber(value)) return NOT_AVAILABLE;
  if (value >= 1000000) {
    return `${currency}${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `${currency}${(value / 1000).toFixed(1)}K`;
  } else {
    return `${currency}${value.toFixed(0)}`;
  }
};

/**
 * Format a number with currency symbol and locale formatting
 * @param {number|null|undefined} value - The numeric value to format ('—' when null/undefined/NaN)
 * @param {string} currency - The currency symbol (e.g., '$', '€', '£')
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} - Formatted currency string with locale formatting
 */
export const formatCurrencyWithLocale = (value, currency = '$', decimals = 2) => {
  if (isMissingNumber(value)) return NOT_AVAILABLE;
  return `${currency}${value.toLocaleString('en-US', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  })}`;
};

/**
 * Format Y-axis values for charts
 * @param {number|null|undefined} value - The numeric value to format ('—' when null/undefined/NaN)
 * @param {string} currency - The currency symbol (e.g., '$', '€', '£')
 * @returns {string} - Formatted currency string for charts
 */
export const formatYAxisCurrency = (value, currency = '$') => {
  if (isMissingNumber(value)) return NOT_AVAILABLE;
  if (value >= 1000) {
    return `${currency}${(value / 1000).toFixed(1)}k`;
  }
  return `${currency}${value}`;
};

/**
 * Utility functions for currency formatting
 */

/**
 * Format a number as currency using the provided currency symbol
 * @param {number} value - The numeric value to format
 * @param {string} currency - The currency symbol (e.g., '$', '€', '£')
 * @returns {string} - Formatted currency string
 */
export const formatCurrency = (value, currency = '$') => {
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
 * @param {number} value - The numeric value to format
 * @param {string} currency - The currency symbol (e.g., '$', '€', '£')
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} - Formatted currency string with locale formatting
 */
export const formatCurrencyWithLocale = (value, currency = '$', decimals = 2) => {
  return `${currency}${value.toLocaleString('en-US', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  })}`;
};

/**
 * Format Y-axis values for charts
 * @param {number} value - The numeric value to format
 * @param {string} currency - The currency symbol (e.g., '$', '€', '£')
 * @returns {string} - Formatted currency string for charts
 */
export const formatYAxisCurrency = (value, currency = '$') => {
  if (value >= 1000) {
    return `${currency}${(value / 1000).toFixed(1)}k`;
  }
  return `${currency}${value}`;
};

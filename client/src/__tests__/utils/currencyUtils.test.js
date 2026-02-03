/**
 * Tests for currency utility functions
 */

import { describe, it, expect } from 'vitest';
import { formatCurrency, formatCurrencyWithLocale, formatYAxisCurrency } from '../../utils/currencyUtils';

describe('currencyUtils', () => {
  describe('formatCurrency', () => {
    it('should format values >= 1,000,000 as M (millions)', () => {
      expect(formatCurrency(1000000)).toBe('$1.0M');
      expect(formatCurrency(2500000)).toBe('$2.5M');
      expect(formatCurrency(10000000)).toBe('$10.0M');
    });

    it('should format values >= 1,000 as K (thousands)', () => {
      expect(formatCurrency(1000)).toBe('$1.0K');
      expect(formatCurrency(5500)).toBe('$5.5K');
      expect(formatCurrency(999999)).toBe('$1000.0K');
    });

    it('should format values < 1,000 without suffix', () => {
      expect(formatCurrency(999)).toBe('$999');
      expect(formatCurrency(100)).toBe('$100');
      expect(formatCurrency(0)).toBe('$0');
    });

    it('should use custom currency symbol', () => {
      expect(formatCurrency(1000, '€')).toBe('€1.0K');
      expect(formatCurrency(1000000, '£')).toBe('£1.0M');
      expect(formatCurrency(500, '₹')).toBe('₹500');
    });

    it('should use default $ when no currency specified', () => {
      expect(formatCurrency(100)).toBe('$100');
    });

    it('should handle decimal values', () => {
      expect(formatCurrency(1234.56)).toBe('$1.2K');
      expect(formatCurrency(999.99)).toBe('$1000');
    });
  });

  describe('formatCurrencyWithLocale', () => {
    it('should format with locale-aware number separators', () => {
      expect(formatCurrencyWithLocale(1234567.89)).toBe('$1,234,567.89');
    });

    it('should use custom currency symbol', () => {
      expect(formatCurrencyWithLocale(1000, '€')).toBe('€1,000.00');
      expect(formatCurrencyWithLocale(1000, '£')).toBe('£1,000.00');
    });

    it('should respect decimals parameter', () => {
      expect(formatCurrencyWithLocale(1000.123, '$', 0)).toBe('$1,000');
      expect(formatCurrencyWithLocale(1000.123, '$', 1)).toBe('$1,000.1');
      expect(formatCurrencyWithLocale(1000.123, '$', 3)).toBe('$1,000.123');
    });

    it('should default to 2 decimal places', () => {
      expect(formatCurrencyWithLocale(100)).toBe('$100.00');
    });

    it('should handle whole numbers', () => {
      expect(formatCurrencyWithLocale(1000)).toBe('$1,000.00');
    });

    it('should handle zero', () => {
      expect(formatCurrencyWithLocale(0)).toBe('$0.00');
    });
  });

  describe('formatYAxisCurrency', () => {
    it('should format values >= 1,000 as k (lowercase)', () => {
      expect(formatYAxisCurrency(1000)).toBe('$1.0k');
      expect(formatYAxisCurrency(5500)).toBe('$5.5k');
      expect(formatYAxisCurrency(10000)).toBe('$10.0k');
    });

    it('should format values < 1,000 without suffix', () => {
      expect(formatYAxisCurrency(999)).toBe('$999');
      expect(formatYAxisCurrency(500)).toBe('$500');
      expect(formatYAxisCurrency(0)).toBe('$0');
    });

    it('should use custom currency symbol', () => {
      expect(formatYAxisCurrency(1000, '€')).toBe('€1.0k');
      expect(formatYAxisCurrency(500, '£')).toBe('£500');
    });
  });
});

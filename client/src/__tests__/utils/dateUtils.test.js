/**
 * Tests for date utility functions
 */

import { describe, it, expect } from 'vitest';
import { parseLocalDate, formatDateToYYYYMMDD, formatDateDisplay } from '../../utils/dateUtils';

describe('dateUtils', () => {
  describe('parseLocalDate', () => {
    it('should parse YYYY-MM-DD string correctly', () => {
      const result = parseLocalDate('2024-11-28');
      
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(10); // November is 10 (0-indexed)
      expect(result.getDate()).toBe(28);
    });

    it('should return same date object if passed a Date', () => {
      const date = new Date(2024, 5, 15); // June 15, 2024
      const result = parseLocalDate(date);
      
      expect(result).toBe(date);
    });

    it('should return current date for null input', () => {
      const result = parseLocalDate(null);
      const now = new Date();
      
      expect(result.getDate()).toBe(now.getDate());
    });

    it('should return current date for undefined input', () => {
      const result = parseLocalDate(undefined);
      const now = new Date();
      
      expect(result.getDate()).toBe(now.getDate());
    });

    it('should return current date for empty string', () => {
      const result = parseLocalDate('');
      const now = new Date();
      
      expect(result.getDate()).toBe(now.getDate());
    });

    it('should handle start of year', () => {
      const result = parseLocalDate('2024-01-01');
      
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(1);
    });

    it('should handle end of year', () => {
      const result = parseLocalDate('2024-12-31');
      
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(11);
      expect(result.getDate()).toBe(31);
    });

    it('should handle leap year date', () => {
      const result = parseLocalDate('2024-02-29');
      
      expect(result.getMonth()).toBe(1); // February
      expect(result.getDate()).toBe(29);
    });

    it('should fallback for non-standard format', () => {
      const result = parseLocalDate('2024/11/28'); // Not standard format
      
      expect(result instanceof Date).toBe(true);
    });
  });

  describe('formatDateToYYYYMMDD', () => {
    it('should format date to YYYY-MM-DD', () => {
      const date = new Date(2024, 10, 28); // November 28, 2024
      const result = formatDateToYYYYMMDD(date);
      
      expect(result).toBe('2024-11-28');
    });

    it('should pad single digit month and day', () => {
      const date = new Date(2024, 0, 5); // January 5, 2024
      const result = formatDateToYYYYMMDD(date);
      
      expect(result).toBe('2024-01-05');
    });

    it('should return empty string for null', () => {
      const result = formatDateToYYYYMMDD(null);
      
      expect(result).toBe('');
    });

    it('should return empty string for undefined', () => {
      const result = formatDateToYYYYMMDD(undefined);
      
      expect(result).toBe('');
    });

    it('should return empty string for non-Date object', () => {
      const result = formatDateToYYYYMMDD('2024-01-15');
      
      expect(result).toBe('');
    });

    it('should handle December correctly', () => {
      const date = new Date(2024, 11, 25); // December 25, 2024
      const result = formatDateToYYYYMMDD(date);
      
      expect(result).toBe('2024-12-25');
    });
  });

  describe('formatDateDisplay', () => {
    it('should format date string to human-readable format', () => {
      const result = formatDateDisplay('2024-11-28');
      
      expect(result).toContain('Nov');
      expect(result).toContain('28');
      expect(result).toContain('2024');
    });

    it('should format Date object to human-readable format', () => {
      const date = new Date(2024, 10, 28);
      const result = formatDateDisplay(date);
      
      expect(result).toContain('Nov');
      expect(result).toContain('28');
      expect(result).toContain('2024');
    });

    it('should accept custom format options', () => {
      const result = formatDateDisplay('2024-11-28', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      });
      
      expect(result).toContain('November');
    });

    it('should handle different date formats with options', () => {
      const result = formatDateDisplay('2024-11-28', { 
        weekday: 'long',
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      });
      
      expect(result).toContain('Thursday');
      expect(result).toContain('November');
    });
  });

  describe('round-trip conversion', () => {
    it('should maintain date through parse and format', () => {
      const original = '2024-11-28';
      const parsed = parseLocalDate(original);
      const formatted = formatDateToYYYYMMDD(parsed);
      
      expect(formatted).toBe(original);
    });

    it('should work for various dates', () => {
      const dates = ['2024-01-01', '2024-06-15', '2024-12-31', '2020-02-29'];
      
      dates.forEach(dateStr => {
        const parsed = parseLocalDate(dateStr);
        const formatted = formatDateToYYYYMMDD(parsed);
        expect(formatted).toBe(dateStr);
      });
    });
  });
});

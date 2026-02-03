/**
 * Tests for currencySlice Redux reducer
 */

import { describe, it, expect } from 'vitest';
import currencyReducer, {
  setCurrency,
  clearCurrency,
} from '../../redux/slices/currencySlice';

describe('currencySlice', () => {
  const initialState = {
    currency: null,
    country: null,
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      expect(currencyReducer(undefined, { type: 'unknown' })).toEqual(initialState);
    });
  });

  describe('setCurrency', () => {
    it('should set currency and country', () => {
      const state = currencyReducer(
        initialState,
        setCurrency({ currency: '$', country: 'US' })
      );

      expect(state.currency).toBe('$');
      expect(state.country).toBe('US');
    });

    it('should handle Euro currency', () => {
      const state = currencyReducer(
        initialState,
        setCurrency({ currency: '€', country: 'DE' })
      );

      expect(state.currency).toBe('€');
      expect(state.country).toBe('DE');
    });

    it('should handle British Pound', () => {
      const state = currencyReducer(
        initialState,
        setCurrency({ currency: '£', country: 'UK' })
      );

      expect(state.currency).toBe('£');
      expect(state.country).toBe('UK');
    });

    it('should handle Indian Rupee', () => {
      const state = currencyReducer(
        initialState,
        setCurrency({ currency: '₹', country: 'IN' })
      );

      expect(state.currency).toBe('₹');
      expect(state.country).toBe('IN');
    });

    it('should replace existing currency', () => {
      const existingState = {
        currency: '$',
        country: 'US',
      };

      const state = currencyReducer(
        existingState,
        setCurrency({ currency: '€', country: 'DE' })
      );

      expect(state.currency).toBe('€');
      expect(state.country).toBe('DE');
    });
  });

  describe('clearCurrency', () => {
    it('should clear currency and country', () => {
      const existingState = {
        currency: '$',
        country: 'US',
      };

      const state = currencyReducer(existingState, clearCurrency());

      expect(state.currency).toBeNull();
      expect(state.country).toBeNull();
    });

    it('should handle clearing from initial state', () => {
      const state = currencyReducer(initialState, clearCurrency());

      expect(state.currency).toBeNull();
      expect(state.country).toBeNull();
    });
  });
});

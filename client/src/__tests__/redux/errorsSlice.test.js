/**
 * Tests for errorsSlice Redux reducer
 */

import { describe, it, expect } from 'vitest';
import errorsReducer, {
  setProfitabilityErrorDetails,
  setSponsoredAdsErrorDetails,
  updateProfitabilityErrors,
  updateSponsoredAdsErrors,
  clearErrors,
} from '../../redux/slices/errorsSlice';

describe('errorsSlice', () => {
  const initialState = {
    profitabilityErrors: {
      totalErrors: 0,
      errorDetails: [],
    },
    sponsoredAdsErrors: {
      totalErrors: 0,
      errorDetails: [],
    },
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      expect(errorsReducer(undefined, { type: 'unknown' })).toEqual(initialState);
    });
  });

  describe('setProfitabilityErrorDetails', () => {
    it('should set profitability error details', () => {
      const errorData = {
        totalErrors: 5,
        errorDetails: [
          { asin: 'B001', error: 'Missing COGS' },
          { asin: 'B002', error: 'Negative margin' },
        ],
      };

      const state = errorsReducer(initialState, setProfitabilityErrorDetails(errorData));

      expect(state.profitabilityErrors).toEqual(errorData);
    });

    it('should replace existing profitability errors', () => {
      const existingState = {
        ...initialState,
        profitabilityErrors: {
          totalErrors: 3,
          errorDetails: [{ old: 'data' }],
        },
      };

      const newData = {
        totalErrors: 10,
        errorDetails: [{ new: 'data' }],
      };

      const state = errorsReducer(existingState, setProfitabilityErrorDetails(newData));

      expect(state.profitabilityErrors).toEqual(newData);
    });
  });

  describe('setSponsoredAdsErrorDetails', () => {
    it('should set sponsored ads error details', () => {
      const errorData = {
        totalErrors: 8,
        errorDetails: [
          { campaign: 'Campaign1', error: 'High ACoS' },
          { campaign: 'Campaign2', error: 'No impressions' },
        ],
      };

      const state = errorsReducer(initialState, setSponsoredAdsErrorDetails(errorData));

      expect(state.sponsoredAdsErrors).toEqual(errorData);
    });
  });

  describe('updateProfitabilityErrors', () => {
    it('should update total errors count', () => {
      const existingState = {
        ...initialState,
        profitabilityErrors: {
          totalErrors: 5,
          errorDetails: [{ existing: 'detail' }],
        },
      };

      const state = errorsReducer(
        existingState,
        updateProfitabilityErrors({ totalErrors: 10 })
      );

      expect(state.profitabilityErrors.totalErrors).toBe(10);
      expect(state.profitabilityErrors.errorDetails).toEqual([{ existing: 'detail' }]);
    });

    it('should update error details when provided', () => {
      const existingState = {
        ...initialState,
        profitabilityErrors: {
          totalErrors: 5,
          errorDetails: [{ old: 'data' }],
        },
      };

      const state = errorsReducer(
        existingState,
        updateProfitabilityErrors({
          totalErrors: 10,
          errorDetails: [{ new: 'data' }],
        })
      );

      expect(state.profitabilityErrors.totalErrors).toBe(10);
      expect(state.profitabilityErrors.errorDetails).toEqual([{ new: 'data' }]);
    });
  });

  describe('updateSponsoredAdsErrors', () => {
    it('should update total errors count', () => {
      const state = errorsReducer(
        initialState,
        updateSponsoredAdsErrors({ totalErrors: 15 })
      );

      expect(state.sponsoredAdsErrors.totalErrors).toBe(15);
    });

    it('should update error details when provided', () => {
      const state = errorsReducer(
        initialState,
        updateSponsoredAdsErrors({
          totalErrors: 20,
          errorDetails: [{ campaign: 'Test', issue: 'Low CTR' }],
        })
      );

      expect(state.sponsoredAdsErrors.totalErrors).toBe(20);
      expect(state.sponsoredAdsErrors.errorDetails).toHaveLength(1);
    });
  });

  describe('clearErrors', () => {
    it('should reset all errors to initial state', () => {
      const existingState = {
        profitabilityErrors: {
          totalErrors: 100,
          errorDetails: [{ many: 'errors' }],
        },
        sponsoredAdsErrors: {
          totalErrors: 50,
          errorDetails: [{ more: 'errors' }],
        },
      };

      const state = errorsReducer(existingState, clearErrors());

      expect(state).toEqual(initialState);
    });

    it('should handle clearing from initial state', () => {
      const state = errorsReducer(initialState, clearErrors());

      expect(state).toEqual(initialState);
    });
  });

  describe('independence of error types', () => {
    it('should not affect sponsored ads when updating profitability', () => {
      const existingState = {
        profitabilityErrors: { totalErrors: 5, errorDetails: [] },
        sponsoredAdsErrors: { totalErrors: 10, errorDetails: [{ test: 'data' }] },
      };

      const state = errorsReducer(
        existingState,
        updateProfitabilityErrors({ totalErrors: 20 })
      );

      expect(state.sponsoredAdsErrors.totalErrors).toBe(10);
      expect(state.sponsoredAdsErrors.errorDetails).toEqual([{ test: 'data' }]);
    });

    it('should not affect profitability when updating sponsored ads', () => {
      const existingState = {
        profitabilityErrors: { totalErrors: 15, errorDetails: [{ test: 'data' }] },
        sponsoredAdsErrors: { totalErrors: 5, errorDetails: [] },
      };

      const state = errorsReducer(
        existingState,
        updateSponsoredAdsErrors({ totalErrors: 25 })
      );

      expect(state.profitabilityErrors.totalErrors).toBe(15);
      expect(state.profitabilityErrors.errorDetails).toEqual([{ test: 'data' }]);
    });
  });
});

/**
 * Tests for authSlice Redux reducer
 */

import { describe, it, expect } from 'vitest';
import authReducer, {
  loginSuccess,
  logout,
  addBrand,
  updatePackageType,
  updateProfileDetails,
  updateTrialStatus,
} from '../../redux/slices/authSlice';

describe('authSlice', () => {
  const initialState = {
    isAuthenticated: false,
    user: null,
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      expect(authReducer(undefined, { type: 'unknown' })).toEqual(initialState);
    });
  });

  describe('loginSuccess', () => {
    it('should set user and authenticate', () => {
      const user = {
        id: '123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      };

      const state = authReducer(initialState, loginSuccess(user));

      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(user);
    });

    it('should replace existing user', () => {
      const existingState = {
        isAuthenticated: true,
        user: { id: 'old', email: 'old@example.com' },
      };
      const newUser = { id: 'new', email: 'new@example.com' };

      const state = authReducer(existingState, loginSuccess(newUser));

      expect(state.user).toEqual(newUser);
    });
  });

  describe('logout', () => {
    it('should clear user and unauthenticate', () => {
      const authenticatedState = {
        isAuthenticated: true,
        user: { id: '123', email: 'test@example.com' },
      };

      const state = authReducer(authenticatedState, logout());

      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
    });

    it('should handle logout from initial state', () => {
      const state = authReducer(initialState, logout());

      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
    });
  });

  describe('addBrand', () => {
    it('should add brand to existing user', () => {
      const authenticatedState = {
        isAuthenticated: true,
        user: { id: '123', email: 'test@example.com' },
      };
      const brand = 'My Brand Name';

      const state = authReducer(authenticatedState, addBrand(brand));

      expect(state.user.brand).toBe(brand);
    });

    it('should update existing brand', () => {
      const authenticatedState = {
        isAuthenticated: true,
        user: { id: '123', brand: 'Old Brand' },
      };

      const state = authReducer(authenticatedState, addBrand('New Brand'));

      expect(state.user.brand).toBe('New Brand');
    });
  });

  describe('updatePackageType', () => {
    it('should update package type and subscription status', () => {
      const authenticatedState = {
        isAuthenticated: true,
        user: {
          id: '123',
          packageType: 'LITE',
          subscriptionStatus: null,
        },
      };

      const state = authReducer(
        authenticatedState,
        updatePackageType({
          packageType: 'PRO',
          subscriptionStatus: 'active',
        })
      );

      expect(state.user.packageType).toBe('PRO');
      expect(state.user.subscriptionStatus).toBe('active');
    });

    it('should not update if user is null', () => {
      const state = authReducer(
        initialState,
        updatePackageType({
          packageType: 'PRO',
          subscriptionStatus: 'active',
        })
      );

      expect(state.user).toBeNull();
    });

    it('should preserve other user properties', () => {
      const authenticatedState = {
        isAuthenticated: true,
        user: {
          id: '123',
          email: 'test@example.com',
          firstName: 'John',
          packageType: 'LITE',
        },
      };

      const state = authReducer(
        authenticatedState,
        updatePackageType({
          packageType: 'PRO',
          subscriptionStatus: 'active',
        })
      );

      expect(state.user.email).toBe('test@example.com');
      expect(state.user.firstName).toBe('John');
      expect(state.user.id).toBe('123');
    });
  });

  describe('updateProfileDetails', () => {
    it('should update profile details', () => {
      const authenticatedState = {
        isAuthenticated: true,
        user: {
          id: '123',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '1234567890',
          whatsapp: '1234567890',
          packageType: 'PRO',
        },
      };

      const state = authReducer(
        authenticatedState,
        updateProfileDetails({
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          phone: '0987654321',
          whatsapp: '0987654321',
        })
      );

      expect(state.user.firstName).toBe('Jane');
      expect(state.user.lastName).toBe('Smith');
      expect(state.user.email).toBe('jane@example.com');
      expect(state.user.phone).toBe('0987654321');
      expect(state.user.whatsapp).toBe('0987654321');
    });

    it('should preserve other user data', () => {
      const authenticatedState = {
        isAuthenticated: true,
        user: {
          id: '123',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '1234567890',
          whatsapp: '1234567890',
          packageType: 'PRO',
          brand: 'My Brand',
        },
      };

      const state = authReducer(
        authenticatedState,
        updateProfileDetails({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '1234567890',
          whatsapp: '1234567890',
        })
      );

      expect(state.user.packageType).toBe('PRO');
      expect(state.user.brand).toBe('My Brand');
      expect(state.user.id).toBe('123');
    });

    it('should not update if user is null', () => {
      const state = authReducer(
        initialState,
        updateProfileDetails({
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          phone: '0987654321',
          whatsapp: '0987654321',
        })
      );

      expect(state.user).toBeNull();
    });
  });

  describe('updateTrialStatus', () => {
    it('should update trial-related fields', () => {
      const authenticatedState = {
        isAuthenticated: true,
        user: {
          id: '123',
          packageType: 'LITE',
          subscriptionStatus: null,
          isInTrialPeriod: false,
          trialEndsDate: null,
        },
      };

      const trialEnd = new Date('2024-12-31').toISOString();
      const state = authReducer(
        authenticatedState,
        updateTrialStatus({
          packageType: 'PRO',
          subscriptionStatus: 'trialing',
          isInTrialPeriod: true,
          trialEndsDate: trialEnd,
        })
      );

      expect(state.user.packageType).toBe('PRO');
      expect(state.user.subscriptionStatus).toBe('trialing');
      expect(state.user.isInTrialPeriod).toBe(true);
      expect(state.user.trialEndsDate).toBe(trialEnd);
    });

    it('should not update if user is null', () => {
      const state = authReducer(
        initialState,
        updateTrialStatus({
          packageType: 'PRO',
          subscriptionStatus: 'trialing',
          isInTrialPeriod: true,
          trialEndsDate: new Date().toISOString(),
        })
      );

      expect(state.user).toBeNull();
    });

    it('should handle trial expiration', () => {
      const authenticatedState = {
        isAuthenticated: true,
        user: {
          id: '123',
          packageType: 'PRO',
          isInTrialPeriod: true,
          trialEndsDate: new Date('2024-01-01').toISOString(),
        },
      };

      const state = authReducer(
        authenticatedState,
        updateTrialStatus({
          packageType: 'LITE',
          subscriptionStatus: 'expired',
          isInTrialPeriod: false,
          trialEndsDate: null,
        })
      );

      expect(state.user.packageType).toBe('LITE');
      expect(state.user.isInTrialPeriod).toBe(false);
    });
  });
});

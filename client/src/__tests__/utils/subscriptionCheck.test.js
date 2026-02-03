/**
 * Tests for subscription check utility functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  hasPremiumAccess, 
  isTrialExpired, 
  isInActiveTrial, 
  getSubscriptionDetails 
} from '../../utils/subscriptionCheck';

describe('subscriptionCheck', () => {
  // Helper to create mock dates
  const createFutureDate = (daysFromNow = 7) => {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString();
  };

  const createPastDate = (daysAgo = 7) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString();
  };

  describe('hasPremiumAccess', () => {
    it('should return false for null user', () => {
      expect(hasPremiumAccess(null)).toBe(false);
    });

    it('should return false for undefined user', () => {
      expect(hasPremiumAccess(undefined)).toBe(false);
    });

    it('should return false for LITE users', () => {
      const user = {
        packageType: 'LITE',
        subscriptionStatus: 'active',
      };
      expect(hasPremiumAccess(user)).toBe(false);
    });

    it('should return true for PRO users with active subscription', () => {
      const user = {
        packageType: 'PRO',
        subscriptionStatus: 'active',
        isInTrialPeriod: false,
      };
      expect(hasPremiumAccess(user)).toBe(true);
    });

    it('should return true for AGENCY users with active subscription', () => {
      const user = {
        packageType: 'AGENCY',
        subscriptionStatus: 'active',
        isInTrialPeriod: false,
      };
      expect(hasPremiumAccess(user)).toBe(true);
    });

    it('should return true for PRO users with trialing status', () => {
      const user = {
        packageType: 'PRO',
        subscriptionStatus: 'trialing',
        isInTrialPeriod: false,
      };
      expect(hasPremiumAccess(user)).toBe(true);
    });

    it('should return true for PRO users with no subscription status', () => {
      const user = {
        packageType: 'PRO',
        subscriptionStatus: null,
        isInTrialPeriod: false,
      };
      expect(hasPremiumAccess(user)).toBe(true);
    });

    it('should return true for PRO users with undefined subscription status', () => {
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: false,
      };
      expect(hasPremiumAccess(user)).toBe(true);
    });

    it('should return false for PRO users with cancelled subscription', () => {
      const user = {
        packageType: 'PRO',
        subscriptionStatus: 'cancelled',
        isInTrialPeriod: false,
      };
      expect(hasPremiumAccess(user)).toBe(false);
    });

    it('should return false for PRO users with past_due subscription', () => {
      const user = {
        packageType: 'PRO',
        subscriptionStatus: 'past_due',
        isInTrialPeriod: false,
      };
      expect(hasPremiumAccess(user)).toBe(false);
    });

    describe('trial period handling', () => {
      it('should return true for PRO user in active trial', () => {
        const user = {
          packageType: 'PRO',
          isInTrialPeriod: true,
          trialEndsDate: createFutureDate(7),
        };
        expect(hasPremiumAccess(user)).toBe(true);
      });

      it('should return false for PRO user with expired trial', () => {
        const user = {
          packageType: 'PRO',
          isInTrialPeriod: true,
          trialEndsDate: createPastDate(7),
        };
        expect(hasPremiumAccess(user)).toBe(false);
      });

      it('should return true for AGENCY user in active trial', () => {
        const user = {
          packageType: 'AGENCY',
          isInTrialPeriod: true,
          trialEndsDate: createFutureDate(14),
        };
        expect(hasPremiumAccess(user)).toBe(true);
      });
    });
  });

  describe('isTrialExpired', () => {
    it('should return false for null user', () => {
      expect(isTrialExpired(null)).toBe(false);
    });

    it('should return false for user not in trial period', () => {
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: false,
        subscriptionStatus: 'active',
      };
      expect(isTrialExpired(user)).toBe(false);
    });

    it('should return false for user without trialEndsDate', () => {
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: true,
        trialEndsDate: null,
      };
      expect(isTrialExpired(user)).toBe(false);
    });

    it('should return true when trial has expired', () => {
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: true,
        trialEndsDate: createPastDate(1),
      };
      expect(isTrialExpired(user)).toBe(true);
    });

    it('should return false when trial is still active', () => {
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: true,
        trialEndsDate: createFutureDate(7),
      };
      expect(isTrialExpired(user)).toBe(false);
    });
  });

  describe('isInActiveTrial', () => {
    it('should return false for null user', () => {
      expect(isInActiveTrial(null)).toBe(false);
    });

    it('should return false for user not in trial period', () => {
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: false,
        subscriptionStatus: 'active',
      };
      expect(isInActiveTrial(user)).toBe(false);
    });

    it('should return false for user without trialEndsDate', () => {
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: true,
        trialEndsDate: null,
      };
      expect(isInActiveTrial(user)).toBe(false);
    });

    it('should return true when trial is active', () => {
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: true,
        trialEndsDate: createFutureDate(7),
      };
      expect(isInActiveTrial(user)).toBe(true);
    });

    it('should return false when trial has expired', () => {
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: true,
        trialEndsDate: createPastDate(1),
      };
      expect(isInActiveTrial(user)).toBe(false);
    });

    it('should return true when trial ends exactly now (edge case)', () => {
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: true,
        trialEndsDate: new Date().toISOString(),
      };
      // Should be true because now <= trialEnd
      expect(isInActiveTrial(user)).toBe(true);
    });
  });

  describe('getSubscriptionDetails', () => {
    it('should return null values for undefined user', () => {
      const result = getSubscriptionDetails(undefined);

      expect(result.packageType).toBeNull();
      expect(result.isInTrialPeriod).toBe(false);
      expect(result.trialEndsDate).toBeNull();
      expect(result.subscriptionStatus).toBeNull();
      expect(result.hasPremiumAccess).toBe(false);
    });

    it('should return correct details for PRO user with active subscription', () => {
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: false,
        trialEndsDate: null,
        subscriptionStatus: 'active',
      };

      const result = getSubscriptionDetails(user);

      expect(result.packageType).toBe('PRO');
      expect(result.isInTrialPeriod).toBe(false);
      expect(result.subscriptionStatus).toBe('active');
      expect(result.hasPremiumAccess).toBe(true);
      expect(result.isTrialExpired).toBe(false);
      expect(result.isInActiveTrial).toBe(false);
    });

    it('should return correct details for user in trial', () => {
      const trialEnd = createFutureDate(7);
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: true,
        trialEndsDate: trialEnd,
        subscriptionStatus: null,
      };

      const result = getSubscriptionDetails(user);

      expect(result.packageType).toBe('PRO');
      expect(result.isInTrialPeriod).toBe(true);
      expect(result.trialEndsDate).toBe(trialEnd);
      expect(result.hasPremiumAccess).toBe(true);
      expect(result.isTrialExpired).toBe(false);
      expect(result.isInActiveTrial).toBe(true);
    });

    it('should return correct details for user with expired trial', () => {
      const trialEnd = createPastDate(7);
      const user = {
        packageType: 'PRO',
        isInTrialPeriod: true,
        trialEndsDate: trialEnd,
        subscriptionStatus: null,
      };

      const result = getSubscriptionDetails(user);

      expect(result.hasPremiumAccess).toBe(false);
      expect(result.isTrialExpired).toBe(true);
      expect(result.isInActiveTrial).toBe(false);
    });

    it('should return correct details for LITE user', () => {
      const user = {
        packageType: 'LITE',
        isInTrialPeriod: false,
        subscriptionStatus: null,
      };

      const result = getSubscriptionDetails(user);

      expect(result.packageType).toBe('LITE');
      expect(result.hasPremiumAccess).toBe(false);
    });
  });
});

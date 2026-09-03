/**
 * Utility functions to check user subscription status
 * Used to determine if user has valid premium access (PRO, PRO trial, or AGENCY)
 */

/**
 * Check if user has valid premium access (PRO, PRO trial, or AGENCY)
 * LITE users do NOT have premium access and should be redirected to pricing
 * @param {Object} user - User object from API response or Redux state
 * @returns {boolean} - True if user has premium access, false otherwise
 */
export const hasPremiumAccess = (user) => {
  if (!user) {
    return false;
  }

  const packageType = user.packageType;

  // All PRO and AGENCY users have premium access by default
  // No payment or trial checks required
  if (packageType === 'PRO' || packageType === 'AGENCY') {
    return true;
  }

  // LITE users don't have premium access
  return false;
};

/**
 * Check if user's trial has expired
 * @param {Object} user - User object
 * @returns {boolean} - True if trial has expired, false otherwise
 */
export const isTrialExpired = (user) => {
  if (!user || !user.isInTrialPeriod || !user.trialEndsDate) {
    return false;
  }

  const now = new Date();
  const trialEnd = new Date(user.trialEndsDate);
  return now > trialEnd;
};

/**
 * Check if user is in active trial period
 * @param {Object} user - User object
 * @returns {boolean} - True if in active trial, false otherwise
 */
export const isInActiveTrial = (user) => {
  if (!user || !user.isInTrialPeriod || !user.trialEndsDate) {
    return false;
  }

  const now = new Date();
  const trialEnd = new Date(user.trialEndsDate);
  return now <= trialEnd;
};

/**
 * Get detailed subscription info for debugging/logging
 * @param {Object} user - User object
 * @returns {Object} - Subscription details
 */
export const getSubscriptionDetails = (user) => {
  return {
    packageType: user?.packageType || null,
    isInTrialPeriod: user?.isInTrialPeriod || false,
    trialEndsDate: user?.trialEndsDate || null,
    subscriptionStatus: user?.subscriptionStatus || null,
    hasPremiumAccess: hasPremiumAccess(user),
    isTrialExpired: isTrialExpired(user),
    isInActiveTrial: isInActiveTrial(user)
  };
};


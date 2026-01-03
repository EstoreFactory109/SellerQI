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
  const isInTrialPeriod = user.isInTrialPeriod;
  const trialEndsDate = user.trialEndsDate;
  const subscriptionStatus = user.subscriptionStatus;

  // Check if user is on PRO or AGENCY plan
  if (packageType === 'PRO' || packageType === 'AGENCY') {
    // For PRO users in trial period, check if trial hasn't expired
    if (isInTrialPeriod && trialEndsDate) {
      const now = new Date();
      const trialEnd = new Date(trialEndsDate);
      if (now > trialEnd) {
        // Trial has expired - no premium access
        return false;
      }
      // Trial is still active
      return true;
    }

    // For paid PRO/AGENCY users, check subscription status
    // Active or undefined subscription status means valid access
    if (!subscriptionStatus || subscriptionStatus === 'active') {
      return true;
    }

    // Subscription is inactive, cancelled, or past_due
    return false;
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


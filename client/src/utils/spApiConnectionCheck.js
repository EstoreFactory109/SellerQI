/**
 * Utility function to check if SP-API is connected for a user
 * Checks if user has seller account and if any account has SP-API refresh token
 * @param {Object} user - User object from API response
 * @returns {boolean} - True if SP-API is connected, false otherwise
 */
export const isSpApiConnected = (user) => {
  // Check if user has sellerCentral data
  if (!user || !user.sellerCentral) {
    return false;
  }

  // Check if sellerCentral has sellerAccount array
  if (!user.sellerCentral.sellerAccount || !Array.isArray(user.sellerCentral.sellerAccount)) {
    return false;
  }

  // Check if sellerAccount array is empty
  if (user.sellerCentral.sellerAccount.length === 0) {
    return false;
  }
  
  // Check if any seller account has SP-API refresh token
  // Note: Backend may return 'connected' string instead of actual token for security
  const hasSpApiToken = user.sellerCentral.sellerAccount.some(account => {
    const hasToken = account.spiRefreshToken && account.spiRefreshToken.toString().trim() !== '';
    return hasToken;
  });

  return hasSpApiToken;
};

/**
 * Check if SP-API is connected from AllAccounts Redux state
 * @param {Array} allAccounts - Array of seller accounts from Redux state
 * @param {string} country - Optional country code to check specific account
 * @param {string} region - Optional region code to check specific account
 * @returns {boolean} - True if SP-API is connected, false otherwise
 */
export const isSpApiConnectedFromAccounts = (allAccounts, country = null, region = null) => {
  if (!allAccounts || !Array.isArray(allAccounts) || allAccounts.length === 0) {
    return false;
  }

  // If country and region are provided, check specific account
  if (country && region) {
    const specificAccount = allAccounts.find(
      acc => acc.country === country && acc.region === region
    );
    if (specificAccount) {
      // Check both property names for backward compatibility
      return specificAccount.SpAPIrefreshTokenStatus === true ||
             (specificAccount.spiRefreshToken && specificAccount.spiRefreshToken.trim() !== '');
    }
    return false;
  }

  // Check if any account has SP-API refresh token
  // Support both property names: SpAPIrefreshTokenStatus (boolean) and spiRefreshToken (string)
  const hasSpApiToken = allAccounts.some(account => 
    account.SpAPIrefreshTokenStatus === true ||
    (account.spiRefreshToken && account.spiRefreshToken && account.spiRefreshToken.trim() !== '')
  );

  return hasSpApiToken;
};

/**
 * Utility function to check if Amazon Ads account is connected for a user
 * Checks if user has seller account and if any account has Ads refresh token
 * @param {Object} user - User object from API response
 * @returns {boolean} - True if Ads account is connected, false otherwise
 */
export const isAdsAccountConnected = (user) => {
  // Check if user has sellerCentral data
  if (!user || !user.sellerCentral) {
    return false;
  }

  // Check if sellerCentral has sellerAccount array
  if (!user.sellerCentral.sellerAccount || !Array.isArray(user.sellerCentral.sellerAccount)) {
    return false;
  }

  // Check if sellerAccount array is empty
  if (user.sellerCentral.sellerAccount.length === 0) {
    return false;
  }
  
  // Check if any seller account has Ads refresh token
  // Note: Backend may return 'connected' string instead of actual token for security
  const hasAdsToken = user.sellerCentral.sellerAccount.some(account => {
    const hasToken = account.adsRefreshToken && account.adsRefreshToken.toString().trim() !== '';
    return hasToken;
  });

  return hasAdsToken;
};

/**
 * Check if Ads account is connected from AllAccounts Redux state
 * @param {Array} allAccounts - Array of seller accounts from Redux state
 * @param {string} country - Optional country code to check specific account
 * @param {string} region - Optional region code to check specific account
 * @returns {boolean} - True if Ads account is connected, false otherwise
 */
export const isAdsAccountConnectedFromAccounts = (allAccounts, country = null, region = null) => {
  if (!allAccounts || !Array.isArray(allAccounts) || allAccounts.length === 0) {
    return false;
  }

  // If country and region are provided, check specific account
  if (country && region) {
    const specificAccount = allAccounts.find(
      acc => acc.country === country && acc.region === region
    );
    if (specificAccount) {
      // Check both property names for backward compatibility
      return specificAccount.AdsAPIrefreshTokenStatus === true ||
             (specificAccount.adsRefreshToken && specificAccount.adsRefreshToken.trim() !== '');
    }
    return false;
  }

  // Check if any account has Ads refresh token
  // Support both property names: AdsAPIrefreshTokenStatus (boolean) and adsRefreshToken (string)
  const hasAdsToken = allAccounts.some(account => 
    account.AdsAPIrefreshTokenStatus === true ||
    (account.adsRefreshToken && account.adsRefreshToken && account.adsRefreshToken.trim() !== '')
  );

  return hasAdsToken;
};


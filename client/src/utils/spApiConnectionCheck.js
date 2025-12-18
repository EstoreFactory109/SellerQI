/**
 * Utility function to check if SP-API is connected for a user
 * Checks if user has seller account and if any account has SP-API refresh token
 * @param {Object} user - User object from API response
 * @returns {boolean} - True if SP-API is connected, false otherwise
 */
export const isSpApiConnected = (user) => {
  console.log('=== isSpApiConnected DEBUG ===');
  console.log('User object:', user);
  console.log('User sellerCentral:', user?.sellerCentral);
  
  // Check if user has sellerCentral data
  if (!user || !user.sellerCentral) {
    console.log('Result: false (no user or no sellerCentral)');
    return false;
  }

  // Check if sellerCentral has sellerAccount array
  if (!user.sellerCentral.sellerAccount || !Array.isArray(user.sellerCentral.sellerAccount)) {
    console.log('Result: false (no sellerAccount array)');
    return false;
  }

  // Check if sellerAccount array is empty
  if (user.sellerCentral.sellerAccount.length === 0) {
    console.log('Result: false (empty sellerAccount array)');
    return false;
  }

  console.log('sellerAccount array:', user.sellerCentral.sellerAccount);
  
  // Check if any seller account has SP-API refresh token
  const hasSpApiToken = user.sellerCentral.sellerAccount.some(account => {
    const hasToken = account.spiRefreshToken && account.spiRefreshToken.trim() !== '';
    console.log('Account:', account.country, 'hasToken:', hasToken);
    return hasToken;
  });

  console.log('Result:', hasSpApiToken);
  return hasSpApiToken;
};

/**
 * Check if SP-API is connected from AllAccounts Redux state
 * @param {Array} allAccounts - Array of seller accounts from Redux state
 * @returns {boolean} - True if SP-API is connected, false otherwise
 */
export const isSpApiConnectedFromAccounts = (allAccounts) => {
  if (!allAccounts || !Array.isArray(allAccounts) || allAccounts.length === 0) {
    return false;
  }

  // Check if any account has SP-API refresh token
  const hasSpApiToken = allAccounts.some(account => 
    account.spiRefreshToken && account.spiRefreshToken && account.spiRefreshToken.trim() !== ''
  );

  return hasSpApiToken;
};


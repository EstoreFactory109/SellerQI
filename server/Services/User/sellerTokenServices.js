const SellerCentralModel = require('../../models/user-auth/sellerCentralModel.js');
const { ApiError } = require('../../utils/ApiError.js');
const logger = require('../../utils/Logger.js');

/**
 * Find a seller account for a given user + country + region
 * without mutating anything.
 */
const findSellerAccount = async (userId, country, region) => {
  if (!userId) {
    logger.error(new ApiError(400, 'User id is missing'));
    return { error: new ApiError(400, 'User id is missing') };
  }

  if (!country || !region) {
    logger.error(new ApiError(400, 'Country or Region is missing'));
    return { error: new ApiError(400, 'Country or Region is missing') };
  }

  const sellerCentral = await SellerCentralModel.findOne({ User: userId });

  if (!sellerCentral) {
    logger.error(new ApiError(404, 'Seller central not found'));
    return { error: new ApiError(404, 'Seller central not found') };
  }

  const sellerAccount = sellerCentral.sellerAccount.find(
    (acc) => acc.country === country && acc.region === region
  );

  if (!sellerAccount) {
    logger.error(new ApiError(404, 'Seller account not found for the specified region and country'));
    return { error: new ApiError(404, 'Seller account not found for the specified region and country') };
  }

  return { sellerCentral, sellerAccount };
};

/**
 * Delete only the Amazon Ads refresh token for a specific seller account.
 * This keeps SP-API refresh token and all other fields untouched.
 *
 * @param {string} userId  - Logged-in user id
 * @param {string} country - Marketplace country code
 * @param {string} region  - Region code (NA/EU/FE)
 */
const clearAdsRefreshTokenForAccount = async (userId, country, region) => {
  const { error, sellerCentral, sellerAccount } = await findSellerAccount(userId, country, region);
  if (error) {
    return { success: false, error };
  }

  // No-op if there is no Ads token
  if (!sellerAccount.adsRefreshToken) {
    return {
      success: true,
      data: {
        message: 'No adsRefreshToken present for this account',
        country,
        region,
      },
    };
  }

  sellerAccount.adsRefreshToken = null;

  await sellerCentral.save();

  return {
    success: true,
    data: {
      message: 'Ads refresh token cleared successfully',
      country,
      region,
    },
  };
};

/**
 * Delete both SP-API and Amazon Ads refresh tokens
 * for a specific seller account.
 *
 * @param {string} userId  - Logged-in user id
 * @param {string} country - Marketplace country code
 * @param {string} region  - Region code (NA/EU/FE)
 */
const clearAllRefreshTokensForAccount = async (userId, country, region) => {
  const { error, sellerCentral, sellerAccount } = await findSellerAccount(userId, country, region);
  if (error) {
    return { success: false, error };
  }

  // Explicitly clear only the refresh-token–related fields
  sellerAccount.spiRefreshToken = null;
  sellerAccount.adsRefreshToken = null;

  await sellerCentral.save();

  return {
    success: true,
    data: {
      message: 'SP-API and Ads refresh tokens cleared successfully',
      country,
      region,
    },
  };
};

module.exports = {
  clearAdsRefreshTokenForAccount,
  clearAllRefreshTokensForAccount,
};


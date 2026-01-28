const SellerCentralModel = require('../../models/user-auth/sellerCentralModel.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');

/**
 * Get all seller accounts for the logged-in user directly from the database.
 * This intentionally bypasses any dashboard/cache layer so that the
 * Account Integrations page always sees the latest data.
 */
const getSellerAccountsForUser = asyncHandler(async (req, res) => {
  const userId = req.userId;

  if (!userId) {
    logger.error(new ApiError(400, 'User id is missing'));
    return res
      .status(400)
      .json(new ApiResponse(400, [], 'User id is missing'));
  }

  const sellerCentral = await SellerCentralModel.findOne({ User: userId });

  if (!sellerCentral) {
    logger.error(new ApiError(404, 'Seller central not found'));
    return res
      .status(404)
      .json(new ApiResponse(404, [], 'Seller central not found'));
  }

  const accounts = (sellerCentral.sellerAccount || [])
    .filter((acc) => acc && acc.country && acc.region)
    .map((acc) => ({
      _id: acc._id,
      brand: sellerCentral.brand || 'Amazon Seller',
      country: acc.country,
      region: acc.region,
      SpAPIrefreshTokenStatus:
        !!(acc.spiRefreshToken && acc.spiRefreshToken.trim() !== ''),
      AdsAPIrefreshTokenStatus:
        !!(acc.adsRefreshToken && acc.adsRefreshToken.trim() !== ''),
    }));

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { accounts },
        'Seller accounts fetched from database successfully'
      )
    );
});

module.exports = {
  getSellerAccountsForUser,
};


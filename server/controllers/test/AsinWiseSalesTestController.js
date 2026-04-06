const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAccessToken } = require('../../Services/Sp_API/GenerateTokens.js');
const { fetchPersistAndReturnAsinWiseSales } = require('../../Services/Sp_API/AsinWiseSalesStorageService.js');
const logger = require('../../utils/Logger.js');

/**
 * Test controller for ASIN-wise sales report.
 * Body: { userId, country, region, days?, dataSource? }
 */
async function testAsinWiseSales(req, res) {
  try {
    const {
      userId,
      country,
      region,
      days = 30,
      dataSource = 'report', // report | api | both
    } = req.body || {};

    if (!userId || !country || !region) {
      return res.status(400).json({
        success: false,
        message: 'userId, country, and region are required',
      });
    }

    const countryUpper = String(country).toUpperCase();
    const regionUpper = String(region).toUpperCase();
    if (!['NA', 'EU', 'FE'].includes(regionUpper)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid region. Expected one of: NA, EU, FE',
      });
    }

    if (!['report', 'api', 'both'].includes(String(dataSource))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataSource. Expected one of: report, api, both',
      });
    }

    // Support ObjectId strings
    const mongoose = require('mongoose');
    let userIdQuery = userId;
    if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
      userIdQuery = new mongoose.Types.ObjectId(userId);
    }

    const sellerCentral = await Seller.findOne({ User: userIdQuery }).sort({ createdAt: -1 });
    if (!sellerCentral) {
      return res.status(404).json({
        success: false,
        message: 'Seller account not found for the provided userId',
      });
    }

    const sellerAccount = sellerCentral.sellerAccount?.find(
      (acc) => acc?.country === countryUpper && acc?.region === regionUpper
    );

    if (!sellerAccount) {
      return res.status(404).json({
        success: false,
        message: `Seller account not found for country: ${countryUpper} and region: ${regionUpper}`,
      });
    }

    if (!sellerAccount.spiRefreshToken) {
      return res.status(400).json({
        success: false,
        message: 'SP-API refresh token not found for this seller account. Connect Amazon Seller Central first.',
      });
    }

    logger.info('[testAsinWiseSales] Generating SP-API access token...');
    const accessToken = await generateAccessToken(userIdQuery, sellerAccount.spiRefreshToken);
    if (!accessToken) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate SP-API access token. Refresh token may be invalid/expired.',
      });
    }

    logger.info('[testAsinWiseSales] Calling fetchPersistAndReturnAsinWiseSales...');
    const result = await fetchPersistAndReturnAsinWiseSales({
      userId: userIdQuery,
      country: countryUpper,
      regionModel: regionUpper,
      refreshToken: sellerAccount.spiRefreshToken,
      accessToken,
      days: Number(days) || 30,
      dataSource: String(dataSource),
    });

    return res.status(200).json({
      success: true,
      message: 'ASIN-wise sales fetched successfully',
      data: result,
    });
  } catch (error) {
    logger.error('[testAsinWiseSales] Error:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error',
      data: null,
    });
  }
}

module.exports = { testAsinWiseSales };


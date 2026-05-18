const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAccessToken } = require('../../Services/Sp_API/GenerateTokens.js');
const logger = require('../../utils/Logger.js');
const { getDefaultExpenseFinanceDaysBack } = require('../../config/expenseFinanceDaysBack.js');
const { fetchPersistAndReturnExpenseReport } = require('../../Services/Sp_API/FinanceService.js');

async function testExpenseReport(req, res) {
  try {
    const { userId, country, region, daysBack = getDefaultExpenseFinanceDaysBack(), from, to } = req.body || {};

    if (!userId || !country || !region) {
      return res.status(400).json({
        success: false,
        message: 'userId, country, and region are required',
      });
    }

    if ((from && !to) || (!from && to)) {
      return res.status(400).json({
        success: false,
        message: 'If you pass from/to, you must pass BOTH. Format: YYYY-MM-DD',
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

    // Support ObjectId strings (same style as other test controllers)
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

    const refreshToken = sellerAccount.spiRefreshToken;

    logger.info('[testExpenseReport] Generating SP-API access token...');
    const accessToken = await generateAccessToken(userIdQuery, refreshToken);
    if (!accessToken) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate SP-API access token. Refresh token may be invalid/expired.',
      });
    }

    logger.info('[testExpenseReport] Calling getExpenseReport...');
    const result = await fetchPersistAndReturnExpenseReport({
      userId: userIdQuery,
      country: countryUpper,
      regionModel: regionUpper, // NA | EU | FE
      refreshToken,
      accessToken,
      daysBack: Number(daysBack) || getDefaultExpenseFinanceDaysBack(),
      from: from || undefined,
      to: to || undefined,
      clientId: process.env.SPAPI_CLIENT_ID,
      clientSecret: process.env.SPAPI_CLIENT_SECRET,
    });

    return res.status(200).json({
      success: true,
      message: 'Expense report fetched successfully',
      data: result,
    });
  } catch (error) {
    logger.error('[testExpenseReport] Error:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error',
      data: null,
    });
  }
}

module.exports = { testExpenseReport };


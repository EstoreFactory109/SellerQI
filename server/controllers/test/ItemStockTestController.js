const mongoose = require('mongoose');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAccessToken } = require('../../Services/Sp_API/GenerateTokens.js');
const { fetchInventoryStock } = require('../../Services/Sp_API/ItemStock.js');
const { persistFbaInventoryFromFetch } = require('../../Services/Sp_API/FbaInventoryStorageService.js');
const logger = require('../../utils/Logger.js');

function sellerRegionToSpApiInternal(regionUpper) {
  const r = String(regionUpper).toUpperCase();
  if (r === 'NA') return 'na';
  if (r === 'EU') return 'eu';
  if (r === 'FE') return 'apac';
  return null;
}

/**
 * Test FBA inventory summaries (ItemStock / Inventory API).
 * Body: { userId, country, region, sellerSkus? }
 */
async function testItemStock(req, res) {
  try {
    const { userId, country, region, sellerSkus } = req.body || {};

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

    const internalRegion = sellerRegionToSpApiInternal(regionUpper);
    if (!internalRegion) {
      return res.status(400).json({
        success: false,
        message: 'Invalid region mapping for SP-API',
      });
    }

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

    logger.info('[testItemStock] Generating SP-API access token...');
    const accessToken = await generateAccessToken(userIdQuery, sellerAccount.spiRefreshToken);
    if (!accessToken) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate SP-API access token. Refresh token may be invalid/expired.',
      });
    }

    const skuFilter = Array.isArray(sellerSkus)
      ? sellerSkus.map((s) => String(s).trim()).filter(Boolean)
      : [];

    logger.info('[testItemStock] Calling fetchInventoryStock...');
    const result = await fetchInventoryStock({
      userId: String(userIdQuery),
      country: countryUpper,
      region: internalRegion,
      accessToken,
      sellerSkus: skuFilter,
    });

    let persistSummary = null;
    if (result?.hasData && Array.isArray(result.stockRows) && result.stockRows.length > 0) {
      persistSummary = await persistFbaInventoryFromFetch({
        userId: userIdQuery,
        country: countryUpper,
        region: regionUpper,
        marketplaceId: result.marketplaceId,
        stockRows: result.stockRows,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'FBA inventory stock fetched successfully',
      data: result,
      persistSummary,
    });
  } catch (error) {
    logger.error('[testItemStock] Error:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error',
      data: null,
    });
  }
}

module.exports = { testItemStock };

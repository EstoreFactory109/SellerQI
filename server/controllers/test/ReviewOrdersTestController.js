const mongoose = require("mongoose");
const Seller = require("../../models/user-auth/sellerCentralModel.js");
const { fetchOrders } = require("../../Services/review/orders.js");
const { generateAccessToken } = require("../../Services/Sp_API/GenerateTokens.js");
const { marketplaceConfig, URIs, spapiRegions } = require("../../controllers/config/config.js");
const getTemporaryCredentials = require("../../utils/GenerateTemporaryCredentials.js");

/**
 * Test controller: Fetch last 30 days of Shipped orders for a particular user
 * Fully aligned with app flow:
 * - Accepts userId, country, region
 * - Looks up sellerAccount for that location
 * - Uses per-user SP-API refresh token + shared clientId/secret (GenerateTokens)
 * - Uses stored or fallback marketplaceId and SP-API endpoint/region
 */
const testGetLast30DaysOrders = async (req, res) => {
  try {
    const { userId, country, region } = req.body;

    if (!userId || !country || !region) {
      return res.status(400).json({
        success: false,
        error: "userId, country, and region are required",
      });
    }

    console.log("[testGetLast30DaysOrders] Params:", { userId, country, region });

    // Normalize userId to ObjectId if possible
    let userIdQuery = userId;
    if (typeof userId === "string" && mongoose.Types.ObjectId.isValid(userId)) {
      userIdQuery = new mongoose.Types.ObjectId(userId);
    }

    // 1) Find sellerCentral + sellerAccount for this user/location
    const sellerCentral = await Seller.findOne({ User: userIdQuery }).sort({ createdAt: -1 }).lean();
    if (!sellerCentral?.sellerAccount?.length) {
      return res.status(404).json({
        success: false,
        error: "Seller account not found for the provided userId",
      });
    }

    const sellerAccount = sellerCentral.sellerAccount.find(
      (acc) => acc.country === country && acc.region === region
    );
    if (!sellerAccount) {
      return res.status(404).json({
        success: false,
        error: `Seller account not found for country=${country}, region=${region}`,
      });
    }

    // 2) Get refresh token and generate SP-API access token
    const spiRefreshToken =
      sellerAccount.spiRefreshToken || sellerAccount.spRefreshToken || sellerAccount.refreshToken;

    if (!spiRefreshToken) {
      return res.status(400).json({
        success: false,
        error:
          "SP-API refresh token not found for this seller account. Please connect Amazon Seller Central first.",
      });
    }

    const accessToken = await generateAccessToken(userIdQuery, spiRefreshToken);
    if (!accessToken) {
      return res.status(500).json({
        success: false,
        error: "Failed to generate SP-API access token. Please re-connect Amazon Seller Central.",
      });
    }

    // 3) Resolve marketplace and SP-API endpoint/region
    let marketplaceId =
      sellerAccount.marketplaceId ||
      (Array.isArray(sellerAccount.marketplaceIds) ? sellerAccount.marketplaceIds[0] : null) ||
      process.env.DEFAULT_MARKETPLACE_ID ||
      marketplaceConfig[country] ||
      marketplaceConfig[country?.toUpperCase()];

    if (!marketplaceId) {
      return res.status(400).json({
        success: false,
        error:
          "Marketplace ID not found for this seller account or country. Please ensure marketplace is stored or configure mapping in marketplaceConfig.",
      });
    }

    const spRegion = region || "NA";
    let endpoint = URIs?.[spRegion];
    const awsRegion = spapiRegions[spRegion];

    // Fallback to hardcoded defaults if URIs config is missing
    if (!endpoint) {
      const defaultURIs = {
        NA: "https://sellingpartnerapi-na.amazon.com",
        EU: "https://sellingpartnerapi-eu.amazon.com",
        FE: "https://sellingpartnerapi-fe.amazon.com",
      };
      endpoint = defaultURIs[spRegion];
    }

    // Ensure endpoint is a valid absolute URL (add https:// if only host is provided)
    if (endpoint && !/^https?:\/\//i.test(endpoint)) {
      endpoint = `https://${endpoint}`;
    }

    if (!endpoint || !awsRegion) {
      return res.status(400).json({
        success: false,
        error: `Unsupported SP-API region: ${spRegion}. Valid values: NA, EU, FE.`,
      });
    }
    // 4) Get temporary AWS credentials for SigV4 signing (matches rest of app)
    const tempCreds = await getTemporaryCredentials(awsRegion);
    if (!tempCreds?.AccessKey || !tempCreds?.SecretKey || !tempCreds?.SessionToken) {
      return res.status(500).json({
        success: false,
        error: "Failed to obtain temporary AWS credentials for SP-API signing.",
      });
    }

    // 5) Call orders service with per-user config + temp AWS creds
    const orders = await fetchOrders(accessToken, {
      marketplaceId,
      endpoint,
      awsAccessKeyId: tempCreds.AccessKey,
      awsSecretAccessKey: tempCreds.SecretKey,
      awsRegion,
      awsSessionToken: tempCreds.SessionToken,
    });

    return res.status(200).json({
      success: true,
      userId,
      country,
      region,
      totalOrders: orders.length,
      orders,
    });
  } catch (error) {
    console.error("❌ Error in testGetLast30DaysOrders:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch last 30 days orders",
    });
  }
};

module.exports = {
  testGetLast30DaysOrders,
};


const { ingestReviewOrders } = require("./reviewIngestionService");
const { generateAccessToken } = require("../Sp_API/GenerateTokens");
const getTemporaryCredentials = require("../../utils/GenerateTemporaryCredentials");
const Seller = require("../../models/user-auth/sellerCentralModel");
const {
  marketplaceConfig,
  URIs,
  spapiRegions,
} = require("../../controllers/config/config");
const logger = require("../../utils/Logger");

/**
 * Wrapper that matches the ScheduleConfig `isCalculationService` signature:
 *   (userId, country, region, source)
 *
 * Internally resolves seller tokens, builds awsConfig, and delegates to
 * ingestReviewOrders (the lightweight ingestion service).
 */
async function scheduledReviewIngestion(userId, country, region, source) {
  logger.info(
    `[scheduledReviewIngestion] Starting for user ${userId}, ${country}/${region} (source: ${source})`
  );

  try {
    const sellerCentral = await Seller.findOne({ User: userId }).lean();
    if (!sellerCentral?.sellerAccount?.length) {
      logger.warn(
        `[scheduledReviewIngestion] No seller account found for user ${userId}`
      );
      return { success: false, error: "Seller account not found" };
    }

    const sellerAccount = sellerCentral.sellerAccount.find(
      (acc) => acc.country === country && acc.region === region
    );
    if (!sellerAccount) {
      return {
        success: false,
        error: `Seller account not found for ${country}/${region}`,
      };
    }

    const spiRefreshToken =
      sellerAccount.spiRefreshToken ||
      sellerAccount.spRefreshToken ||
      sellerAccount.refreshToken;

    if (!spiRefreshToken) {
      return { success: false, error: "SP-API refresh token not found" };
    }

    const accessToken = await generateAccessToken(userId, spiRefreshToken);
    if (!accessToken) {
      return { success: false, error: "Failed to generate SP-API access token" };
    }

    let marketplaceId =
      sellerAccount.marketplaceId ||
      (Array.isArray(sellerAccount.marketplaceIds)
        ? sellerAccount.marketplaceIds[0]
        : null) ||
      marketplaceConfig[country] ||
      marketplaceConfig[country?.toUpperCase()];

    if (!marketplaceId) {
      return { success: false, error: "Marketplace ID not found" };
    }

    const spRegion = region || "NA";
    let endpoint = URIs?.[spRegion];
    const awsRegion = spapiRegions[spRegion];

    if (!endpoint) {
      const defaultURIs = {
        NA: "https://sellingpartnerapi-na.amazon.com",
        EU: "https://sellingpartnerapi-eu.amazon.com",
        FE: "https://sellingpartnerapi-fe.amazon.com",
      };
      endpoint = defaultURIs[spRegion];
    }

    if (endpoint && !/^https?:\/\//i.test(endpoint)) {
      endpoint = `https://${endpoint}`;
    }

    if (!endpoint || !awsRegion) {
      return { success: false, error: `Unsupported SP-API region: ${spRegion}` };
    }

    const tempCreds = await getTemporaryCredentials(awsRegion);
    if (
      !tempCreds?.AccessKey ||
      !tempCreds?.SecretKey ||
      !tempCreds?.SessionToken
    ) {
      return {
        success: false,
        error: "Failed to obtain temporary AWS credentials",
      };
    }

    const awsConfig = {
      marketplaceId,
      endpoint,
      awsAccessKeyId: tempCreds.AccessKey,
      awsSecretAccessKey: tempCreds.SecretKey,
      awsRegion,
      awsSessionToken: tempCreds.SessionToken,
    };

    const result = await ingestReviewOrders({
      userId,
      country,
      region,
      accessToken,
      awsConfig,
    });

    logger.info(
      `[scheduledReviewIngestion] Done for user ${userId}: ingested=${result.ingested}, failed=${result.failed}`
    );

    return { success: true, data: result, error: null };
  } catch (error) {
    logger.error(
      `[scheduledReviewIngestion] Error for user ${userId}:`,
      error
    );
    return {
      success: false,
      error: error.message || "Review order ingestion failed",
    };
  }
}

module.exports = {
  scheduledReviewIngestion,
};
